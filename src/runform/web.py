"""Local upload interface for running form analysis."""

from dataclasses import asdict
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from flask import Flask, jsonify, request

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


def create_app(model: str | Path | None = None) -> Flask:
    app = Flask(__name__, static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024

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
            return jsonify(
                strides=strides,
                report=analysis.report, pose=_pose_payload(analysis.clean),
                strikes=[{"frame": int(strike.frame), "foot": strike.foot}
                         for strike in analysis.strikes],
                series={"trunk_lean_deg": [
                    None if np.isnan(value) else round(float(value), 1)
                    for value in metrics.trunk_lean(analysis.clean)
                ], "knee_at_strike_deg": knee_angles},
            )
        except ValueError as exc:
            return jsonify(error=str(exc)), 422
        finally:
            tmp_path.unlink(missing_ok=True)

    return app
