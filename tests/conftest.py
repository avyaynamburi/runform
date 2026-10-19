"""Shared synthetic standing poses."""

import numpy as np
import pytest

from runform.landmarks import Landmarks


@pytest.fixture
def make_landmarks():
    def make(n_frames, fps, cadence_spm=None, noise=0.0, seed=0):
        pose = np.full((33, 3), (0.5, 0.5, 1.0))
        for left, right, height in [(11, 12, 0.3), (23, 24, 0.5), (25, 26, 0.7), (27, 28, 0.9)]:
            pose[left] = (0.4, height, 1.0)
            pose[right] = (0.6, height, 1.0)
        data = np.repeat(pose[None], n_frames, axis=0)
        if cadence_spm is not None:
            t = np.arange(n_frames) / fps
            for heel, phase in [(29, 0), (30, np.pi)]:
                data[:, heel, 1] = (
                    0.92 + 0.04 * np.sin(2 * np.pi * (cadence_spm / 2 / 60) * t + phase)
                )
        data[:, :, :2] += np.random.default_rng(seed).normal(
            0, noise, size=(n_frames, 33, 2)
        )
        return Landmarks(data, fps)

    return make
