"""Command line entry point."""

import argparse
import json
from pathlib import Path

from runform.gait import cadence, detect_foot_strikes
from runform.pose import extract_landmarks
from runform.report import build_report
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
    strikes = detect_foot_strikes(landmarks)
    report = build_report(landmarks, len(strikes), cadence(strikes, fps))
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"FPS: {report['fps']:g}; frames total: {report['frames_total']}; "
        f"frames with pose: {report['frames_with_pose']}"
    )
    cadence_text = "unavailable" if report['cadence_spm'] is None else report['cadence_spm']
    print(f"Cadence: {cadence_text} spm")
