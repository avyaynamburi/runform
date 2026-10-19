import warnings

import numpy as np
import pytest

from runform.gait import Strike
from runform.metrics import facing_sign, joint_angle, knee_flexion_at_strikes, trunk_lean


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
