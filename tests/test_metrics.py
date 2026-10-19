import numpy as np
import pytest

from runform.metrics import facing_sign, trunk_lean


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
