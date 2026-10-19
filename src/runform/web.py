"""Local upload interface for running form analysis."""

from pathlib import Path
from tempfile import NamedTemporaryFile

from flask import Flask, jsonify, request

from runform import pipeline


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
            return jsonify(report=analysis.report)
        except ValueError as exc:
            return jsonify(error=str(exc)), 422
        finally:
            tmp_path.unlink(missing_ok=True)

    return app
