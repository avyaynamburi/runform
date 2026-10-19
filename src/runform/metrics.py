"""Running form angles from normalized pose coordinates."""

from dataclasses import dataclass

import numpy as np

from runform.gait import Strike
from runform.landmarks import Landmarks


@dataclass
class Stride:
    foot: str
    start: int
    end: int
    top: int
    bottom: int
    value: float


def oscillation_strides(lm: Landmarks, strikes: list[Strike]) -> list[Stride]:
    shoulder_y = lm.data[:, [11, 12], 1].mean(axis=1)
    ankle_y = lm.data[:, [27, 28], 1].mean(axis=1)
    heights = ankle_y - shoulder_y
    heights = heights[np.isfinite(heights)]
    if not len(heights):
        return []
    body_height = float(np.median(heights))
    if body_height <= 0:
        return []

    hip_y = lm.data[:, [23, 24], 1].mean(axis=1)
    values = []
    for foot in ("left", "right"):
        frames = sorted(strike.frame for strike in strikes if strike.foot == foot)
        for a, b in zip(frames, frames[1:], strict=False):
            window = hip_y[a:b + 1]
            if np.isfinite(window).any():
                window = np.where(np.isfinite(window), window, np.nan)
                top, bottom = int(np.nanargmin(window)), int(np.nanargmax(window))
                values.append(Stride(
                    foot, a, b, a + top, a + bottom,
                    float((window[bottom] - window[top]) / body_height),
                ))
    return values


def vertical_oscillation(lm: Landmarks, strikes: list[Strike]) -> np.ndarray:
    return np.asarray([s.value for s in oscillation_strides(lm, strikes)])


def joint_angle(
    a: np.ndarray, b: np.ndarray, c: np.ndarray, aspect: float = 1.0,
) -> np.ndarray:
    scale = np.array([aspect, 1.0])
    ab = (np.asarray(a) - np.asarray(b)) * scale
    cb = (np.asarray(c) - np.asarray(b)) * scale
    denominator = np.linalg.norm(ab, axis=-1) * np.linalg.norm(cb, axis=-1)
    cosine = np.full(np.broadcast_shapes(ab.shape[:-1], cb.shape[:-1]), np.nan)
    np.divide(np.sum(ab * cb, axis=-1), denominator, out=cosine, where=denominator > 0)
    return np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))


def knee_flexion_at_strikes(lm: Landmarks, strikes: list[Strike]) -> np.ndarray:
    angles = []
    for strike in strikes:
        indices = (23, 25, 27) if strike.foot == "left" else (24, 26, 28)
        hip, knee, ankle = lm.data[strike.frame, indices, :2]
        angles.append(joint_angle(hip, knee, ankle, aspect=lm.aspect))
    angles = np.asarray(angles)
    return angles[~np.isnan(angles)]


def facing_sign(lm: Landmarks) -> int:
    offsets = lm.data[:, [31, 32], 0] - lm.data[:, [29, 30], 0]
    if np.isnan(offsets).all():
        return 1
    median = np.nanmedian(offsets)
    return -1 if median < 0 else 1


def trunk_lean(lm: Landmarks) -> np.ndarray:
    shoulders = lm.data[:, [11, 12], :2].mean(axis=1)
    hips = lm.data[:, [23, 24], :2].mean(axis=1)
    dx = (shoulders[:, 0] - hips[:, 0]) * lm.aspect * facing_sign(lm)
    dy = hips[:, 1] - shoulders[:, 1]
    return np.degrees(np.arctan2(dx, dy))
