"""Heel strike detection and cadence."""

from dataclasses import dataclass

import numpy as np
from scipy.signal import find_peaks

from runform.landmarks import Landmarks


@dataclass
class Strike:
    frame: int
    foot: str


def detect_foot_strikes(lm: Landmarks) -> list[Strike]:
    shoulder_y = lm.data[:, [11, 12], 1].mean(axis=1)
    ankle_y = lm.data[:, [27, 28], 1].mean(axis=1)
    heights = ankle_y - shoulder_y
    heights = heights[np.isfinite(heights)]
    if not len(heights):
        return []
    body_height = float(np.median(heights))
    if body_height <= 0:
        return []

    # An odd window centers the average on a frame; edge padding avoids false peaks.
    width = max(1, round(0.1 * lm.fps))
    if width % 2 == 0:
        width += 1
    strikes = []
    for heel, foot in [(29, "left"), (30, "right")]:
        y = lm.data[:, heel, 1]
        valid = np.isfinite(y)
        if not valid.any():
            continue
        frames = np.arange(len(y))
        interpolated = np.interp(frames, frames[valid], y[valid])
        smoothed = np.convolve(
            np.pad(interpolated, width // 2, mode="edge"),
            np.ones(width) / width,
            mode="valid",
        )
        peaks, _ = find_peaks(
            smoothed, distance=max(1, 0.25 * lm.fps), prominence=0.02 * body_height
        )
        strikes.extend(Strike(int(frame), foot) for frame in peaks)
    return sorted(strikes, key=lambda strike: strike.frame)


def cadence(strikes: list[Strike], fps: float) -> float | None:
    if len(strikes) < 2:
        return None
    return (len(strikes) - 1) / ((strikes[-1].frame - strikes[0].frame) / fps) * 60
