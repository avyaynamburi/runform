"""Running form angles from normalized pose coordinates."""

import numpy as np

from runform.landmarks import Landmarks


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
