import json
import warnings

import numpy as np
import pytest

from runform.cli import main


def test_analyze_report(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(10, 25.0)
    landmarks.data[3:5] = np.nan
    frames = [object() for _ in range(10)]
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: (frames, 25.0))

    def extract(actual_frames, fps, model=None):
        assert actual_frames is frames
        assert fps == 25.0
        assert model is None
        return landmarks

    monkeypatch.setattr("runform.pipeline.extract_landmarks", extract)
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    assert json.loads(output.read_text()) == {
        "fps": 25.0, "frames_total": 10, "frames_with_pose": 8,
        "strikes_detected": 0, "cadence_spm": None,
        "trunk_lean_deg": 0.0,
        "knee_flexion_at_strike_deg": None,
        "vertical_oscillation_rel": None,
        "warnings": [],
    }
    summary = capsys.readouterr().out
    assert "FPS: 25" in summary
    assert "frames total: 10" in summary
    assert "frames with pose: 8" in summary
    assert "Cadence: unavailable" in summary
    assert "Trunk lean: 0.0 deg" in summary
    assert "Knee at strike: unavailable" in summary
    assert "Vertical oscillation: unavailable" in summary


def test_analyze_vertical_oscillation(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(300, 30, cadence_spm=170, hip_amp=0.015)
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    value = json.loads(output.read_text())["vertical_oscillation_rel"]
    assert value == pytest.approx(0.05, rel=0.1)
    assert value == round(value, 3)
    assert f"Vertical oscillation: {value} of body height" in capsys.readouterr().out


def test_analyze_knee_at_strike(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(300, 30, cadence_spm=170, knee_deg=165, aspect=720 / 1008)
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    knee = json.loads(output.read_text())["knee_flexion_at_strike_deg"]
    assert knee["mean"] == pytest.approx(165, abs=2)
    assert knee["std"] < 2
    assert all(value == round(value, 1) for value in knee.values())
    assert f"Knee at strike: {knee['mean']} +/- {knee['std']} deg" in capsys.readouterr().out


def test_analyze_invalid_strike_knees(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(300, 30, cadence_spm=170)
    landmarks.data[:, [25, 26], :2] = np.nan
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        main(["analyze", "x.mp4", "--out", str(output)])
    report = json.loads(output.read_text())
    assert report["strikes_detected"] > 0
    assert report["knee_flexion_at_strike_deg"] is None
    assert "Knee at strike: unavailable" in capsys.readouterr().out


def test_analyze_cadence(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(300, 30, cadence_spm=170)
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    report = json.loads(output.read_text())
    assert abs(report["cadence_spm"] - 170) <= 3
    assert 27 <= report["strikes_detected"] <= 29
    assert report["cadence_spm"] == round(report["cadence_spm"], 1)
    assert f"Cadence: {report['cadence_spm']} spm" in capsys.readouterr().out


def test_analyze_cadence_double_bump(monkeypatch, tmp_path, make_landmarks):
    landmarks = make_landmarks(300, 30, cadence_spm=170, double_bump=True)
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    report = json.loads(output.read_text())
    assert abs(report["cadence_spm"] - 170) <= 3


def test_analyze_trunk_lean(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(10, 30, lean_deg=10, aspect=720 / 1008)
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    report = json.loads(output.read_text())
    assert report["trunk_lean_deg"] == pytest.approx(10, abs=1)
    assert f"Trunk lean: {report['trunk_lean_deg']} deg" in capsys.readouterr().out


@pytest.mark.parametrize("n_frames", [0, 10])
def test_analyze_no_pose_trunk_lean(monkeypatch, tmp_path, make_landmarks, capsys, n_frames):
    landmarks = make_landmarks(n_frames, 30)
    landmarks.data[:] = np.nan
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        main(["analyze", "x.mp4", "--out", str(output)])
    assert json.loads(output.read_text())["trunk_lean_deg"] is None
    assert "Trunk lean: unavailable" in capsys.readouterr().out


@pytest.mark.parametrize("dropout", [0.1, 0.3])
def test_analyze_noise_and_dropout(
    monkeypatch, tmp_path, make_landmarks, capsys, dropout,
):
    landmarks = make_landmarks(300, 30, cadence_spm=170, noise=0.005, dropout=dropout)
    monkeypatch.setattr("runform.pipeline.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.pipeline.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    report = json.loads(output.read_text())
    assert abs(report["cadence_spm"] - 170) <= 3
    assert report["frames_total"] == 300
    assert report["frames_with_pose"] == 300 - round(dropout * 300)
    summary = capsys.readouterr().out
    if dropout == 0.1:
        assert report["warnings"] == []
        assert "Warning:" not in summary
    else:
        message = "Pose detected in only 70% of frames; metrics may be unreliable"
        assert report["warnings"] == [message]
        assert summary.endswith(f"Warning: {message}\n")


@pytest.mark.parametrize(
    ("options", "host", "port", "model_name"),
    [
        ([], "127.0.0.1", 8000, None),
        (["--host", "0.0.0.0", "--port", "9000", "--model", "pose.task"],
         "0.0.0.0", 9000, "pose.task"),
    ],
)
def test_serve(monkeypatch, capsys, options, host, port, model_name):
    from pathlib import Path

    calls = []

    class App:
        def run(self, **kwargs):
            calls.append(kwargs)

    def create_app(model):
        assert model == (Path(model_name) if model_name else None)
        return App()

    monkeypatch.setattr("runform.cli.create_app", create_app)
    main(["serve", *options])
    assert calls == [{"host": host, "port": port}]
    assert capsys.readouterr().out == f"Running Form Analyzer at http://{host}:{port}\n"
