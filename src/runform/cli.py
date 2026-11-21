"""Command line entry point."""

import argparse
import json
from pathlib import Path
from threading import Thread

from runform.garmin import demo_payload
from runform.pipeline import analyze
from runform.web import create_app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="runform")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze_parser = commands.add_parser("analyze", help="Count video frames and detected poses")
    analyze_parser.add_argument("video")
    analyze_parser.add_argument("--out", type=Path, default=Path("r.json"))
    analyze_parser.add_argument("--model", type=Path)
    serve = commands.add_parser("serve", help="Serve the local video analyzer")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--model", type=Path)
    serve.add_argument("--demo", type=Path)
    garmin = commands.add_parser("garmin", help="Export the Garmin Analytics demo report")
    garmin.add_argument("--demo", action="store_true", required=True)
    garmin.add_argument("--out", type=Path, default=Path("activities.json"))
    args = parser.parse_args(argv)
    if args.command == "garmin":
        payload = demo_payload()
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
        report = payload["report"]
        print(f"Garmin demo: {report['runs_total']} runs; {report['distance_miles']:g} miles")
        print(f"Report saved to {args.out}")
        return
    if args.command == "serve":
        print(f"Running Form Analyzer at http://{args.host}:{args.port}")
        demo = args.demo
        if demo is None and Path("samples/demo_run.mp4").is_file():
            demo = Path("samples/demo_run.mp4")
        app = create_app(args.model, demo=demo)
        if demo is not None and demo.is_file():
            def warm_demo():
                try:
                    app.extensions["runform_warm_demo"]()
                except ValueError:
                    pass  # The demo endpoint reports analysis errors to the visitor.
            Thread(target=warm_demo, daemon=True).start()
        app.run(host=args.host, port=args.port)
        return
    report = analyze(args.video, model=args.model).report
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
    overstride = report["overstride_rel"]
    overstride_text = (
        "unavailable" if overstride is None
        else f"{overstride} of body height ahead of hips"
    )
    print(f"Overstride: {overstride_text}")
    for warning in report["warnings"]:
        print(f"Warning: {warning}")
