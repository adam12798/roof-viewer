#!/usr/bin/env python3
"""
A/B test runner for image engine v1 vs v2.

Usage:
    # Compare v1 vs v2 on a saved image
    python test_engine_ab.py compare --image /path/to/roof.jpg

    # Run per-feature ablation study
    python test_engine_ab.py ablate --image /path/to/roof.jpg

    # Compare with a specific v1 profile
    python test_engine_ab.py compare --image /path/to/roof.jpg --profile high_recall

    # Save comparison artifacts to a directory
    python test_engine_ab.py compare --image /path/to/roof.jpg --output ./results/

All results are printed to stdout.  Debug images are saved to --output
if provided, otherwise skipped.
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import sys
from pathlib import Path

# Add the roof_geometry directory to sys.path so imports work
sys.path.insert(0, str(Path(__file__).parent))

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine.schemas import ImageEngineConfig, make_config
from pipeline.image_engine_v2.config import V2Config
from pipeline.image_engine_v2.comparison import run_comparison, run_ablation


def main():
    parser = argparse.ArgumentParser(description="Image engine A/B tester")
    sub = parser.add_subparsers(dest="command", required=True)

    # Compare command
    cmp = sub.add_parser("compare", help="Run v1 vs v2 comparison")
    cmp.add_argument("--image", required=True, help="Path to roof image")
    cmp.add_argument("--profile", default=None, help="V1 profile (high_recall / high_precision)")
    cmp.add_argument("--resolution", type=float, default=0.1, help="m/px resolution (default 0.1)")
    cmp.add_argument("--output", default=None, help="Directory to save debug artifacts")
    cmp.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")

    # Ablate command
    abl = sub.add_parser("ablate", help="Run per-feature ablation study")
    abl.add_argument("--image", required=True, help="Path to roof image")
    abl.add_argument("--resolution", type=float, default=0.1, help="m/px resolution (default 0.1)")
    abl.add_argument("--output", default=None, help="Directory to save results JSON")
    abl.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")

    args = parser.parse_args()

    # Logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
    )

    # Build inputs
    image_input = ImageInput(
        file_path=str(Path(args.image).resolve()),
        resolution_m_per_px=args.resolution,
    )
    registration = RegistrationTransform(scale=args.resolution)

    if args.command == "compare":
        v1_config = make_config(profile=args.profile) if args.profile else ImageEngineConfig()
        v2_config = V2Config()

        report = run_comparison(image_input, registration, v1_config, v2_config)

        if args.output:
            _save_artifacts(report, args.output)
            print(f"\nArtifacts saved to {args.output}/")

    elif args.command == "ablate":
        results = run_ablation(image_input, registration)

        if args.output:
            out_dir = Path(args.output)
            out_dir.mkdir(parents=True, exist_ok=True)
            out_file = out_dir / "ablation_results.json"
            with open(out_file, "w") as f:
                json.dump(results, f, indent=2, default=str)
            print(f"\nAblation results saved to {out_file}")


def _save_artifacts(report: dict, output_dir: str) -> None:
    """Save comparison images and metrics to disk."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Save comparison image
    if report.get("comparison_image_base64"):
        img_data = base64.b64decode(report["comparison_image_base64"])
        (out / "comparison.png").write_bytes(img_data)

    # Save individual debug artifacts
    for version in ["v1", "v2"]:
        artifacts = report.get(f"{version}_debug_artifacts", [])
        for artifact in artifacts:
            name = artifact.get("name", "unknown")
            b64 = artifact.get("image_base64", "")
            if b64:
                img_data = base64.b64decode(b64)
                (out / f"{version}_{name}.png").write_bytes(img_data)

    # Save metrics
    metrics = {
        "v1": report.get("v1", {}),
        "v2": report.get("v2", {}),
        "diff": report.get("diff", {}),
    }
    with open(out / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2, default=str)


if __name__ == "__main__":
    main()
