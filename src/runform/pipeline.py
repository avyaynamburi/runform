"""Shared video analysis pipeline."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from runform.gait import Strike, cadence, detect_foot_strikes
from runform.landmarks import Landmarks
from runform.metrics import knee_flexion_at_strikes, trunk_lean, vertical_oscillation
from runform.pose import extract_landmarks
from runform.report import build_report
from runform.smoothing import fill_gaps, smooth
from runform.video import read_frames


@dataclass
class Analysis:
    report: dict
    raw: Landmarks
    clean: Landmarks
    strikes: list[Strike]


def analyze(path: str | Path, model: str | Path | None = None) -> Analysis:
    frames, fps = read_frames(path)
    landmarks = extract_landmarks(frames, fps, model=model)
    clean = smooth(fill_gaps(landmarks))
    frames_total = len(landmarks.data)
    frames_with_pose = int(np.isfinite(landmarks.data).all(axis=(1, 2)).sum())
    warnings = []
    if frames_total > 0 and frames_with_pose / frames_total < 0.8:
        pct = 100 * frames_with_pose / frames_total
        warnings.append(
            f"Pose detected in only {pct:.0f}% of frames; metrics may be unreliable"
        )
    strikes = detect_foot_strikes(clean)
    report = build_report(
        landmarks, len(strikes), cadence(strikes, fps), trunk_lean(clean),
        knee_flexion_at_strikes(clean, strikes),
        vertical_oscillation(clean, strikes), warnings,
    )
    return Analysis(report, landmarks, clean, strikes)
