import numpy as np
import pytest

from runform.gait import Strike, cadence, detect_foot_strikes


@pytest.mark.parametrize("noise", [0.0, 0.005])
def test_running_strikes(make_landmarks, noise):
    strikes = detect_foot_strikes(make_landmarks(300, 30, cadence_spm=170, noise=noise))
    assert 27 <= len(strikes) <= 29
    assert all(a.frame < b.frame for a, b in zip(strikes, strikes[1:], strict=False))
    assert all(a.foot != b.foot for a, b in zip(strikes, strikes[1:], strict=False))
    assert {strike.foot for strike in strikes} == {"left", "right"}
    assert abs(cadence(strikes, 30) - 170) <= 3


def test_static_pose(make_landmarks):
    assert detect_foot_strikes(make_landmarks(300, 30)) == []
    assert cadence([], 30) is None
    assert cadence([Strike(10, "left")], 30) is None


def test_missing_heel_frames(make_landmarks):
    landmarks = make_landmarks(300, 30, cadence_spm=170)
    landmarks.data[40:43, 29, 1] = np.nan
    landmarks.data[:, 30, 1] = np.nan
    strikes = detect_foot_strikes(landmarks)
    assert 13 <= len(strikes) <= 15
    assert all(strike.foot == "left" for strike in strikes)
    assert abs(cadence(strikes, 30) - 170) <= 3


def test_no_pose(make_landmarks):
    landmarks = make_landmarks(300, 30)
    landmarks.data[:] = np.nan
    assert detect_foot_strikes(landmarks) == []


def test_double_heel_peaks(make_landmarks):
    landmarks = make_landmarks(300, 30, cadence_spm=170, double_bump=True)
    assert abs(cadence(detect_foot_strikes(landmarks), 30) - 170) <= 3


def test_cadence_requires_same_foot_interval():
    assert cadence([Strike(0, "left"), Strike(10, "right")], 30) is None


def test_cadence_uses_median_same_foot_intervals():
    strikes = [
        Strike(0, "left"), Strike(10, "right"), Strike(20, "left"),
        Strike(30, "right"), Strike(40, "left"), Strike(45, "left"),
        Strike(50, "right"), Strike(60, "left"),
    ]
    assert cadence(strikes, 30) == 180
