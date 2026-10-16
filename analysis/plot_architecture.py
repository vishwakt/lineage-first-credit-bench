"""Draw the architecture comparison figure (figures/fig0_architecture.png and .pdf).

Two panels share the same providers, adapters, quality layer, and model; they differ in
what is captured and how a past decision is replayed.

Usage: python3 analysis/plot_architecture.py
"""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

INK, MUTED = "#0b0b0b", "#52514e"
SHARED, BASE, LIN = "#eef0f2", "#fbe3d8", "#dbe8f8"
EDGE_BASE, EDGE_LIN = "#eb6834", "#2a78d6"


def box(ax, x, y, w, h, text, fill, edge=MUTED, size=7.5, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.01,rounding_size=0.015", facecolor=fill, edgecolor=edge, linewidth=1))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color=INK, fontweight="bold" if bold else "normal", wrap=True)


def arrow(ax, x1, y1, x2, y2, color=MUTED, style="-|>"):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=8, color=color, linewidth=1))


fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.6))
for ax, title in zip(axes, ["(a) Baseline: per-integration audit logs", "(b) Lineage first: one append-only substrate"]):
    ax.set_xlim(-0.02, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_title(title, fontsize=8.5, color=INK, loc="left")
    # Shared pipeline, identical in both designs.
    for i, name in enumerate(["Provider 1", "Provider 2", "Provider N"]):
        box(ax, 0.0, 0.78 - i * 0.2, 0.19, 0.12, name, SHARED, size=7)
        box(ax, 0.25, 0.78 - i * 0.2, 0.19, 0.12, f"Adapter {name.split()[1]}", SHARED, size=7)
        arrow(ax, 0.19, 0.84 - i * 0.2, 0.25, 0.84 - i * 0.2)
    box(ax, 0.25, 0.06, 0.19, 0.2, "Quality layer\nand decision\nmodel", SHARED, size=7)
    arrow(ax, 0.345, 0.38, 0.345, 0.26)

ax = axes[0]
for i in range(3):
    box(ax, 0.52, 0.78 - i * 0.2, 0.46, 0.12, f"Audit table {['1', '2', 'N'][i]}\n(own schema and migration)", BASE, EDGE_BASE, size=6.5)
    arrow(ax, 0.44, 0.84 - i * 0.2, 0.52, 0.84 - i * 0.2, EDGE_BASE)
box(ax, 0.52, 0.06, 0.46, 0.2, "Decision log\nReplay: one query per source,\nno integrity check", BASE, EDGE_BASE, size=6.5)
arrow(ax, 0.44, 0.16, 0.52, 0.16, EDGE_BASE)

ax = axes[1]
box(ax, 0.52, 0.38, 0.46, 0.52, "Lineage substrate\n(append only)\n\nRaw bytes and hash;\ntenant, requester, purpose;\nformat, dictionary, and\nadapter versions", LIN, EDGE_LIN, size=6.5)
for i in range(3):
    arrow(ax, 0.44, 0.84 - i * 0.2, 0.52, 0.84 - i * 0.2 if i < 2 else 0.5, EDGE_LIN)
box(ax, 0.52, 0.06, 0.46, 0.2, "Decision record links events\nReplay: generic, verified\nagainst stored hashes", LIN, EDGE_LIN, size=6.5)
arrow(ax, 0.44, 0.16, 0.52, 0.16, EDGE_LIN)
arrow(ax, 0.75, 0.26, 0.75, 0.38, EDGE_LIN, style="<|-|>")

fig.tight_layout()
os.makedirs("figures", exist_ok=True)
for ext in ("png", "pdf"):
    fig.savefig(f"figures/fig0_architecture.{ext}", dpi=300)
print("architecture figure written")
