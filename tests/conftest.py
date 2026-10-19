"""Shared synthetic standing poses."""

import numpy as np
import pytest

from runform.landmarks import Landmarks


@pytest.fixture
def make_landmarks():
    def make(n_frames, fps):
        pose = np.full((33, 3), (0.5, 0.5, 1.0))
        for left, right, height in [(11, 12, 0.3), (23, 24, 0.5), (25, 26, 0.7), (27, 28, 0.9)]:
            pose[left] = (0.4, height, 1.0)
            pose[right] = (0.6, height, 1.0)
        return Landmarks(np.repeat(pose[None], n_frames, axis=0), fps)

    return make
