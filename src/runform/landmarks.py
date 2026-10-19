"""Pose coordinates and their video sampling rate."""

from dataclasses import dataclass

import numpy as np


@dataclass
class Landmarks:
    """Normalized x, y, visibility with shape (T, 33, 3); missing poses are NaN."""

    data: np.ndarray
    fps: float
