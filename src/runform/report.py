"""Frame count reports."""

import numpy as np

from runform.landmarks import Landmarks


def build_report(
    landmarks: Landmarks, strikes_detected: int, cadence_spm: float | None,
    trunk_lean_deg: np.ndarray,
    knee_flexion_at_strike_deg: np.ndarray,
    vertical_oscillation_rel: np.ndarray,
    warnings: list[str],
) -> dict[str, float | int | dict[str, float] | list[str] | None]:
    return {
        "warnings": warnings,
        "fps": float(landmarks.fps),
        "frames_total": len(landmarks.data),
        "frames_with_pose": int(np.isfinite(landmarks.data).all(axis=(1, 2)).sum()),
        "strikes_detected": strikes_detected,
        "cadence_spm": round(cadence_spm, 1) if cadence_spm is not None else None,
        "trunk_lean_deg": (
            round(float(np.nanmean(trunk_lean_deg)), 1)
            if not np.isnan(trunk_lean_deg).all() else None
        ),
        "knee_flexion_at_strike_deg": (
            {
                "mean": round(float(np.mean(knee_flexion_at_strike_deg)), 1),
                "std": round(float(np.std(knee_flexion_at_strike_deg, ddof=0)), 1),
            } if len(knee_flexion_at_strike_deg) else None
        ),
        "vertical_oscillation_rel": (
            round(float(np.mean(vertical_oscillation_rel)), 3)
            if len(vertical_oscillation_rel) else None
        ),
    }
