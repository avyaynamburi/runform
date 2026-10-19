"""Shared synthetic standing poses."""

import numpy as np
import pytest

from runform.landmarks import Landmarks


@pytest.fixture
def make_landmarks():
    def make(n_frames, fps, cadence_spm=None, noise=0.0, seed=0, double_bump=False):
        pose = np.full((33, 3), (0.5, 0.5, 1.0))
        for left, right, height in [(11, 12, 0.3), (23, 24, 0.5), (25, 26, 0.7), (27, 28, 0.9)]:
            pose[left] = (0.4, height, 1.0)
            pose[right] = (0.6, height, 1.0)
        data = np.repeat(pose[None], n_frames, axis=0)
        if cadence_spm is not None:
            t = np.arange(n_frames) / fps
            stride_seconds = 2 * 60 / cadence_spm
            for heel, phase in [(29, 0), (30, np.pi)]:
                data[:, heel, 1] = (
                    0.92 + 0.04 * np.sin(2 * np.pi * (cadence_spm / 2 / 60) * t + phase)
                )
                if double_bump:
                    first_peak = (np.pi / 2 - phase) / (2 * np.pi) * stride_seconds
                    for peak in np.arange(first_peak, t[-1] + stride_seconds, stride_seconds):
                        data[:, heel, 1] += 0.06 * np.exp(
                            -0.5 * ((t - (peak + 0.3)) / 0.03) ** 2
                        )
        data[:, :, :2] += np.random.default_rng(seed).normal(
            0, noise, size=(n_frames, 33, 2)
        )
        return Landmarks(data, fps)

    return make
