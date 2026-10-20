"""Local upload interface for running form analysis."""

from dataclasses import asdict
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock

import numpy as np
from flask import Flask, jsonify, request, send_file

from runform import metrics, pipeline
from runform.landmarks import Landmarks


def _pose_payload(landmarks: Landmarks) -> dict:
    frames = []
    for frame in landmarks.data:
        if np.isnan(frame).all():
            frames.append(None)
        else:
            frames.append([
                None if np.isnan(point[:2]).any() else
                [round(float(point[0]), 4), round(float(point[1]), 4)]
                for point in frame
            ])
    return {"fps": landmarks.fps, "aspect": landmarks.aspect, "frames": frames}


def _analysis_payload(analysis: pipeline.Analysis) -> dict:
    knee_angles = []
    for strike in analysis.strikes:
        indices = (23, 25, 27) if strike.foot == "left" else (24, 26, 28)
        hip, knee, ankle = analysis.clean.data[strike.frame, indices, :2]
        value = metrics.joint_angle(hip, knee, ankle, aspect=analysis.clean.aspect)
        knee_angles.append(None if np.isnan(value) else round(float(value), 1))
    strides = [
        {**asdict(stride), "value": round(stride.value, 4)}
        for stride in metrics.oscillation_strides(analysis.clean, analysis.strikes)
    ]
    path = metrics.foot_path(analysis.clean, analysis.strikes, analysis.near_side)
    path_payload = None if path is None else {
        "side": analysis.near_side, "actual": path[0].round(4).tolist(),
        "target": path[1].round(4).tolist(),
        "landing_target": metrics.LANDING_TARGET,
    }
    return dict(
        foot_path=path_payload,
        strides=strides,
        report=analysis.report, pose=_pose_payload(analysis.clean),
        strikes=[{"frame": int(strike.frame), "foot": strike.foot}
                 for strike in analysis.strikes],
        series={"trunk_lean_deg": [
            None if np.isnan(value) else round(float(value), 1)
            for value in metrics.trunk_lean(analysis.clean)
        ], "knee_at_strike_deg": knee_angles, "hip_height_rel": [
            None if np.isnan(value) else round(float(value), 4)
            for value in metrics.hip_height(analysis.clean)
        ]},
    )


def create_app(
    model: str | Path | None = None, demo: str | Path | None = None,
) -> Flask:
    app = Flask(__name__, static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024

    demo_path = Path(demo).resolve() if demo is not None else None
    demo_lock = Lock()
    demo_payload = None

    def warm_demo():
        nonlocal demo_payload
        if demo_path is None or not demo_path.is_file():
            return None
        with demo_lock:
            if demo_payload is None:
                demo_payload = {
                    **_analysis_payload(pipeline.analyze(demo_path, model=model)), "demo": True,
                }
            return demo_payload

    app.extensions["runform_warm_demo"] = warm_demo

    @app.get("/api/demo/status")
    def demo_status():
        return jsonify(available=demo_path is not None and demo_path.is_file(),
                       ready=demo_payload is not None)

    @app.post("/api/demo")
    def analyze_demo():
        try:
            payload = warm_demo()
            if payload is None:
                return jsonify(error="No demo clip on this server."), 404
            return jsonify(payload)
        except ValueError as exc:
            return jsonify(error=str(exc)), 422

    @app.get("/api/demo/video")
    def demo_video():
        if demo_path is None or not demo_path.is_file():
            return jsonify(error="No demo clip on this server."), 404
        return send_file(demo_path, conditional=True)

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    @app.post("/api/analyze")
    def analyze_video():
        video = request.files.get("video")
        if video is None or not video.filename:
            return jsonify(error="Choose a video to analyze."), 400
        with NamedTemporaryFile(suffix=Path(video.filename).suffix, delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            video.save(tmp_path)
            analysis = pipeline.analyze(tmp_path, model=model)
            return jsonify(_analysis_payload(analysis))
        except ValueError as exc:
            return jsonify(error=str(exc)), 422
        finally:
            tmp_path.unlink(missing_ok=True)

    return app
