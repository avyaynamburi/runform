"""Read video frames in BGR order."""

from pathlib import Path

import cv2
import numpy as np


def read_frames(path: str | Path) -> tuple[list[np.ndarray], float]:
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise ValueError(f"Cannot open video: {path}")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        if not np.isfinite(fps) or fps <= 0:
            raise ValueError(f"Video has invalid fps: {fps}")
        frames = []
        while True:
            success, frame = capture.read()
            if not success:
                break
            frames.append(frame)
        return frames, fps
    finally:
        capture.release()
