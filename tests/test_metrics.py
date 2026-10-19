import warnings

import numpy as np
import pytest

from runform.gait import Strike
from runform.metrics import (
    facing_sign,
    joint_angle,
    knee_flexion_at_strikes,
    trunk_lean,
    vertical_oscillation,
)


def test_vertical_oscillation_stride_windows(make_landmarks):
    landmarks = make_landmarks(9, 30, aspect=0.5)
    landmarks.data[:, [23, 24], 1] = np.array(
        [0.5, 0.51, 0.52, 0.51, 0.5, 0.54, 0.56, 0.54, 0.5]
    )[:, None]
    strikes = [
        Strike(8, "left"), Strike(0, "right"), Strike(0, "left"),
        Strike(4, "left"), Strike(4, "right"),
    ]
    np.testing.assert_allclose(
        vertical_oscillation(landmarks, strikes), np.array([0.02, 0.06, 0.02]) / 0.6,
    )


@pytest.mark.parametrize("strikes", [[], [Strike(0, "left"), Strike(4, "right")]])
def test_vertical_oscillation_no_strides(make_landmarks, strikes):
    assert vertical_oscillation(make_landmarks(5, 30), strikes).shape == (0,)


@pytest.mark.parametrize("height", [np.nan, 0.0, -0.1])
def test_vertical_oscillation_invalid_height(make_landmarks, height):
    landmarks = make_landmarks(5, 30)
    landmarks.data[:, [27, 28], 1] = 0.3 + height
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        assert vertical_oscillation(
            landmarks, [Strike(0, "left"), Strike(4, "left")],
        ).shape == (0,)


def test_vertical_oscillation_missing_hips(make_landmarks):
    landmarks = make_landmarks(5, 30)
    landmarks.data[:3, [23, 24], 1] = np.nan
    landmarks.data[4, [23, 24], 1] = 0.56
    strikes = [Strike(0, "left"), Strike(2, "left"), Strike(4, "left")]
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        np.testing.assert_allclose(vertical_oscillation(landmarks, strikes), [0.1])


def test_joint_angle():
    a = np.array([[1, 0], [0, 0], [0, 0]])
    b = np.array([[0, 0], [0, 1], [1, 1]])
    c = np.array([[0, 1], [0, 2], [2, 0]])
    np.testing.assert_allclose(joint_angle(a, b, c), [90, 180, 90])
    assert joint_angle(a, b, c, aspect=0.5)[2] == pytest.approx(53.13010235)


def test_joint_angle_invalid_without_warnings():
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        angles = joint_angle(
            np.array([[np.nan, 0], [0, 0]]), np.zeros((2, 2)), np.ones((2, 2)),
        )
    assert np.isnan(angles).all()


def test_knee_flexion_uses_landing_leg(make_landmarks):
    landmarks = make_landmarks(2, 30, aspect=720 / 1008)
    for knee, angle in [(25, 150), (26, 170)]:
        landmarks.data[:, knee, 0] += (
            0.2 * np.tan(np.radians((180 - angle) / 2)) / landmarks.aspect
        )
    strikes = [Strike(0, "left"), Strike(1, "right")]
    np.testing.assert_allclose(knee_flexion_at_strikes(landmarks, strikes), [150, 170])
    landmarks.data[0, 25, :2] = np.nan
    np.testing.assert_allclose(knee_flexion_at_strikes(landmarks, strikes), [170])
    landmarks.data[1, 26, :2] = np.nan
    assert knee_flexion_at_strikes(landmarks, strikes).shape == (0,)
    assert knee_flexion_at_strikes(landmarks, []).shape == (0,)


def test_upright_trunk(make_landmarks):
    np.testing.assert_allclose(trunk_lean(make_landmarks(10, 30)), 0)


def test_missing_frame(make_landmarks):
    landmarks = make_landmarks(3, 30, lean_deg=10)
    landmarks.data[1] = np.nan
    lean = trunk_lean(landmarks)
    assert np.isnan(lean[1])
    np.testing.assert_allclose(lean[[0, 2]], 10)


def test_mirrored_trunk(make_landmarks):
    landmarks = make_landmarks(10, 30, lean_deg=10, aspect=720 / 1008)
    assert facing_sign(landmarks) == 1
    np.testing.assert_allclose(trunk_lean(landmarks), 10)
    landmarks.data[:, :, 0] = 1 - landmarks.data[:, :, 0]
    assert facing_sign(landmarks) == -1
    np.testing.assert_allclose(trunk_lean(landmarks), 10)


def test_aspect_changes_angle(make_landmarks):
    landmarks = make_landmarks(10, 30, lean_deg=10)
    np.testing.assert_allclose(trunk_lean(landmarks), 10)
    landmarks.aspect = 0.5
    expected = np.degrees(np.arctan(np.tan(np.radians(10)) * 0.5))
    np.testing.assert_allclose(trunk_lean(landmarks), expected)
    assert expected != pytest.approx(10)


@pytest.mark.parametrize("offset", [0.0, np.nan])
def test_facing_defaults_forward(make_landmarks, offset):
    landmarks = make_landmarks(3, 30)
    landmarks.data[:, [31, 32], 0] = landmarks.data[:, [29, 30], 0] + offset
    assert facing_sign(landmarks) == 1


def test_empty_landmarks(make_landmarks):
    landmarks = make_landmarks(0, 30)
    assert facing_sign(landmarks) == 1
    assert trunk_lean(landmarks).shape == (0,)
