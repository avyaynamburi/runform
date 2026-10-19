"""Frame count reports."""

import numpy as np

from runform.landmarks import Landmarks


def build_report(landmarks: Landmarks) -> dict[str, float | int]:
    return {
        "fps": float(landmarks.fps),
        "frames_total": len(landmarks.data),
        "frames_with_pose": int(np.isfinite(landmarks.data).all(axis=(1, 2)).sum()),
    }
