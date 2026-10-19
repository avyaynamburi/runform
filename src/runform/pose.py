"""Extract poses using MediaPipe Tasks."""

from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from runform.landmarks import Landmarks

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)


def extract_landmarks(
    frames: list[np.ndarray], fps: float, model: str | Path | None = None
) -> Landmarks:
    if not np.isfinite(fps) or fps <= 0:
        raise ValueError("fps must be positive and finite")
    model_path = Path(model) if model is not None else (
        Path.home() / ".cache/runform/pose_landmarker_full.task"
    )
    if model is None and not model_path.exists():
        model_path.parent.mkdir(parents=True, exist_ok=True)
        urlretrieve(MODEL_URL, model_path)
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
    )
    data = np.full((len(frames), 33, 3), np.nan)
    previous_timestamp = -1
    with vision.PoseLandmarker.create_from_options(options) as detector:
        for index, frame in enumerate(frames):
            timestamp = max(previous_timestamp + 1, round(index * 1000 / fps))
            previous_timestamp = timestamp
            image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
            )
            result = detector.detect_for_video(image, timestamp)
            if result.pose_landmarks:
                data[index] = [(p.x, p.y, p.visibility) for p in result.pose_landmarks[0]]
    return Landmarks(data=data, fps=fps)
