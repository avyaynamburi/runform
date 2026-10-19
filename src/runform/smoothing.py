"""Fill short detection gaps and smooth pose coordinates."""

import numpy as np
from scipy.signal import savgol_filter

from runform.landmarks import Landmarks


def fill_gaps(lm: Landmarks, max_gap: int = 5) -> Landmarks:
    data = lm.data.copy()
    for landmark in range(data.shape[1]):
        for coordinate in range(data.shape[2]):
            values = data[:, landmark, coordinate]
            missing = np.isnan(values)
            edges = np.flatnonzero(np.diff(np.r_[False, missing, False]))
            for start, stop in edges.reshape(-1, 2):
                if start > 0 and stop < len(values) and stop - start <= max_gap:
                    values[start:stop] = np.linspace(
                        values[start - 1], values[stop], stop - start + 2,
                    )[1:-1]
    return Landmarks(data, lm.fps, aspect=lm.aspect)


def smooth(lm: Landmarks) -> Landmarks:
    data = lm.data.copy()
    # At an exact tie, choose the larger odd window.
    window = max(5, 2 * int(0.15 * lm.fps / 2) + 1)
    for landmark in range(data.shape[1]):
        for coordinate in range(2):
            values = data[:, landmark, coordinate]
            finite = np.isfinite(values)
            edges = np.flatnonzero(np.diff(np.r_[False, finite, False]))
            for start, stop in edges.reshape(-1, 2):
                if stop - start >= window:
                    values[start:stop] = savgol_filter(
                        values[start:stop], window, polyorder=2,
                    )
    return Landmarks(data, lm.fps, aspect=lm.aspect)
