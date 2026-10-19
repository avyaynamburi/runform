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

**Foot-strike heuristic (v1):** for each foot, take the heel's y coordinate, smooth it, and find local maxima (lowest points in the image) with a minimum spacing of 0.4 s per foot (changed from 0.25 s in T2b) and prominence of at least 2% of body height. Each maximum is a strike for that foot. Cadence is 2 × 60 divided by the median stride time, where stride time is the interval between consecutive strikes of the same foot (T2b; T2 used the first-to-last strike span).

## Tasks: vertical tracer bullets (Codex)

The rules are in `AGENTS.md` under "Tracer bullets" and "Task loop." In short, every task runs end to end, from the CLI to the report, and adds one visible result. No task builds a single layer on its own.

**How the CLI tests work:** `tests/test_cli.py` monkeypatches `runform.cli.read_frames` and `runform.cli.extract_landmarks` to return fixture data. Then it runs `main(["analyze", "x.mp4", "--out", tmp])` and checks the JSON. Each slice adds asserts to this file.

| Task | Slice | Status |
|---|---|---|
| T1 | Walking skeleton: frame counts | done |
| T2 | Cadence | done |
| T2b | Cadence robust to double heel peaks | done |
| T3 | Trunk lean | done |
| T4 | Knee flexion at strike | done |
| T5 | Vertical oscillation | done |
| T6 | Robustness: gaps and noise | done |

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

### T2b — Cadence robust to double heel peaks
- Why: on `samples/side_run.mp4`, T2 reports 193.5 spm. The left heel's strikes are cleanly 20 frames apart (about 180 spm), but the right heel has 8 extra peaks only 9–12 frames after a real strike. The 0.25 s minimum spacing is far too loose for strikes of the *same* foot, which are at least about 0.4 s apart even at 300 spm.
- Goal: `cadence_spm` in the report stays correct when a heel signal has a secondary bump between strikes.
- Files: `src/runform/gait.py`, `tests/conftest.py`, `tests/test_gait.py`, `tests/test_cli.py`
- Steps:
  - Per-foot `find_peaks` distance becomes `0.4 · fps`. Update the Architecture paragraph's number in your head, not in the file; Lead updates PLAN.md.
  - `cadence()` becomes robust to stray strikes: take the median interval between consecutive strikes *of the same foot* (pooled across both feet) as the stride time, and return `2 · 60 / stride_seconds`. Return `None` if no foot has 2 or more strikes. Keep the signature `cadence(strikes, fps)`.
  - Fixture: add a `double_bump=False` option. When true, each heel gets an extra Gaussian bump (amplitude 0.03, sigma 0.03 s) 0.3 s after every one of its strikes, which mimics the real clip.
- Acceptance:
  - `ruff check . && pytest -q`.
  - `test_gait.py`: with `double_bump=True` at 170 spm and 30 fps, cadence is within ±3. Existing T2 tests still pass, with the expectations for `cadence()` unit cases updated to the new definition where needed.
  - `test_cli.py`: a new case uses `double_bump=True` at 170 spm and checks `cadence_spm` within ±3.
  - Lead checks: `runform analyze samples/side_run.mp4` gives a cadence in the range 175–185.
- Out of scope: general smoothing (T6) and any other metric.

### T3 — Trunk lean
- Goal: the report gains `trunk_lean_deg`, the mean forward lean in degrees (positive = leaning in the running direction).
- Files: `src/runform/landmarks.py`, `src/runform/pose.py`, `src/runform/metrics.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_metrics.py`, `tests/test_cli.py`, `tests/test_video_pose.py`
- Steps:
  - **Aspect ratio:** MediaPipe x is a fraction of frame width and y a fraction of frame height, so angles need the frame's aspect ratio. The sample clip is 720×1008. `Landmarks` gains `aspect: float = 1.0` (width / height); the default keeps existing constructors working. `pose.extract_landmarks` sets it from the first frame's shape (1.0 if there are no frames).
  - `metrics.py` (pure NumPy):
    - `facing_sign(lm) -> int`: +1 if the runner faces +x, −1 if −x. It's the sign of the nanmedian over both feet of (foot_index x − heel x) (31−29, 32−30). It returns +1 when the result is undefined or 0.
    - `trunk_lean(lm) -> np.ndarray`: per-frame degrees, NaN where landmarks are missing. With hip-mid h and shoulder-mid s: `dx = (s.x − h.x) · aspect · facing_sign`, `dy = h.y − s.y`, and `deg = degrees(atan2(dx, dy))`.
  - The report gains `trunk_lean_deg`: the nanmean, rounded to 1 decimal, or null if every frame is NaN. The text summary gains a trunk lean line.
  - Fixture: `make_landmarks` gains `lean_deg=0.0` and `aspect=1.0` and puts `aspect` on the `Landmarks`. The runner faces +x: heels' x = ankle x − 0.01, and foot index (31/32) = (ankle x + 0.03, 0.93). The lean is built in pixel space: shift both shoulders' x by `tan(lean) · (hip_y − shoulder_y) / aspect`. Leave heel y as it is so the T2 tests are unaffected.
- Acceptance:
  - `ruff check . && pytest -q`.
  - CLI test: `lean_deg=10, aspect=720/1008` gives `trunk_lean_deg` within 10 ± 1. The static-pose CLI test asserts 0.0.
  - `test_metrics.py`: an upright trunk gives 0. A frame of all NaN gives NaN. Mirroring a 10° fixture (x → 1 − x) still gives +10, because the facing sign flips. The same normalized landmarks with aspect 1.0 and with aspect 0.5 give different angles.
  - `test_video_pose.py`: the pose test asserts `landmarks.aspect == 1.0` for the 64×64 video.
- Out of scope: per-stride lean, smoothing, and any other metric.

### T4 — Knee flexion at foot strike
- Goal: the report gains `knee_flexion_at_strike_deg` = `{"mean": float, "std": float}` (degrees, 180 = straight leg, rounded to 1 decimal), or null when there are no strikes with valid landmarks.
- Files: `src/runform/metrics.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_metrics.py`, `tests/test_cli.py`
- Steps:
  - `joint_angle(a, b, c, aspect=1.0) -> np.ndarray`: the angle at `b` in degrees. Each argument is an (..., 2) array of normalized x, y. Multiply x by `aspect` before computing. Return NaN for NaN input or a zero-length segment.
  - `knee_flexion_at_strikes(lm, strikes) -> np.ndarray`: one angle per strike, using the landing leg (left: 23/25/27, right: 24/26/28) at `strike.frame`. Strikes whose angle is NaN are dropped.
  - The report takes the mean and the population std (`ddof=0`) of that array.
  - Fixture: add `knee_deg=180.0`. Both thigh and shank are 0.2 tall, so the knee is moved forward (+x) by `0.2 · tan(radians((180 − knee)/2)) / aspect` to get that knee angle. When `cadence_spm` is set, the knee angle varies per leg in step with its heel: `knee_deg − 20 · (1 − sin(ωt + phase))`. It equals `knee_deg` exactly at strike and is more bent in between, so only sampling at the strike gives the right answer. With no cadence it's constant.
- Acceptance:
  - `ruff check . && pytest -q`.
  - CLI test: `cadence_spm=170, knee_deg=165, aspect=720/1008` gives mean within 165 ± 2 and std < 2. The static-pose CLI test asserts the field is null.
  - `test_metrics.py`: `joint_angle` gives 90 for a right angle and 180 for collinear points. An aspect-dependent case: the same normalized points give a different angle at aspect 0.5. NaN input gives NaN.
  - `test_metrics.py`: `knee_flexion_at_strikes` uses the correct leg. Make the left knee 150 and the right knee 170 for a direct-call check.
- Out of scope: other joint angles, smoothing, and peak knee flexion in swing.

### T5 — Vertical oscillation
- Goal: the report gains `vertical_oscillation_rel`: the mean, over strides, of the peak-to-trough range of hip-mid y, divided by body height. It's rounded to 3 decimals, or null when there are no strides.
- Files: `src/runform/metrics.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_metrics.py`, `tests/test_cli.py`
- Steps:
  - `vertical_oscillation(lm, strikes) -> np.ndarray`: one value per stride. A stride is the frame window `[a, b]` between two consecutive strikes of the *same* foot, using both feet. For each one: (nanmax − nanmin of hip-mid y in the window) / body height. Body height is the median over frames of (ankle-mid y − shoulder-mid y), the same as in `gait.py`; a small private helper in metrics.py is fine. Skip windows with no valid hip data. Only y is used, so aspect doesn't matter.
  - The report takes the mean. The text summary gains a line.
  - Fixture: add `hip_amp=0.0`. When `cadence_spm` is set, add `hip_amp · sin(2 · ω · t)` (twice per stride, one bounce per step) to the y of the shoulders and hips (11, 12, 23, 24) only. Expected value: `2 · hip_amp / 0.6`.
- Acceptance:
  - `ruff check . && pytest -q`.
  - CLI test: `cadence_spm=170, hip_amp=0.015` gives 0.05 ± 10%. The static-pose CLI test asserts null.
  - `test_metrics.py`: hand-built strikes check the per-stride windows: a bigger bounce in one stride shows up only in that stride's value. No strikes, or only one strike per foot, gives an empty array.
- Out of scope: smoothing (T6) and absolute units.

### T6 — Robustness: gaps and noise
- Goal: the pipeline handles dropped detections and jitter. The report gains `warnings`, a list of strings: `[]` normally, and a low-coverage message when under 80% of frames have a pose.
- Files: `src/runform/smoothing.py`, `src/runform/cli.py`, `src/runform/report.py`, `tests/conftest.py`, `tests/test_smoothing.py`, `tests/test_cli.py`
- Steps:
  - `smoothing.py` (pure NumPy/SciPy). Both functions return a new `Landmarks` with the same fps and aspect and don't modify their input:
    - `fill_gaps(lm, max_gap=5)`: for each landmark and coordinate (x, y, and visibility), linearly interpolate interior NaN runs of `max_gap` frames or fewer. Longer runs and leading/trailing NaNs stay NaN.
    - `smooth(lm)`: apply a Savitzky–Golay filter (polyorder 2) to x and y along time, separately for each contiguous run of finite values. Window = the odd number nearest `0.15 · fps`, minimum 5. Runs shorter than the window are left unchanged. Visibility is not smoothed. (Lead measured this window: it keeps ≥98% of step-rate bounce up to 200 spm. Wider windows lose up to 22%.)
  - CLI: `clean = smooth(fill_gaps(raw))`. Gait and every metric use `clean`. `build_report` still gets the **raw** landmarks, so `frames_with_pose` keeps counting real detections. It also gets `warnings` computed in the CLI.
  - Warning text: `"Pose detected in only {pct:.0f}% of frames; metrics may be unreliable"` when frames_with_pose / frames_total < 0.8 and frames_total > 0. The CLI prints each warning as `Warning: ...`.
  - Fixture: add `dropout=0.0`. A seeded random fraction of frames becomes all-NaN, applied last.
- Acceptance:
  - `ruff check . && pytest -q`. All existing tests keep their current tolerances.
  - CLI test: `cadence_spm=170, noise=0.005, dropout=0.1` (300 frames, 30 fps) gives cadence within ±3 and `warnings == []`. With `dropout=0.3`, the warning is present.
  - `test_smoothing.py`: a 3-frame gap is filled linearly and a 6-frame gap is not. Leading NaNs stay NaN. Smoothing reduces the std of a noisy constant signal by at least 2× at 100 fps. (At 30 fps the 5-frame window can only reach about 1.4–1.7×, so 2× was never possible there; Lead's spec error.) A pure 2.83 Hz sine at 30 fps keeps ≥95% of its peak-to-peak. The input object is unchanged.
- Out of scope: the visibility threshold, outlier rejection, and refactoring gait.py's internal moving average.

### Done when
- `pytest` passes in full.
- `runform analyze samples/side_run.mp4` (a clip the user adds) gives a cadence that matches a manual count from the video within ±5 spm. The user checks this by hand.

## Later (not in MVP)
- Deduplicate the body-height computation in `gait.py` and `metrics.py`, and the `frames_with_pose` count in `cli.py` and `report.py`.
- Stream frames instead of holding the whole video in memory (`read_frames` returns a list).
- Download the pose model atomically (temp file, then rename) so an interrupted download can't leave a corrupt cache.
- An annotated output video with the skeleton and angles drawn on it.
- Overstride measurement (the foot's horizontal offset from the hip at strike).
- Ground contact time.
- Front-view metrics.
