import numpy as np
import pytest
from scipy.signal import savgol_filter

from runform.smoothing import fill_gaps, smooth


def test_fill_short_interior_gaps(make_landmarks):
    lm = make_landmarks(20, 30)
    ramp = np.arange(20, dtype=float)
    lm.data[:] = ramp[:, None, None]
    lm.data[2:5] = np.nan
    lm.data[8:14] = np.nan
    lm.data[:1] = np.nan
    lm.data[-2:] = np.nan
    filled = fill_gaps(lm)
    np.testing.assert_allclose(filled.data[2:5], np.broadcast_to(
        ramp[2:5, None, None], (3, 33, 3),
    ))
    assert np.isnan(filled.data[8:14]).all()
    assert np.isnan(filled.data[:1]).all()
    assert np.isnan(filled.data[-2:]).all()
    assert np.isnan(fill_gaps(lm, max_gap=2).data[2:5]).all()


def test_smooth_reduces_noise(make_landmarks):
    lm = make_landmarks(3000, 100, noise=0.01)
    cleaned = smooth(lm)
    assert cleaned.data[:, 0, 0].std() <= lm.data[:, 0, 0].std() / 2
    np.testing.assert_array_equal(cleaned.data[:, :, 2], lm.data[:, :, 2])


def test_smooth_preserves_step_bounce(make_landmarks):
    lm = make_landmarks(300, 30)
    signal = np.sin(2 * np.pi * 2.83 * np.arange(300) / 30)
    lm.data[:, 0, 1] = signal
    cleaned = smooth(lm)
    assert np.ptp(cleaned.data[10:-10, 0, 1]) >= 0.95 * np.ptp(signal[10:-10])


@pytest.mark.parametrize("fps, window", [(30, 5), (40, 7), (60, 9), (100, 15)])
def test_smooth_finite_runs_and_window(make_landmarks, fps, window):
    lm = make_landmarks(50, fps, noise=0.01)
    lm.data[20:26, 0, 0] = np.nan
    lm.data[30:, 0, 0] = np.nan
    cleaned = smooth(lm)
    np.testing.assert_allclose(
        cleaned.data[:20, 0, 0], savgol_filter(lm.data[:20, 0, 0], window, 2),
    )
    np.testing.assert_array_equal(cleaned.data[20:, 0, 0], lm.data[20:, 0, 0])


@pytest.mark.parametrize("operation", [fill_gaps, smooth])
@pytest.mark.parametrize("n_frames", [0, 3, 50])
def test_preserves_input_and_metadata(make_landmarks, operation, n_frames):
    lm = make_landmarks(n_frames, 30, noise=0.01, aspect=0.75)
    lm.data[1:3, 0, 0] = np.nan
    before = lm.data.copy()
    result = operation(lm)
    np.testing.assert_array_equal(lm.data, before)
    assert result is not lm
    assert not np.shares_memory(result.data, lm.data)
    assert result.fps == lm.fps
    assert result.aspect == lm.aspect
