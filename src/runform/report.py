"""Frame count reports."""

import numpy as np

from runform.landmarks import Landmarks


def build_report(
    landmarks: Landmarks, strikes_detected: int, cadence_spm: float | None
) -> dict[str, float | int | None]:
    return {
        "fps": float(landmarks.fps),
        "frames_total": len(landmarks.data),
        "frames_with_pose": int(np.isfinite(landmarks.data).all(axis=(1, 2)).sum()),
        "strikes_detected": strikes_detected,
        "cadence_spm": round(cadence_spm, 1) if cadence_spm is not None else None,
    }
