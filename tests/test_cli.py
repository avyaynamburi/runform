import json

import numpy as np

from runform.cli import main


def test_analyze_report(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(10, 25.0)
    landmarks.data[3:5] = np.nan
    frames = [object() for _ in range(10)]
    monkeypatch.setattr("runform.cli.read_frames", lambda path: (frames, 25.0))

    def extract(actual_frames, fps, model=None):
        assert actual_frames is frames
        assert fps == 25.0
        assert model is None
        return landmarks

    monkeypatch.setattr("runform.cli.extract_landmarks", extract)
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    assert json.loads(output.read_text()) == {
        "fps": 25.0, "frames_total": 10, "frames_with_pose": 8,
        "strikes_detected": 0, "cadence_spm": None,
    }
    summary = capsys.readouterr().out
    assert "FPS: 25" in summary
    assert "frames total: 10" in summary
    assert "frames with pose: 8" in summary
    assert "Cadence: unavailable" in summary


def test_analyze_cadence(monkeypatch, tmp_path, make_landmarks, capsys):
    landmarks = make_landmarks(300, 30, cadence_spm=170)
    monkeypatch.setattr("runform.cli.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.cli.extract_landmarks", lambda frames, fps, model=None: landmarks
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
    monkeypatch.setattr("runform.cli.read_frames", lambda path: ([], 30))
    monkeypatch.setattr(
        "runform.cli.extract_landmarks", lambda frames, fps, model=None: landmarks
    )
    output = tmp_path / "report.json"
    main(["analyze", "x.mp4", "--out", str(output)])
    report = json.loads(output.read_text())
    assert abs(report["cadence_spm"] - 170) <= 3
