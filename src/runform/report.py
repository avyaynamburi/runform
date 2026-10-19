"""Frame count reports."""

import numpy as np

from runform.landmarks import Landmarks


def build_report(
    landmarks: Landmarks, strikes_detected: int, cadence_spm: float | None,
    trunk_lean_deg: np.ndarray,
) -> dict[str, float | int | None]:
    return {
        "fps": float(landmarks.fps),
        "frames_total": len(landmarks.data),
        "frames_with_pose": int(np.isfinite(landmarks.data).all(axis=(1, 2)).sum()),
        "strikes_detected": strikes_detected,
        "cadence_spm": round(cadence_spm, 1) if cadence_spm is not None else None,
        "trunk_lean_deg": (
            round(float(np.nanmean(trunk_lean_deg)), 1)
            if not np.isnan(trunk_lean_deg).all() else None
        ),
    }
