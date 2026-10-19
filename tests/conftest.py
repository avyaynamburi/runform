"""Shared synthetic standing poses."""

import numpy as np
import pytest

from runform.landmarks import Landmarks


@pytest.fixture
def make_landmarks():
    def make(
        n_frames, fps, cadence_spm=None, noise=0.0, seed=0, double_bump=False,
        lean_deg=0.0, aspect=1.0, knee_deg=180.0, hip_amp=0.0, dropout=0.0,
    ):
        pose = np.full((33, 3), (0.5, 0.5, 1.0))
        for left, right, height in [(11, 12, 0.3), (23, 24, 0.5), (25, 26, 0.7), (27, 28, 0.9)]:
            pose[left] = (0.4, height, 1.0)
            pose[right] = (0.6, height, 1.0)
        for ankle, heel, foot_index in [(27, 29, 31), (28, 30, 32)]:
            pose[heel, 0] = pose[ankle, 0] - 0.01
            pose[foot_index] = (pose[ankle, 0] + 0.03, 0.93, 1.0)
        pose[[11, 12], 0] += np.tan(np.radians(lean_deg)) * (0.5 - 0.3) / aspect
        data = np.repeat(pose[None], n_frames, axis=0)
        data[:, [25, 26], 0] += 0.2 * np.tan(np.radians((180 - knee_deg) / 2)) / aspect
        if cadence_spm is not None:
            t = np.arange(n_frames) / fps
            stride_seconds = 2 * 60 / cadence_spm
            w = 2 * np.pi * (cadence_spm / 2 / 60)
            data[:, [11, 12, 23, 24], 1] += (hip_amp * np.sin(2 * w * t))[:, None]
            for heel, phase in [(29, 0), (30, np.pi)]:
                sine = np.sin(2 * np.pi * (cadence_spm / 2 / 60) * t + phase)
                angles = knee_deg - 20 * (1 - sine)
                knee = 25 if heel == 29 else 26
                data[:, knee, 0] = (
                    pose[knee, 0] + 0.2 * np.tan(np.radians((180 - angles) / 2)) / aspect
                )
                data[:, heel, 1] = (
                    0.92 + 0.04 * sine
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
        dropped = np.random.default_rng(seed).choice(
            n_frames, size=round(dropout * n_frames), replace=False,
        )
        data[dropped] = np.nan
        return Landmarks(data, fps, aspect=aspect)

    return make
