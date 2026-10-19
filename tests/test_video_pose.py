from pathlib import Path

import cv2
import numpy as np
import pytest

from runform.video import read_frames


@pytest.fixture
def blank_video(tmp_path):
    path = tmp_path / "blank.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 25, (64, 64))
    if not writer.isOpened():
        pytest.skip("MJPG video writer unavailable")
    try:
        for _ in range(10):
            writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
    finally:
        writer.release()
    return path


def test_read_frames(blank_video):
    frames, fps = read_frames(blank_video)
    assert len(frames) == 10
    assert fps == pytest.approx(25)
    assert all(frame.shape == (64, 64, 3) for frame in frames)


def test_pose_missing_frames(blank_video):
    pytest.importorskip("mediapipe")
    from runform.pose import extract_landmarks

    model = Path.home() / ".cache/runform/pose_landmarker_full.task"
    if not model.is_file():
        pytest.skip("Pose model is not cached; tests do not download models")
    frames, fps = read_frames(blank_video)
    landmarks = extract_landmarks(frames, fps, model=model)
    assert landmarks.fps == fps
    assert landmarks.data.shape == (10, 33, 3)
    assert np.isnan(landmarks.data).all()
