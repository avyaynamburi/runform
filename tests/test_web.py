import io
from pathlib import Path

import numpy as np
import pytest

from runform.web import create_app


def test_index_and_static():
    client = create_app().test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert response.mimetype == "text/html"
    assert b'type="file"' in response.data
    for element_id in (
        "title-card", "letterbox-top", "letterbox-bottom", "lower-third",
        "control-bar", "fullscreen-btn", "close-btn",
    ):
        assert f'id="{element_id}"'.encode() in response.data
    assert b'id="chart-panel"' not in response.data
    assert client.get("/static/app.js").status_code == 200


def test_analyze_upload(monkeypatch, make_landmarks):
    landmarks = make_landmarks(
        300, 30, cadence_spm=170, hip_amp=0.015, knee_deg=165, aspect=720 / 1008,
    )
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
    knee = response.json["series"]["knee_at_strike_deg"]
    assert len(knee) == len(response.json["strikes"])
    assert knee == pytest.approx([165] * len(knee), abs=2)
    hips = response.json["series"]["hip_height_rel"]
    assert len(hips) == 300
    assert max(hips) - min(hips) == pytest.approx(.05, rel=.1)
    strides = response.json["strides"]
    assert strides
    for stride in strides:
        assert stride["start"] <= stride["top"] <= stride["end"]
        assert stride["start"] <= stride["bottom"] <= stride["end"]
        assert stride["value"] == pytest.approx(.05, rel=.1)
    pose = response.json["pose"]
    assert pose["fps"] == 30
    assert pose["aspect"] == 720 / 1008
    assert len(pose["frames"]) == 300
    assert len(pose["frames"][0]) == 33
    assert len(pose["frames"][0][11]) == 2
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


def test_analyze_pose_missing_points_and_rounding(monkeypatch, make_landmarks):
    from runform.pipeline import Analysis

    clean = make_landmarks(3, 30, aspect=720 / 1008)
    clean.data[0] = np.nan
    clean.data[1, 11, 0] = np.nan
    clean.data[1, 12, 1] = np.nan
    clean.data[1, 13] = [0.1234567, 0.7654321, np.nan]
    clean.data[2, 14] = [0.9876543, 0.1111111, 0.9]
    report = {"warnings": [], "frames_total": 3}
    monkeypatch.setattr(
        "runform.pipeline.analyze", lambda *args, **kwargs:
        Analysis(report, clean, clean, []),
    )
    response = create_app().test_client().post(
        "/api/analyze", data={"video": (io.BytesIO(b"fake"), "run.mp4")},
    )
    assert response.status_code == 200
    assert response.json["report"] == report
    pose = response.json["pose"]
    assert pose["fps"] == 30
    assert pose["aspect"] == 720 / 1008
    assert len(pose["frames"]) == 3
    assert pose["frames"][0] is None
    assert pose["frames"][1][11] is None
    assert pose["frames"][1][12] is None
    assert pose["frames"][1][13] == [0.1235, 0.7654]
    assert pose["frames"][2][14] == [0.9877, 0.1111]


def test_analyze_measurement_tour(monkeypatch, make_landmarks):
    from runform.gait import Strike
    from runform.pipeline import Analysis

    clean = make_landmarks(5, 30, lean_deg=10, aspect=720 / 1008)
    clean.data[2] = np.nan
    clean.data[1, 25, :2] = np.nan
    strikes = [Strike(1, "left"), Strike(4, "right")]
    analysis = Analysis({"warnings": []}, clean, clean, strikes)
    monkeypatch.setattr("runform.pipeline.analyze", lambda *args, **kwargs: analysis)
    response = create_app().test_client().post(
        "/api/analyze", data={"video": (io.BytesIO(b"fake"), "run.mp4")},
    )
    assert response.status_code == 200
    assert response.json["strikes"] == [
        {"frame": strike.frame, "foot": strike.foot} for strike in analysis.strikes
    ]
    series = response.json["series"]["trunk_lean_deg"]
    assert len(series) == len(clean.data)
    assert series[2] is None
    assert [value for value in series if value is not None] == pytest.approx([10] * 4)

    hips = response.json["series"]["hip_height_rel"]
    assert len(hips) == len(clean.data)
    assert hips[2] is None
    assert [value for value in hips if value is not None] == [0] * 4

    knees = response.json["series"]["knee_at_strike_deg"]
    assert len(knees) == len(strikes)
    assert knees[0] is None
    assert knees[1] == pytest.approx(180)
