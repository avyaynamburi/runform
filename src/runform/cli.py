"""Command line entry point."""

import argparse
import json
from pathlib import Path

import numpy as np

from runform.gait import cadence, detect_foot_strikes
from runform.metrics import knee_flexion_at_strikes, trunk_lean, vertical_oscillation
from runform.pose import extract_landmarks
from runform.report import build_report
from runform.smoothing import fill_gaps, smooth
from runform.video import read_frames


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="runform")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="Count video frames and detected poses")
    analyze.add_argument("video")
    analyze.add_argument("--out", type=Path, default=Path("r.json"))
    analyze.add_argument("--model", type=Path)
    args = parser.parse_args(argv)
    frames, fps = read_frames(args.video)
    landmarks = extract_landmarks(frames, fps, model=args.model)
    clean = smooth(fill_gaps(landmarks))
    frames_total = len(landmarks.data)
    frames_with_pose = int(np.isfinite(landmarks.data).all(axis=(1, 2)).sum())
    warnings = []
    if frames_total > 0 and frames_with_pose / frames_total < 0.8:
        pct = 100 * frames_with_pose / frames_total
        warnings.append(
            f"Pose detected in only {pct:.0f}% of frames; metrics may be unreliable"
        )
    strikes = detect_foot_strikes(clean)
    report = build_report(
        landmarks, len(strikes), cadence(strikes, fps), trunk_lean(clean),
        knee_flexion_at_strikes(clean, strikes),
        vertical_oscillation(clean, strikes), warnings,
    )
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"FPS: {report['fps']:g}; frames total: {report['frames_total']}; "
        f"frames with pose: {report['frames_with_pose']}"
    )
    cadence_text = "unavailable" if report['cadence_spm'] is None else report['cadence_spm']
    print(f"Cadence: {cadence_text} spm")
    lean_text = "unavailable" if report['trunk_lean_deg'] is None else report['trunk_lean_deg']
    print(f"Trunk lean: {lean_text} deg")
    knee = report['knee_flexion_at_strike_deg']
    knee_text = "unavailable" if knee is None else f"{knee['mean']} +/- {knee['std']}"
    print(f"Knee at strike: {knee_text} deg")
    oscillation = report['vertical_oscillation_rel']
    oscillation_text = (
        "unavailable" if oscillation is None else f"{oscillation} of body height"
    )
    print(f"Vertical oscillation: {oscillation_text}")
    for warning in warnings:
        print(f"Warning: {warning}")
