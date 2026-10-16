"""Regenerate every reported number from the raw results.

Reads results/raw/*.json, writes results/derived/numbers.json (flat, stable keys that the
manuscript cites), and exits non-zero if any consistency
check fails. Uses only the Python standard library.

Usage: python3 analysis/verify_numbers.py
"""

import glob
import json
import math
import os
import statistics
import sys

RAW = "results/raw"
OUT = "results/derived"

# Two-sided 95 percent Student t quantiles by degrees of freedom.
T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
        12: 2.179, 15: 2.131, 20: 2.086, 30: 2.042}


def t975(df):
    if df in T975:
        return T975[df]
    keys = sorted(k for k in T975 if k <= df)
    return T975[keys[-1]] if keys else T975[1]


def summary(xs):
    """Mean, sample standard deviation, and t-based 95 percent confidence interval."""
    n = len(xs)
    mean = statistics.fmean(xs)
    sd = statistics.stdev(xs) if n > 1 else 0.0
    half = t975(n - 1) * sd / math.sqrt(n) if n > 1 else 0.0
    return {"n": n, "mean": mean, "sd": sd, "ci_low": mean - half, "ci_high": mean + half}


def ols(xs, ys):
    """Least-squares slope with a 95 percent confidence interval."""
    n = len(xs)
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    se = math.sqrt(sum(r * r for r in resid) / (n - 2) / sxx) if n > 2 else 0.0
    half = t975(n - 2) * se
    return {"slope": slope, "intercept": intercept, "ci_low": slope - half, "ci_high": slope + half}


numbers = {}
checks = []


def put(key, value):
    numbers[key] = value


def put_summary(prefix, xs):
    for k, v in summary(xs).items():
        put(f"{prefix}.{k}", v)


def check(name, ok):
    checks.append({"check": name, "ok": bool(ok)})


def load(name):
    with open(os.path.join(RAW, name)) as f:
        return json.load(f)


# Generator
g = load("generator_check.json")
put("gen.seed", g["seed"])
put("gen.determinism.identical", g["determinism"]["identical"])
put("gen.determinism.different_seed_differs", g["determinism"]["differentSeedDiffers"])
for t, r in g["faultRates"].items():
    for k in ("eligible", "injected", "observed", "configured", "relativeError"):
        put(f"gen.fault.{t}.{k}", r[k])
check("generator: same seed byte identical", g["determinism"]["identical"])
check("generator: fault rates within 1 percent", all(r["relativeError"] <= 0.01 for r in g["faultRates"].values()))

# RQ1
r1 = load("rq1_footprint.json")
for s in r1["steps"]:
    for d in ("lineage", "baseline"):
        for k, v in s[d].items():
            put(f"rq1.s{s['n']}.{d}.{k}", v)
    check(f"rq1: step {s['n']} touches only design and adapter files", not s["other"])
for d in ("lineage", "baseline"):
    for k in ("filesTouched", "linesChanged", "modulesModified", "specificFiles", "specificLines"):
        ys = [s[d][k] for s in r1["steps"]]
        put_summary(f"rq1.{d}.{k}", ys)
        fit = ols([s["n"] for s in r1["steps"]], ys)
        for fk, fv in fit.items():
            put(f"rq1.{d}.{k}.slope.{fk}", fv)

# RQ2
for path in sorted(glob.glob(os.path.join(RAW, "rq2_[0-9]*.json"))):
    r = json.load(open(path))
    size = r["size"]
    put(f"rq2.{size}.raw_bytes_per_decision", r["rawBytesPerDecision"])
    for d, st in r["storage"].items():
        put(f"rq2.{size}.{d}.bytes_per_decision", st["bytesPerDecision"])
        put(f"rq2.{size}.{d}.overhead_vs_raw", st["bytesPerDecision"] / r["rawBytesPerDecision"])
    for d, classes in r["fidelity"].items():
        total = {}
        for cls, t in classes.items():
            for k, v in t.items():
                total[k] = total.get(k, 0) + v
            for k in ("rawExact", "modelInputExact", "outcomeEqual", "decisionEqual", "integrityVerified"):
                put(f"rq2.{size}.{d}.{cls}.{k}_share", t[k] / t["decisions"])
            put(f"rq2.{size}.{d}.{cls}.decisions", t["decisions"])
        for k in ("rawExact", "modelInputExact", "outcomeEqual", "decisionEqual", "integrityVerified"):
            put(f"rq2.{size}.{d}.all.{k}_share", total[k] / total["decisions"])
        put(f"rq2.{size}.{d}.all.decisions", total["decisions"])
        check(f"rq2 {size} {d}: every decision replayed", total["decisions"] == size and total["replayed"] == size)
    for d in r["latencyRuns"][0]:
        for q in ("p50", "p99", "mean"):
            put_summary(f"rq2.{size}.{d}.latency_ms.{q}", [run[d][q] for run in r["latencyRuns"]])
    check(f"rq2 {size}: at least 5 latency runs", len(r["latencyRuns"]) >= 5)

# RQ2 extension: pipeline code drift
for path in sorted(glob.glob(os.path.join(RAW, "rq2_code_drift_*.json"))):
    r = json.load(open(path))
    size = r["size"]
    control = r["results"]["none"]
    for rev, designs in r["results"].items():
        for d, t in designs.items():
            p = f"rq2drift.{size}.{rev}.{d}"
            for k in ("affected", "outcomeChanged", "flagged", "flaggedAffected"):
                put(f"{p}.{k}", t[k])
            # Decisions a revision breaks on top of the design's other replay mismatches; a
            # revision here can only break a reconstruction, never repair one.
            put(f"{p}.newly_affected", t["affected"] - control[d]["affected"])
            put(f"{p}.detection_share", t["flaggedAffected"] / t["affected"] if t["affected"] else None)
            put(f"{p}.false_alarms", t["flagged"] - t["flaggedAffected"])
            check(f"rq2drift {size} {rev} {d}: every decision replayed", t["decisions"] == size)
        check(f"rq2drift {size} {rev}: lineage flags exactly the affected replays",
              designs["lineage"]["flagged"] == designs["lineage"]["affected"] == designs["lineage"]["flaggedAffected"])

# RQ3
r3 = load("rq3_tenancy.json")
for row in r3["results"]:
    p = f"rq3.{row['mode']}.{row['tenants']}"
    put_summary(f"{p}.decisions_per_second", row["throughput"]["decisionsPerSecond"])
    put(f"{p}.connection_ceiling", row["throughput"]["connectionCeiling"])
    put(f"{p}.bytes_per_tenant_empty", row["emptyBytes"] / row["tenants"])
    put(f"{p}.bytes_per_tenant_loaded", row["loadedBytes"] / row["tenants"])
    put(f"{p}.bytes_per_decision_loaded", (row["loadedBytes"] - row["emptyBytes"]) / row["decisionsStored"])
    for tier in ("silo", "pool"):
        recs = [o for o in row["onboarding"] if o["tier"] == tier]
        if not recs:
            continue
        put_summary(f"{p}.onboarding.{tier}.ms", [o["ms"] for o in recs])
        put(f"{p}.onboarding.{tier}.steps", len(recs[0]["steps"]))
        put(f"{p}.onboarding.{tier}.sql_statements", recs[0]["sqlStatements"])
        put(f"{p}.onboarding.{tier}.files_changed", recs[0]["filesChanged"])
        put(f"{p}.onboarding.{tier}.tenants", len(recs))
    for key, v in row["isolation"]["summary"].items():
        attack, scope = key.split("|")
        put(f"{p}.isolation.{attack}.{scope}.attempts", v["attempts"])
        put(f"{p}.isolation.{attack}.{scope}.blocked", v["blocked"])
        put(f"{p}.isolation.{attack}.{scope}.blocked_share", v["blocked"] / v["attempts"])
    check(f"rq3 {row['mode']} {row['tenants']}: API and scoped paths always blocked",
          all(v["blocked"] == v["attempts"] for k, v in row["isolation"]["summary"].items()
              if k.split("|")[0] in ("api_read", "api_replay", "scoped_query")))
    check(f"rq3 {row['mode']} {row['tenants']}: at least 5 throughput runs", len(row["throughput"]["decisionsPerSecond"]) >= 5)

# RQ4
r4 = load("rq4_faults.json")
lat_off = r4["latency"]["microsecondsPerDecision"]["off"]
for mode, st in r4["stats"].items():
    p = f"rq4.{mode}"
    injected = sum(st["injected"].values())
    caught = sum(st["caught"].values())
    escaped = sum(st["escaped"].values())
    put(f"{p}.injected", injected)
    put(f"{p}.caught", caught)
    put(f"{p}.escaped", escaped)
    put(f"{p}.escape_share", escaped / injected)
    for t in st["injected"]:
        put(f"{p}.{t}.injected", st["injected"][t])
        put(f"{p}.{t}.escape_share", st["escaped"].get(t, 0) / st["injected"][t])
    put(f"{p}.quarantined", st["quarantined"])
    put(f"{p}.false_quarantines", st["falseQuarantines"])
    put(f"{p}.false_quarantine_share", st["falseQuarantines"] / st["altRecords"])
    put(f"{p}.alt_records", st["altRecords"])
    put(f"{p}.outcome_differs", st["outcomeDiffers"])
    put(f"{p}.outcome_differs_share", st["outcomeDiffers"] / r4["decisions"])
    put(f"{p}.decisions_with_fault", st["decisionsWithFault"])
    lat = r4["latency"]["microsecondsPerDecision"][mode]
    put_summary(f"{p}.latency_us", lat)
    put_summary(f"{p}.added_latency_us", [a - b for a, b in zip(lat, lat_off)])
    check(f"rq4 {mode}: every injected fault reconciles as caught or escaped", st["unreconciled"] == 0 and caught + escaped == injected)
put("rq4.decisions", r4["decisions"])

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "numbers.json"), "w") as f:
    json.dump({"numbers": numbers, "checks": checks}, f, indent=1, sort_keys=True)
    f.write("\n")

failed = [c for c in checks if not c["ok"]]
print(f"{len(numbers)} numbers, {len(checks)} checks, {len(failed)} failed")
for c in failed:
    print("FAILED:", c["check"])
sys.exit(1 if failed else 0)
