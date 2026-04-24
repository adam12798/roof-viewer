#!/usr/bin/env python3
"""Render Line Audit JSON output as a visual overlay PNG.

Usage:
  python3 render_overlay.py <line_audit.json> <output.png> [--ridges-only] [--satellite <sat.png>]

Draws audit lines as colored segments on a blank or satellite background.
Coordinates are in local XZ metres from design centre.
"""
import json, sys, argparse
from pathlib import Path

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
except ImportError:
    print("pip install matplotlib", file=sys.stderr)
    sys.exit(1)

COLORS = {
    "ridge":     "#FF0044",
    "eave":      "#00FF66",
    "rake":      "#FF8800",
    "hip":       "#FFFF00",
    "valley":    "#FF00FF",
    "uncertain": "#00FFFF",
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json_file", help="Line audit JSON output")
    ap.add_argument("output_png", help="Output PNG path")
    ap.add_argument("--ridges-only", action="store_true", help="Only draw ridge lines")
    ap.add_argument("--satellite", help="Satellite image to use as background")
    ap.add_argument("--title", default="Line Audit Overlay", help="Plot title")
    ap.add_argument("--extent", help="Image extent as xmin,xmax,zmin,zmax (metres)")
    args = ap.parse_args()

    with open(args.json_file) as f:
        data = json.load(f)

    lines = data.get("audit_lines", [])
    summary = data.get("summary", {})
    debug = data.get("debug", {})

    fig, ax = plt.subplots(1, 1, figsize=(12, 12))

    if args.satellite:
        img = plt.imread(args.satellite)
        if args.extent:
            ext = [float(x) for x in args.extent.split(",")]
            ax.imshow(img, extent=ext, aspect="equal", alpha=0.6)
        else:
            ax.imshow(img, aspect="equal", alpha=0.6)

    drawn = {"ridge": 0, "eave": 0, "rake": 0, "hip": 0, "valley": 0, "uncertain": 0, "boundary_trace": 0}
    for ln in lines:
        ltype = ln.get("type", "uncertain")
        source = ln.get("source", "semantic_edge")

        if args.ridges_only and ltype != "ridge":
            continue

        color = COLORS.get(ltype, "#FFFFFF")
        lw = 3.0 if source != "boundary_trace" else 2.0
        ls = "-" if source != "boundary_trace" else "--"
        alpha = 0.9 if ltype == "ridge" else 0.5

        p1, p2 = ln["p1"], ln["p2"]
        ax.plot([p1["x"], p2["x"]], [p1["z"], p2["z"]],
                color=color, linewidth=lw, linestyle=ls, alpha=alpha, solid_capstyle="round")

        if ltype == "ridge":
            mid_x = (p1["x"] + p2["x"]) / 2
            mid_z = (p1["z"] + p2["z"]) / 2
            conf = ln.get("confidence", 0)
            ax.annotate(f'{conf:.2f}', (mid_x, mid_z), fontsize=7, color=color,
                        ha="center", va="bottom", fontweight="bold")

        drawn[ltype] = drawn.get(ltype, 0) + 1
        if source == "boundary_trace":
            drawn["boundary_trace"] += 1

    patches = []
    for ltype, color in COLORS.items():
        count = drawn.get(ltype, 0)
        if count > 0 or not args.ridges_only:
            patches.append(mpatches.Patch(color=color, label=f"{ltype} ({count})"))
    if drawn.get("boundary_trace", 0):
        patches.append(mpatches.Patch(facecolor="none", edgecolor="#888", linestyle="--",
                                      label=f"boundary_trace ({drawn['boundary_trace']})"))
    ax.legend(handles=patches, loc="upper right", fontsize=9, framealpha=0.8)

    fusion = debug.get("fusion", {})
    info_parts = [f"Total: {len(lines)}"]
    if fusion:
        info_parts.append(f"boosted={fusion.get('lines_boosted',0)}")
        info_parts.append(f"reclass={fusion.get('lines_reclassified',0)}")
        info_parts.append(f"bt={fusion.get('boundary_trace_emitted',0)}")
    ax.set_title(f"{args.title}\n{', '.join(info_parts)}", fontsize=11)

    ax.set_xlabel("X (metres, east)")
    ax.set_ylabel("Z (metres, south)")
    ax.set_aspect("equal")
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2)

    plt.tight_layout()
    plt.savefig(args.output_png, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved overlay: {args.output_png}")
    print(f"  Ridges drawn: {drawn.get('ridge',0)}")
    if not args.ridges_only:
        print(f"  Total lines: {len(lines)}")

if __name__ == "__main__":
    main()
