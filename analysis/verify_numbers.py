"""Regenerate every reported number from the raw results.

Reads results/raw/*.json, writes results/derived/numbers.json (flat, stable keys that the
manuscript cites), and exits non-zero if any consistency
check fails. Uses the standard library plus numpy for the bootstrap (docs/ANALYSIS_PLAN.md).

Usage: python3 analysis/verify_numbers.py
"""

import glob
import json
import math
import os
import statistics
import sys

import numpy as np

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
            if d != "lineage":
                # Paired by run: every design replays the same sampled decisions in a run.
                put_summary(f"rq2.{size}.{d}.latency_ms.{q}.paired_minus_lineage", [run[d][q] - run["lineage"][q] for run in r["latencyRuns"]])
    samples_path = os.path.join(RAW, f"rq2_latency_samples_{size}.json")
    if os.path.exists(samples_path):
        runs = json.load(open(samples_path))["runs"]
        rng = np.random.default_rng(20261018)
        for d in runs[0]:
            pooled = np.concatenate([np.asarray(run[d]) for run in runs])
            for q, qq in (("p50", 0.5), ("p99", 0.99)):
                # Percentile bootstrap of the quantile over all replays pooled across runs.
                boots = np.quantile(rng.choice(pooled, size=(1000, pooled.size), replace=True), qq, axis=1)
                put(f"rq2.{size}.{d}.latency_ms.{q}.pooled", float(np.quantile(pooled, qq)))
                put(f"rq2.{size}.{d}.latency_ms.{q}.pooled_boot_low", float(np.quantile(boots, 0.025)))
                put(f"rq2.{size}.{d}.latency_ms.{q}.pooled_boot_high", float(np.quantile(boots, 0.975)))
            put(f"rq2.{size}.{d}.latency_samples", int(pooled.size))
        check(f"rq2 {size}: latency samples match the run count", len(runs) == len(r["latencyRuns"]))
    check(f"rq2 {size}: at least 5 latency runs", len(r["latencyRuns"]) >= 5)
    put(f"rq2.{size}.size", size)
    put(f"rq2.{size}.latency_runs", len(r["latencyRuns"]))
    put(f"rq2.{size}.latency_sample", r["sample"])
    put(f"rq2.{size}.latency_warmup", r["warmup"])
    put(f"rq2.{size}.sources_per_decision", 8)

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
            put(f"{p}.eligible", size - control[d]["affected"])
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
    put(f"{p}.tenants", row["tenants"])
    put(f"{p}.high_perimeter_tenants", row["highPerimeterTenants"])
    put(f"{p}.throughput_runs", row["throughput"]["runs"])
    put(f"{p}.decisions_per_run", row["throughput"]["decisionsPerRun"])
    put(f"{p}.concurrency", row["throughput"]["concurrency"])
    put(f"{p}.isolation_attackers", row["isolation"]["attackers"])
    put(f"{p}.isolation_db_level_blocked_share_high",
        sum(row["isolation"]["summary"][f"{a}|high"]["blocked"] for a in ("forged_context", "credential_reuse"))
        / sum(row["isolation"]["summary"][f"{a}|high"]["attempts"] for a in ("forged_context", "credential_reuse")))
    put(f"{p}.isolation_db_level_blocked_share_standard",
        sum(row["isolation"]["summary"][f"{a}|standard"]["blocked"] for a in ("forged_context", "credential_reuse"))
        / sum(row["isolation"]["summary"][f"{a}|standard"]["attempts"] for a in ("forged_context", "credential_reuse")))
    put(f"{p}.isolation_app_level_blocked_share",
        sum(row["isolation"]["summary"][f"{a}|all"]["blocked"] for a in ("api_read", "api_replay", "scoped_query"))
        / sum(row["isolation"]["summary"][f"{a}|all"]["attempts"] for a in ("api_read", "api_replay", "scoped_query")))
    put(f"{p}.isolation_attempts_total", sum(v["attempts"] for k, v in row["isolation"]["summary"].items() if k.endswith("|all")))

# RQ3 throughput equivalence against pool: margin 10% of the pool mean, two one-sided tests
# at alpha 0.05, that is, the 90% Welch interval of the difference must lie inside the margin.
T95_ONE = {1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.860, 9: 1.833, 10: 1.812,
           12: 1.782, 15: 1.753, 20: 1.725, 25: 1.708, 30: 1.697, 40: 1.684, 60: 1.671}


def t95_one(df):
    keys = sorted(k for k in T95_ONE if k <= df)
    return T95_ONE[keys[-1]] if keys else T95_ONE[1]


rows = {(row["mode"], row["tenants"]): row for row in r3["results"]}
for (mode, t), row in rows.items():
    if mode == "pool":
        continue
    a = row["throughput"]["decisionsPerSecond"]
    b = rows[("pool", t)]["throughput"]["decisionsPerSecond"]
    va, vb = statistics.variance(a) / len(a), statistics.variance(b) / len(b)
    diff = statistics.fmean(a) - statistics.fmean(b)
    se = math.sqrt(va + vb)
    df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
    lo, hi = diff - t95_one(int(df)) * se, diff + t95_one(int(df)) * se
    margin = 0.10 * statistics.fmean(b)
    verdict = "equivalent" if -margin < lo and hi < margin else ("different" if (lo > margin or hi < -margin) else "not_established")
    p = f"rq3.{mode}.{t}.vs_pool"
    put(f"{p}.difference", diff)
    put(f"{p}.difference_share", diff / statistics.fmean(b))
    put(f"{p}.ci90_low", lo)
    put(f"{p}.ci90_high", hi)
    put(f"{p}.margin", margin)
    put(f"{p}.verdict", verdict)

# RQ4
r4 = load("rq4_faults.json")
lat_off = r4["latency"]["microsecondsPerDecision"]["off"]
seeds = [str(x) for x in r4["seeds"]]
put("rq4.seed_count", len(seeds))
for mode in r4["perSeed"][seeds[0]]:
    p = f"rq4.{mode}"
    pooled = {"injected": {}, "caught": {}, "escaped": {}}
    totals = {k: 0 for k in ("quarantined", "falseQuarantines", "altRecords", "outcomeDiffers", "decisionsWithFault", "unreconciled")}
    per_seed = {"escape_share": [], "caught_share": [], "false_quarantine_share": [], "outcome_differs": []}
    for sd in seeds:
        st = r4["perSeed"][sd][mode]
        inj, cau, esc = sum(st["injected"].values()), sum(st["caught"].values()), sum(st["escaped"].values())
        for k in ("injected", "caught", "escaped"):
            for t, v in st[k].items():
                pooled[k][t] = pooled[k].get(t, 0) + v
        for k in totals:
            totals[k] += st[k]
        put(f"{p}.seed.{sd}.injected", inj)
        put(f"{p}.seed.{sd}.caught", cau)
        put(f"{p}.seed.{sd}.escaped", esc)
        put(f"{p}.seed.{sd}.outcome_differs", st["outcomeDiffers"])
        put(f"{p}.seed.{sd}.false_quarantines", st["falseQuarantines"])
        per_seed["escape_share"].append(esc / inj)
        per_seed["caught_share"].append(cau / inj)
        per_seed["false_quarantine_share"].append(st["falseQuarantines"] / st["altRecords"])
        per_seed["outcome_differs"].append(st["outcomeDiffers"])
        check(f"rq4 {mode} seed {sd}: every injected fault reconciles as caught or escaped", st["unreconciled"] == 0 and cau + esc == inj)
    for k, xs in per_seed.items():
        put_summary(f"{p}.across_seeds.{k}", xs)
    injected, caught, escaped = (sum(pooled[k].values()) for k in ("injected", "caught", "escaped"))
    put(f"{p}.injected", injected)
    put(f"{p}.caught", caught)
    put(f"{p}.escaped", escaped)
    put(f"{p}.escape_share", escaped / injected)
    put(f"{p}.caught_share", caught / injected)
    for t in pooled["injected"]:
        put(f"{p}.{t}.injected", pooled["injected"][t])
        put(f"{p}.{t}.escaped", pooled["escaped"].get(t, 0))
        put(f"{p}.{t}.escape_share", pooled["escaped"].get(t, 0) / pooled["injected"][t])
    put(f"{p}.quarantined", totals["quarantined"])
    put(f"{p}.false_quarantines", totals["falseQuarantines"])
    put(f"{p}.false_quarantine_share", totals["falseQuarantines"] / totals["altRecords"])
    put(f"{p}.alt_records", totals["altRecords"])
    put(f"{p}.outcome_differs", totals["outcomeDiffers"])
    put(f"{p}.outcome_differs_share", totals["outcomeDiffers"] / (r4["decisions"] * len(seeds)))
    put(f"{p}.decisions_with_fault", totals["decisionsWithFault"])
    lat = r4["latency"]["microsecondsPerDecision"][mode]
    put_summary(f"{p}.latency_us", lat)
    put_summary(f"{p}.added_latency_us", [a - b for a, b in zip(lat, lat_off)])
for mode in ("xval", "xval_anomaly"):
    off, m = numbers["rq4.off.outcome_differs"], numbers[f"rq4.{mode}.outcome_differs"]
    put(f"rq4.{mode}.outcome_differs_reduction_share", (off - m) / off)
put("rq4.decisions_total", r4["decisions"] * len(seeds))
put("rq4.decisions", r4["decisions"])
put("rq4.latency_runs", r4["latency"]["runs"])
put("rq4.latency_seed", r4["latency"]["seed"])
put("rq4.latency_decisions_per_run", r4["latency"]["decisionsPerRun"])
for t, rate in r4["faultRates"].items():
    put(f"rq4.fault_rate.{t}", rate)
put("gen.max_relative_error", max(r["relativeError"] for r in g["faultRates"].values()))
put("gen.min_eligible", min(r["eligible"] for r in g["faultRates"].values()))
put("rq1.sources", len(r1["steps"]))

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "numbers.json"), "w") as f:
    json.dump({"numbers": numbers, "checks": checks}, f, indent=1, sort_keys=True)
    f.write("\n")

failed = [c for c in checks if not c["ok"]]
print(f"{len(numbers)} numbers, {len(checks)} checks, {len(failed)} failed")
for c in failed:
    print("FAILED:", c["check"])
sys.exit(1 if failed else 0)
