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
    }
    summary = capsys.readouterr().out
    assert "FPS: 25" in summary
    assert "frames total: 10" in summary
    assert "frames with pose: 8" in summary
