import io
from pathlib import Path

import pytest

from runform.web import create_app


def test_index_and_static():
    client = create_app().test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert response.mimetype == "text/html"
    assert b'type="file"' in response.data
    assert client.get("/static/app.js").status_code == 200


def test_analyze_upload(monkeypatch, make_landmarks):
    landmarks = make_landmarks(300, 30, cadence_spm=170, hip_amp=0.015)
    paths = []
    model = Path("custom.task")
    frames = [object()]

    def read_frames(path):
        paths.append(path)
        assert path.suffix == ".mp4"
        assert path.read_bytes() == b"fake video"
        return frames, 30

    def extract_landmarks(actual_frames, fps, model=None):
        assert actual_frames is frames
        assert fps == 30
        assert model == Path("custom.task")
        return landmarks

    monkeypatch.setattr("runform.pipeline.read_frames", read_frames)
    monkeypatch.setattr("runform.pipeline.extract_landmarks", extract_landmarks)
    response = create_app(model).test_client().post(
        "/api/analyze", data={"video": (io.BytesIO(b"fake video"), "run.mp4")},
    )
    assert response.status_code == 200
    report = response.json["report"]
    assert report["cadence_spm"] == pytest.approx(170, abs=3)
    assert report["trunk_lean_deg"] == pytest.approx(0)
    assert report["knee_flexion_at_strike_deg"]["mean"] is not None
    assert report["vertical_oscillation_rel"] == pytest.approx(0.05, abs=0.005)
    assert report["frames_with_pose"] == report["frames_total"] == 300
    assert report["warnings"] == []
    assert len(paths) == 1
    assert not paths[0].exists()


@pytest.mark.parametrize("filename", [None, ""])
def test_missing_video(filename):
    data = {} if filename is None else {"video": (io.BytesIO(b""), filename)}
    response = create_app().test_client().post("/api/analyze", data=data)
    assert response.status_code == 400
    assert response.json["error"]


def test_invalid_video_cleanup(monkeypatch):
    paths = []

    def read_frames(path):
        paths.append(path)
        assert path.exists()
        raise ValueError("Cannot open video")

    monkeypatch.setattr("runform.pipeline.read_frames", read_frames)
    response = create_app().test_client().post(
        "/api/analyze", data={"video": (io.BytesIO(b"invalid"), "bad.avi")},
    )
    assert response.status_code == 422
    assert response.json == {"error": "Cannot open video"}
    assert len(paths) == 1
    assert not paths[0].exists()


def test_unexpected_failure_cleanup(monkeypatch):
    paths = []

    def read_frames(path):
        paths.append(path)
        raise RuntimeError("Unexpected failure")

    monkeypatch.setattr("runform.pipeline.read_frames", read_frames)
    app = create_app()
    app.config["TESTING"] = True
    with pytest.raises(RuntimeError, match="Unexpected failure"):
        app.test_client().post(
            "/api/analyze", data={"video": (io.BytesIO(b"invalid"), "bad.mp4")},
        )
    assert len(paths) == 1
    assert not paths[0].exists()


def test_upload_limit():
    assert create_app().config["MAX_CONTENT_LENGTH"] == 300 * 1024 * 1024
