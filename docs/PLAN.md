# Running Form Analyzer — Plan

Owner: Lead. Implementer: Codex. Rules: see `AGENTS.md`.

## Goal (MVP)

```
runform analyze path/to/video.mp4 [--out report.json]
```

Input: a side-view video of one person running. Output: a text summary printed to stdout and a JSON report with:

| Metric | Definition |
|---|---|
| Cadence | Steps per minute, from detected foot strikes |
| Knee flexion at foot strike | Hip–knee–ankle angle of the landing leg, in degrees (180 = straight). Mean and std. |
| Trunk forward lean | Angle of the hip-mid → shoulder-mid line from vertical, in degrees. Mean over the clip. |
| Vertical oscillation | Peak-to-trough range of hip-mid height per stride, divided by body height (shoulder-mid to ankle). Mean. |

The report also includes `frames_total`, `frames_with_pose`, `fps`, and `strikes_detected`.

## Assumptions

- The camera is fixed and filmed from the side, and the runner is roughly perpendicular to it.
- There is one runner in frame.
- fps is 30 or higher. Cadence accuracy depends on fps.
- Metrics are relative and image-based. There is no real-world calibration (no meters).

## Architecture

```
src/runform/
  __init__.py
  video.py      # read_frames(path) -> (iterator of BGR frames, fps)        [OpenCV]
  pose.py       # extract_landmarks(frames) -> Landmarks                     [MediaPipe; only module importing it]
  landmarks.py  # Landmarks dataclass: array (T, 33, 3) of x, y, visibility; NaN = missing
  smoothing.py  # fill_gaps(), smooth() on Landmarks (added in T6)
  gait.py       # detect_foot_strikes(lm, fps) -> list[Strike]; cadence(strikes, fps)
  metrics.py    # joint_angle(a, b, c), trunk_lean(), knee_flexion_at_strikes(), vertical_oscillation()
  report.py     # build_report(...) -> dict; format_text(report) -> str
  cli.py        # argparse entry point `runform analyze`
tests/
  conftest.py   # synthetic landmark generators (a sinusoidal gait)
  test_*.py
```

Data flow: `video` → `pose` → `smoothing` → `gait` + `metrics` → `report` → `cli`.

**Testability rule:** only `pose.py` imports MediaPipe, and only `video.py` and `pose.py` import OpenCV. Every other module works on plain NumPy arrays, so its tests use synthetic landmarks and need no video or model.

Landmark indices are the MediaPipe Pose standard: 11/12 shoulders, 23/24 hips, 25/26 knees, 27/28 ankles, 29/30 heels, 31/32 foot index. Image y increases downward.

**Foot-strike heuristic (v1):** for each foot, take the heel's y coordinate, smooth it, and find local maxima (lowest points in the image) with a minimum spacing of 0.25 s and prominence of at least 2% of body height. Each maximum is a strike for that foot. Cadence is (number of strikes − 1) divided by the time from the first strike to the last, times 60.

## Tasks: vertical tracer bullets (Codex)

The rules are in `AGENTS.md` under "Tracer bullets" and "Task loop." In short, every task runs end to end, from the CLI to the report, and adds one visible result. No task builds a single layer on its own.

**How the CLI tests work:** `tests/test_cli.py` monkeypatches `runform.cli.read_frames` and `runform.cli.extract_landmarks` to return fixture data. Then it runs `main(["analyze", "x.mp4", "--out", tmp])` and checks the JSON. Each slice adds asserts to this file.

| Task | Slice | Status |
|---|---|---|
| T1 | Walking skeleton: frame counts | done |
| T2 | Cadence | todo |
| T3 | Trunk lean | todo |
| T4 | Knee flexion at strike | todo |
| T5 | Vertical oscillation | todo |
| T6 | Robustness: gaps and noise | todo |

### T1 — Walking skeleton: frame counts end to end
- Goal: `runform analyze clip.mp4 --out r.json` reads the video, runs pose, and writes `{fps, frames_total, frames_with_pose}`. It also prints a text summary.
- Files: `pyproject.toml`, `.gitignore`, `src/runform/__init__.py`, `src/runform/landmarks.py`, `src/runform/video.py`, `src/runform/pose.py`, `src/runform/report.py`, `src/runform/cli.py`, `tests/conftest.py`, `tests/test_cli.py`, `tests/test_video_pose.py`
- Steps:
  - Package setup: Python >=3.11. Dependencies are `numpy`, `scipy`, `opencv-python`, and `mediapipe`. Dev extra: `pytest`, `ruff`. Configure ruff in `[tool.ruff]` with `select = ["E", "F", "I", "B", "UP"]` and `line-length = 100`. Console script `runform = runform.cli:main`.
  - `Landmarks` is a (T, 33, 3) array of x, y, visibility, with NaN for frames where no pose was found.
  - `conftest.py` provides `make_landmarks(n_frames, fps)` with a static standing pose. Later slices extend it.
  - Pose uses the **MediaPipe Tasks `PoseLandmarker`** in VIDEO mode, because newer MediaPipe releases dropped the legacy `mp.solutions.pose`. Check the installed version's API before writing code.
    - The model `.task` file comes from the `--model PATH` option.
    - With no `--model`, it defaults to `~/.cache/runform/pose_landmarker_full.task` and is downloaded on first use from the official MediaPipe models URL.
    - Do not commit the model.
  - `.gitignore`: `.venv/`, `__pycache__/`, `*.egg-info/`, `.pytest_cache/`, `.ruff_cache/`, `samples/*.mp4`, `*.task`, `r.json`.
  - Use the existing `.venv` (Python 3.14): `.venv/bin/pip`, `.venv/bin/pytest`.
- Acceptance:
  - `pip install -e ".[dev]" && ruff check . && pytest -q` passes.
  - The `test_cli.py` case checks the three keys and their values from the fixture.
  - The `test_video_pose.py` case writes a 10-frame video with OpenCV and checks the frame count and fps that `read_frames` returns. Its pose part is guarded with `importorskip("mediapipe")`.
- Out of scope: any gait metric.

### T2 — Cadence
- Goal: the report gains `cadence_spm` and `strikes_detected`.
- Files: `src/runform/gait.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_gait.py`, `tests/test_cli.py`
- Steps:
  - Fixture: `make_landmarks(n_frames, fps, cadence_spm=None, noise=0.0, seed=0)`. With `cadence_spm=None` it stays the static pose from T1. Otherwise the heels (29 left, 30 right) have `y = 0.92 + 0.04 * sin(2π · (cadence_spm/2/60) · t + phase)`, with the right foot's phase offset by π, so each foot strikes at half the cadence. `noise` adds seeded Gaussian noise (that std, in normalized units) to every x and y.
  - `gait.py`:
    - `Strike` is a dataclass with `frame: int` and `foot: str` (`"left"` / `"right"`).
    - `detect_foot_strikes(lm: Landmarks) -> list[Strike]`, sorted by frame. Body height = median over frames of (ankle-mid y − shoulder-mid y). For each heel's y series:
      1. Linearly interpolate NaN frames (a series that is all NaN gives no strikes).
      2. Smooth with a centered moving average about 0.1 s wide.
      3. Run `scipy.signal.find_peaks` with `distance = 0.25 · fps` and `prominence = 0.02 · body height`.
    - `cadence(strikes, fps) -> float | None` = `(len(strikes) − 1) / ((last.frame − first.frame) / fps) · 60`, or `None` when there are fewer than 2 strikes.
  - The report gains `strikes_detected` (int) and `cadence_spm` (float rounded to 1 decimal, or JSON `null`). The text summary gains a cadence line.
- Acceptance:
  - `ruff check . && pytest -q`.
  - CLI test: a 10 s fixture at 170 spm and 30 fps gives `cadence_spm` within ±3 and `strikes_detected` of 27–29. The existing T1 CLI test (static pose) still passes and now also asserts `strikes_detected == 0` and `cadence_spm is None`.
  - `test_gait.py`:
    - strikes alternate between the left and right foot
    - with `noise=0.005`, cadence is still within ±3 spm of 170
    - the static pose gives no strikes, and `cadence([...one strike...], 30)` is `None`
- Out of scope: smoothing beyond what strike detection itself needs.

### T3 — Trunk lean
- Goal: the report gains `trunk_lean_deg` (the mean).
- Files: `src/runform/metrics.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_metrics.py`, `tests/test_cli.py`
- Acceptance:
  - `ruff check . && pytest -q`.
  - A fixture built with a 10° lean gives 10 ± 1° in the CLI test.
  - Unit tests: an upright trunk gives 0°, and NaN input gives NaN.

### T4 — Knee flexion at foot strike
- Goal: the report gains `knee_flexion_at_strike_deg` with `mean` and `std`.
- Files: `src/runform/metrics.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_metrics.py`, `tests/test_cli.py`
- Acceptance:
  - `ruff check . && pytest -q`.
  - The fixture's knee angle at strike comes out within ±2°.
  - `joint_angle` unit tests: a right angle gives 90° and collinear points give 180°.

### T5 — Vertical oscillation
- Goal: the report gains `vertical_oscillation_rel`, the bounce per stride divided by body height.
- Files: `src/runform/metrics.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_metrics.py`, `tests/test_cli.py`
- Acceptance: `ruff check . && pytest -q`. The fixture's hip amplitude comes back within ±10%.

### T6 — Robustness: gaps and noise
- Goal: the pipeline handles dropped detections and jitter. The report gains a `warnings` list, for example a warning when under 80% of frames have a pose.
- Files: `src/runform/smoothing.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_smoothing.py`, `tests/test_cli.py`
- Steps: `fill_gaps` interpolates NaN runs of 5 frames or fewer. `smooth` applies a Savitzky–Golay filter. Both run before gait and the metrics.
- Acceptance:
  - `ruff check . && pytest -q`.
  - The CLI test uses a fixture with 10% dropped frames and noise, and the cadence still comes out within ±3 spm.
  - With 30% dropped frames, the warning appears.

### Done when
- `pytest` passes in full.
- `runform analyze samples/side_run.mp4` (a clip the user adds) gives a cadence that matches a manual count from the video within ±5 spm. The user checks this by hand.

## Later (not in MVP)
- An annotated output video with the skeleton and angles drawn on it.
- Overstride measurement (the foot's horizontal offset from the hip at strike).
- Ground contact time.
- Front-view metrics.
