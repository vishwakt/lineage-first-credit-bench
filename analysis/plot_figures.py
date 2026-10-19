"""Draw every figure from results/derived/numbers.json (run verify_numbers.py first).

Colours are the first slots of a categorical palette validated for colour-vision
deficiency; every series also has its own marker or hatch so the figures survive
greyscale printing. Writes PNG (300 dpi) and PDF to figures/.

Usage: python3 analysis/plot_figures.py
"""

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

N = json.load(open("results/derived/numbers.json"))["numbers"]
OUT = "figures"
os.makedirs(OUT, exist_ok=True)

BLUE, ORANGE, AQUA, YELLOW, MAGENTA = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"
DESIGNS = [("lineage", "Lineage first", BLUE, "o", ""), ("baseline_parsed", "Baseline, parsed", ORANGE, "s", "//"),
           ("baseline_normalized", "Baseline, normalized", AQUA, "^", ".."), ("baseline_raw", "Baseline, raw", YELLOW, "D", "xx"),
           ("baseline_hardened", "Baseline, hardened", MAGENTA, "v", "\\\\")]
MODES = [("silo", "Silo", BLUE, "o"), ("pool", "Pool", ORANGE, "s"), ("bridge", "Bridge", AQUA, "^")]

plt.rcParams.update({"font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
                     "axes.axisbelow": True, "legend.frameon": False, "lines.linewidth": 2, "lines.markersize": 6})


def save(fig, name, rect=None):
    fig.tight_layout(rect=rect)
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(OUT, f"{name}.{ext}"), dpi=300)
    plt.close(fig)


def sizes():
    return sorted({int(k.split(".")[1]) for k in N if k.startswith("rq2.") and k.split(".")[1].isdigit()})


# Figure 1: RQ1 change footprint per added source
fig, axes = plt.subplots(1, 2, figsize=(7, 2.8))
steps = list(range(1, 9))
for ax, metric, label in [(axes[0], "linesChanged", "Lines changed"), (axes[1], "filesTouched", "Files touched")]:
    for key, name, color, marker, _ in [DESIGNS[0], ("baseline", "Baseline", ORANGE, "s", "")]:
        ax.plot(steps, [N[f"rq1.s{n}.{key}.{metric}"] for n in steps], color=color, marker=marker, label=name)
    ax.set_xlabel("Source added (N)")
    ax.set_ylabel(label)
    ax.set_xticks(steps)
    ax.set_ylim(bottom=0)
axes[0].legend(loc="upper right")
save(fig, "fig1_rq1_footprint")

# Figure 2: RQ2 replay fidelity by drift exposure (largest corpus)
size = sizes()[-1]
classes = [("no_drift", "No drift"), ("format_drift_only", "Format drift\nonly"), ("refdata_drift", "Reference-data\ndrift")]
fig, axes = plt.subplots(1, 2, figsize=(7, 3), sharey=True)
width = 0.16
for ax, metric, title in [(axes[0], "modelInputExact", "Model input byte identical"), (axes[1], "rawExact", "Raw payloads byte identical")]:
    for i, (key, name, color, _, hatch) in enumerate(DESIGNS):
        xs = [c + (i - (len(DESIGNS) - 1) / 2) * width for c in range(len(classes))]
        ys = [100 * N[f"rq2.{size}.{key}.{cls}.{metric}_share"] for cls, _ in classes]
        ax.bar(xs, ys, width * 0.9, color=color, hatch=hatch, edgecolor="white", linewidth=0.5, label=name)
        for x, y in zip(xs, ys):
            if y < 0.5:  # a zero bar is a result, not missing data
                ax.text(x, 1.5, "0", ha="center", va="bottom", fontsize=7, color=MUTED)
    ax.set_xticks(range(len(classes)), [c for _, c in classes], rotation=0)
    ax.set_title(title, fontsize=9, color=INK)
    ax.set_ylim(0, 105)
axes[0].set_ylabel("Decisions replayed (%)")
fig.suptitle(f"Corpus of {size:,} decisions", fontsize=9, color=MUTED)
fig.legend(*axes[0].get_legend_handles_labels(), loc="lower center", ncol=5, fontsize=7)
save(fig, "fig2_rq2_fidelity", rect=(0, 0.1, 1, 1))

# Figure 3: RQ2 replay latency against corpus size
fig, axes = plt.subplots(1, 2, figsize=(7, 2.8), sharey=False)
for ax, q, title in [(axes[0], "p50", "Median (p50)"), (axes[1], "p99", "99th percentile (p99)")]:
    for key, name, color, marker, _ in DESIGNS:
        means = [N[f"rq2.{s}.{key}.latency_ms.{q}.mean"] for s in sizes()]
        lo = [m - N[f"rq2.{s}.{key}.latency_ms.{q}.ci_low"] for m, s in zip(means, sizes())]
        hi = [N[f"rq2.{s}.{key}.latency_ms.{q}.ci_high"] - m for m, s in zip(means, sizes())]
        ax.errorbar(sizes(), means, yerr=[lo, hi], color=color, marker=marker, capsize=3, label=name)
    ax.set_xscale("log")
    ax.set_xlabel("Decisions in corpus")
    ax.set_ylabel("Replay latency (ms)")
    ax.set_title(title, fontsize=9, color=INK)
    ax.set_ylim(bottom=0)
axes[0].legend(fontsize=8)
save(fig, "fig3_rq2_latency")

# Figure 4: RQ3 throughput and storage per tenant
counts = sorted({int(k.split(".")[2]) for k in N if k.startswith("rq3.")})
fig, axes = plt.subplots(1, 2, figsize=(7, 2.8))
for key, name, color, marker in MODES:
    means = [N[f"rq3.{key}.{n}.decisions_per_second.mean"] for n in counts]
    lo = [m - N[f"rq3.{key}.{n}.decisions_per_second.ci_low"] for m, n in zip(means, counts)]
    hi = [N[f"rq3.{key}.{n}.decisions_per_second.ci_high"] - m for m, n in zip(means, counts)]
    axes[0].errorbar(counts, means, yerr=[lo, hi], color=color, marker=marker, capsize=3, label=name)
    axes[1].plot(counts, [N[f"rq3.{key}.{n}.bytes_per_tenant_empty"] / 1e6 for n in counts], color=color, marker=marker, label=name)
axes[0].set_ylabel("Decisions persisted per second")
axes[1].set_ylabel("Fixed storage per tenant (MB)")
for ax in axes:
    ax.set_xlabel("Tenants")
    ax.set_xticks(counts)
    ax.set_ylim(bottom=0)
axes[0].legend(fontsize=8)
save(fig, "fig4_rq3_tenancy")

# Figure 5: RQ4 fault escape by type and quality mode
qmodes = [("off", "No quality layer", ORANGE, "//"), ("xval", "Cross-validation", BLUE, ""), ("xval_anomaly", "Cross-validation and anomaly rule", AQUA, "..")]
types = [("missed", "Missed payment"), ("double", "Double count"), ("timing", "Timing error")]
fig, ax = plt.subplots(figsize=(5, 2.8))
for i, (key, name, color, hatch) in enumerate(qmodes):
    xs = [t + (i - 1) * 0.27 for t in range(len(types))]
    ax.bar(xs, [100 * N[f"rq4.{key}.{t}.escape_share"] for t, _ in types], 0.25, color=color, hatch=hatch, edgecolor="white", linewidth=0.5, label=name)
ax.set_xticks(range(len(types)), [t for _, t in types])
ax.set_ylabel("Injected faults reaching the model (%)")
ax.set_ylim(0, 105)
ax.legend(fontsize=8)
save(fig, "fig5_rq4_faults")

print("figures written to", OUT)
