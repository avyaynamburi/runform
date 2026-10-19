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

## Phase 2: Web app

Goal: `runform serve` starts a local web app. You upload a side-view running clip. The page plays the video with the detected skeleton drawn over it, then runs a guided "how it was measured" sequence for each stat, and ends on the stat cards.

### Architecture
```
src/runform/
  pipeline.py   # analyze(path, model=None) -> Analysis(report, raw, clean, strikes). Shared by the CLI and the web app.
  web.py        # create_app(model=None) -> Flask app. GET / serves static/index.html; POST /api/analyze runs the pipeline.
  static/
    index.html  # single page: upload → processing → intro/explainers → results
    style.css
    app.js      # vanilla JS, no build step, no CDN. Canvas overlay on a <video> that plays the user's local file (object URL).
```
- The web app never sends the video back. The browser plays its own local copy, and the server returns only JSON.
- All measuring stays in Python. The front end only draws what the API returns, so the web app and CLI can never disagree.
- Look and feel: dark background, a neon-cyan skeleton with a soft glow, and one accent color per stat. Big numbers in a monospace font. Animations run on `requestAnimationFrame` and are synced to `video.currentTime`.

### API: `POST /api/analyze` (multipart field `video`)
- 200: `{"report": {...same dict as the CLI JSON...}, ...slice additions}`
- 400 `{"error": ...}` when the file is missing. 422 `{"error": ...}` when the video can't be read or analyzed (ValueError from the pipeline).
- The upload is saved to a temp file and deleted after analysis. `MAX_CONTENT_LENGTH` is 300 MB.

### Testing web slices
`tests/test_web.py` uses Flask's test client and monkeypatches `runform.pipeline.read_frames` and `runform.pipeline.extract_landmarks` with fixture data, the same way `test_cli.py` does. JS isn't unit-tested. Lead reviews it by launching `runform serve`, uploading `samples/side_run.mp4` in a real browser, and checking each scene.

| Task | Slice | Status |
|---|---|---|
| W1 | Upload → stats cards | done |
| W2 | Skeleton overlay + draw-in intro | done |
| W3 | Explainers: cadence + trunk lean | done |
| W4 | Explainers: knee at strike + vertical oscillation; polish | done |
| W5 | Cinematic camera: title card, zooms per scene | done |
| W6 | Chart beats: each scene opens with its graph, then the zoomed video | done (superseded by W7) |
| W7 | Immersive single-shot tour: in-world HUDs, no chart breaks | done |
| W8 | Speed ramps: slow-mo on key moments, fast transitions | done |
| W9 | Locked framing per scene; tour ends on the summary | done |

### W1 — Upload → stat cards
- Goal: `runform serve` opens a page. You upload a video, a "processing" state shows while the server analyzes it, and the report appears as stat cards (cadence, trunk lean, knee at strike, vertical oscillation, plus frames with pose and warnings).
- Files: `pyproject.toml`, `src/runform/pipeline.py`, `src/runform/cli.py`, `src/runform/web.py`, `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_cli.py`, `tests/test_web.py`
- Steps:
  - Add the `flask>=3.1` dependency. Add package data so `static/*` is included (`[tool.setuptools.package-data] runform = ["static/*"]`).
  - `pipeline.py`: move the read → pose → fill_gaps/smooth → strikes → metrics → warnings → `build_report` sequence out of `cli.main` into `analyze(path, model=None) -> Analysis`. `Analysis` is a dataclass with `report`, `raw`, `clean` and `strikes`. Behavior doesn't change. `cli.py` calls it and keeps the text printing.
  - `cli.py` gets a `serve` subcommand with `--host` (default 127.0.0.1), `--port` (default 8000) and `--model`. It prints the URL and calls `create_app(model).run(host, port)`.
  - `test_cli.py`: retarget the monkeypatches to `runform.pipeline.*`. All existing assertions stay unchanged. Add a `serve` test that monkeypatches `runform.cli.create_app` and checks that host, port and model are passed through.
  - Front end: a drop zone or file picker. On submit, POST with `fetch` and show an animated "Analyzing your stride…" state. Render the cards; null values show as "—". Show warnings as a banner. Show error responses as a message, and let the user upload again.
- Acceptance:
  - `pip install -e ".[dev]" && ruff check . && pytest -q`.
  - `test_web.py`:
    - GET `/` returns 200 HTML with a file input.
    - POST with a fake file and a fixture at 170 spm returns a `report` whose `cadence_spm` is within ±3.
    - With no file, the response is 400.
    - When `read_frames` raises ValueError, the response is 422 with an `error`.
    - The temp file is deleted afterwards.
  - Lead checks: `runform serve`, then uploading `samples/side_run.mp4` in a browser, shows 180.0 spm.
- Out of scope: video playback, skeleton, animations.

### W2 — Skeleton overlay + draw-in intro
- Goal: after analysis, the page shows a video stage above the cards. Your clip plays with the detected skeleton drawn over it. The intro draws the skeleton in joint by joint and bone by bone, then it tracks you live.
- Files: `src/runform/web.py`, `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_web.py`
- Steps:
  - API: the `/api/analyze` response adds `pose`, which has `fps`, `aspect` and `frames`, built from `analysis.clean` by a small helper in web.py. `frames[i]` is `null` if every point in frame i is NaN. Otherwise it's a list of 33 `[x, y]` pairs rounded to 4 decimals, with `null` for an individual NaN point. Visibility isn't sent.
  - Stage: a `<video>` (muted, playsinline, from `URL.createObjectURL(file)`; nothing is uploaded back) with a `<canvas>` exactly covering the video's rendered picture, accounting for letterboxing. It's sized for devicePixelRatio and resizes with the window.
  - Frame sync: index = `floor(video.currentTime · fps)`, clamped. Drawing runs on `requestAnimationFrame`. When a frame is null, the skeleton fades out.
  - Skeleton: bones are the shoulders, torso (11-23, 12-24), hips, arms (11-13-15, 12-14-16) and legs (23-25-27-29-31-27, 24-26-28-30-32-28). The left side is neon cyan (#22d3ee) and the right side violet (#a78bfa), so the two legs are easy to tell apart. Joints are small filled dots with a glow (`shadowBlur`).
  - Intro (about 3 s, starting paused on the first frame with a pose):
    1. The video dims behind a dark veil and a label "Tracking 33 body points…" appears.
    2. Joints pop in with a stagger.
    3. Bones draw outward from the torso, each stroke growing from one end to the other.
    4. The veil lifts, the label changes to "Live tracking", and the video plays at 0.5× and loops.
    With `prefers-reduced-motion`, skip straight to step 4.
  - Controls under the stage: play/pause, speed (0.25× / 0.5× / 1×) and replay intro.
  - Add an inline SVG favicon (a data URI in index.html) to stop the favicon 404.
- Acceptance:
  - `ruff check . && pytest -q`.
  - `test_web.py`: the analyze response has `pose.fps == 30`, `pose.aspect` equal to the fixture's aspect, and `len(pose.frames) == n_frames`. An all-NaN frame becomes `null`. A single NaN point becomes `null` inside an otherwise valid frame. Values are rounded to 4 decimals.
  - Lead checks in headless Chrome with the sample clip: screenshots mid-intro (partial skeleton), after the intro (full skeleton on the runner during playback), and at phone width. There must be no console errors.
- Out of scope: stat explainers (W3/W4).

### W3 — Guided tour: cadence + trunk lean
- Goal: after the intro, a guided tour plays a short animated scene for each stat that shows how it was measured. W3 adds the cadence and trunk lean scenes.
- Files: `src/runform/web.py`, `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_web.py`
- Steps:
  - API: the response adds `strikes` (`[{"frame": int, "foot": "left"|"right"}]` from `analysis.strikes`) and `series`, which holds `{"trunk_lean_deg": [per frame, rounded to 1 decimal, or null]}` from `metrics.trunk_lean(analysis.clean)`.
  - Tour framework: a `scenes` array where each scene is `{id, title, value(report), caption, draw(ctx, frame, frameIndex)}`. W4 will add scenes by appending to this array, so keep it generic.
    - Under the stage there's a row of scene chips (Cadence, Trunk lean), the active one highlighted.
    - On the stage, a scene card (top-left, replacing the "Live tracking" label) shows the scene title, the big value and a one- or two-sentence caption. It also has a thin progress bar.
    - After the intro, the tour auto-plays: each scene lasts 8 s of wall-clock time while the video plays at 0.5×, then the next one starts. After the last scene it goes to free "Live tracking" mode.
    - Clicking a chip jumps to that scene and restarts its timer. Replay intro restarts the intro and then the tour.
  - Every scene draws its overlay on top of the skeleton. The skeleton stays visible but dimmed to about 40% opacity, so the scene's overlay stands out.
  - All overlays are **stateless**: they're computed from `frameIndex` and the API data, so seeking and looping just work.
  - **Cadence scene** (accent: the side colors, cyan/violet):
    - For each strike within the last ~12 frames, draw an expanding, fading ring at that foot's heel (29 or 30) in the side's color.
    - A step counter on the stage shows "Steps: n", where n is the number of strikes with frame ≤ frameIndex.
    - A timeline strip along the bottom of the stage shows the whole clip, with a tick for every strike (left on the top row, right on the bottom row) and a moving playhead.
    - Caption: "Every time a heel hits its lowest point, that's a foot strike. The median time between strikes of the same foot gives your cadence."
  - **Trunk lean scene** (accent amber #f59e0b):
    - A thick line from the hip midpoint to the shoulder midpoint.
    - A dashed vertical line going up from the hip midpoint, the same length.
    - An arc between the two lines, labeled with the current frame's `trunk_lean_deg` (for example 7.2°).
    - Caption: "The angle between your hip-to-shoulder line and vertical, averaged over every frame."
  - Expose the current scene id in the `window.__runform` debug hook (`scene`), for automated checks.
  - Polish: once results arrive, smooth-scroll the stage into view.
- Acceptance:
  - `ruff check . && pytest -q` and `node --check`.
  - `test_web.py`: `strikes` matches `analysis.strikes` (frame and foot), and `series.trunk_lean_deg` has n_frames entries. With `lean_deg=10`, the values are about 10. A NaN frame gives `null`.
  - Lead checks in headless Chrome with the sample clip: screenshots during each scene, and after the tour (live mode). Chip navigation works. No console errors.
- Out of scope: the knee and vertical oscillation scenes (W4).

### W4 — Guided tour: knee at strike + vertical oscillation + summary
- Goal: the tour gains three more scenes: knee at strike, vertical oscillation (the hips trace a glowing wave as they bounce) and a closing summary. That completes the web app.
- Files: `src/runform/metrics.py`, `src/runform/web.py`, `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_metrics.py`, `tests/test_web.py`
- Steps:
  - `metrics.py`: add `oscillation_strides(lm, strikes) -> list[Stride]`. `Stride` is a dataclass with `foot`, `start`, `end`, `top` (the frame where hip-mid y is smallest, i.e. highest), `bottom` (the frame where it's largest) and `value` (range / body height). It uses exactly the same windows and skipping rules as today. `vertical_oscillation` becomes `np.asarray([s.value for s in oscillation_strides(...)])`, so its behavior and tests don't change.
  - API: `series` adds `knee_at_strike_deg`, aligned 1:1 with `strikes`. It's the landing-leg knee angle from `metrics.joint_angle` at each strike, rounded to 1 decimal, or null. The response adds `strides`: `[{"foot", "start", "end", "top", "bottom", "value"}]` with `value` rounded to 4 decimals.
  - **Knee scene** (accent pink #f472b6):
    - When playback crosses a strike frame, the video freezes on that exact frame for 1 s. Use a `freezeUntil` flag, separate from the user's play/pause, and seek to `(frame + 0.5) / fps`.
    - Draw the landing leg's thigh and shank thick in pink, with an arc at the knee between them and a pill label giving that strike's angle (for example "158°").
    - The arc and label stay visible and fade over the 15 frames after the strike.
    - Freezes count toward the scene's 8 s timer.
    - Caption: "At each foot strike we freeze the frame and measure the hip–knee–ankle angle of the landing leg. 180° would be a straight leg."
  - **Vertical oscillation scene** (accent green #34d399):
    - A trace of the hip midpoint over the last 60 frames, drawn as a seismograph. Frame i's point is at `x = hipX(now) − (frameIndex − i) · 4 px`, `y = hipY(i)`, so the bounce scrolls left as a glowing wave that fades toward its tail.
    - For the stride containing frameIndex, choosing among strides of the first stride's foot, draw dashed horizontal guides at the hip y of its `top` and `bottom` frames.
    - Draw a vertical bracket to the right of the runner between the two guides, with a pill label giving that stride's value as a percentage (for example "8.4% of body height").
    - Caption: "We follow your hip midpoint through each stride. The gap between its highest and lowest point, divided by your shoulder-to-ankle height, is your vertical oscillation."
  - **Summary scene** (no overlay, skeleton at full opacity):
    - The card shows all four values in a compact 2×2 grid. Caption: "That's your stride. Scroll down for the full breakdown."
    - When it ends, the tour goes to free live mode, as it does now.
  - Chips: Cadence, Trunk lean, Knee, Bounce, Summary.
- Acceptance:
  - `ruff check . && pytest -q` and `node --check`.
  - `test_metrics.py`: `oscillation_strides` on the existing hand-built stride fixture gives the correct top and bottom frames and values, and `vertical_oscillation` stays equal to the values from `oscillation_strides`.
  - `test_web.py`: `knee_at_strike_deg` has the same length as `strikes`, and with the fixture `knee_deg=165` the values are about 165. `strides` values have the right length and the right top and bottom ordering. The fixture at `hip_amp=0.015` gives values of about 0.05.
  - Lead checks in headless Chrome with the sample clip: screenshots of the knee freeze, the oscillation wave and the summary. No console errors.
- Out of scope: new metrics, exporting or sharing, and any change to how the stat cards look.

### W5 — Cinematic camera: title card and per-scene zooms
- Goal: the intro and tour feel like a film. A title card leads into a close-up that pulls back while the skeleton draws, and every scene smoothly pans and zooms to the body part it measures.
- Files: `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_web.py`
- Steps:
  - **Camera model:** `camera = {cx, cy, scale}` in normalized picture coordinates. The `<video>` gets a CSS transform from the camera (`transform-origin: 0 0`). The stage has `overflow: hidden`. The canvas is **not** transformed. It stays full-size and draws every point through `project([x, y]) -> [px, py]`, using the same camera math, so lines stay crisp and the same width at any zoom. All existing drawing code goes through `project`.
  - **Smoothing:** each frame the camera eases toward its target: `cam += (target − cam) · (1 − exp(−dt / 350 ms))`. The target is the current focus box, recomputed every frame from that frame's landmarks and smoothed by an EMA with τ = 250 ms, so it follows a runner who moves across the frame and doesn't jitter on a treadmill. Scale = `0.8 · min(1/boxW, 1/boxH)`, clamped to [1, 2.6]. The center is clamped so the view never shows outside the picture.
  - **Focus regions** (union bbox of the joints, padded 25%):
    - intro close-up: torso and head (0, 11, 12, 23, 24)
    - cadence: feet (27–32)
    - trunk lean: torso (0, 11, 12, 23, 24)
    - knee: legs (23–32)
    - bounce: hips and torso (11, 12, 23, 24), with extra vertical padding of 40% so the bounce has room
    - summary and free live mode: the full picture (scale 1)
  - **Title card** (before the intro): about 1.6 s on a black stage. A "RUNFORM" wordmark fades up, then a mono line types in: "{frames_total} frames · {fps} fps · 33 points per frame". It cross-fades into the video, already zoomed on the torso.
  - **Intro:** while the joints pop and the bones draw, the camera pulls back from the torso close-up to full body. Then the tour begins.
  - **Look:** a subtle vignette over the stage (CSS radial gradient), plus thin cinematic letterbox bars (about 6% of stage height) that slide in during the tour and out in free mode.
  - `prefers-reduced-motion`: no title animation, no camera easing (it snaps), no letterbox slide.
  - Debug hook: add `camera` (a copy of `{cx, cy, scale}`).
- Acceptance:
  - `ruff check . && pytest -q`, `node --check`. `test_web.py` asserts that the served index contains the camera and title elements. There's no new API data in this slice.
  - Lead checks in headless Chrome with the sample clip: the title card, the torso close-up at the start of the intro (scale > 1.5), full body after the intro, and each scene's zoom (`camera.scale` > 1.2 for cadence, lean, knee and bounce, and 1 for summary). Screenshots show the overlay still lying on the body while zoomed. No console errors.
- Out of scope: charts (W6).

### W6 — Chart beats: each scene opens with its graph, then the zoomed video
- Goal: every scene first shows a full-stage animated chart of the measurement, then cuts to the zoomed video beat. Vertical oscillation gets its own graph of the hip-height wave.
- Files: `src/runform/metrics.py`, `src/runform/web.py`, `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_metrics.py`, `tests/test_web.py`
- Steps:
  - `metrics.py`:
    - Extract the duplicated body-height code into `body_height(lm) -> float` (NaN if it can't be computed), and use it in `oscillation_strides`. `gait.py` is unchanged.
    - Add `hip_height(lm) -> np.ndarray`: per frame, `(nanmedian(hip_y) − hip_y) / body_height`. Up is positive, as a fraction of body height, with NaN where missing.
  - API: `series.hip_height_rel` is that array, rounded to 4 decimals or null.
  - **Scene beats:** each scene becomes `chart` (4 s) then `video` (7 s, with the W5 zoom). Chips still jump to a scene's start. The chart beat covers the stage with an opaque panel (#0b0f14). The video keeps playing hidden underneath, and the camera already eases toward the scene's focus so the cut lands zoomed in. The cut is a 250 ms cross-fade. Hovering the chart pauses the beat timer.
  - **Chart style** (follow it exactly):
    - Plain canvas, no libraries. 2 px lines. Markers at least 8 px in diameter with a 2 px ring in the surface color.
    - A recessive grid (#1f2933, 1 px) and muted axis text (#8b98a5, 12 px). Axis titles in text ink, never in a series color.
    - One y-axis only.
    - Left/right series colors for marks are **#0e9fbf (left) and #8b5cf6 (right)** (validated for CVD on #0b0f14). Single-series charts use the scene accent.
    - Two-series charts carry a small legend plus direct labels ("Left", "Right").
    - Lines draw in left to right over 2 s, then annotations fade in.
    - Hover: a crosshair plus a tooltip giving the time and value of the nearest point.
  - **Charts:**
    - **Cadence:** x = time (s), y = step rate per stride (`2 · 60 / interval_s` for each consecutive same-foot strike pair, placed at the later strike), as dots by foot. A dashed median line labeled "median {cadence} spm".
    - **Trunk lean:** x = time, y = lean (°), a single amber line. A dashed mean line labeled "average {lean}°".
    - **Knee at strike:** x = strike time, y = knee angle at strike, as dots by foot. A light band for mean ± std and a dashed mean line labeled with the value.
    - **Bounce** (the headline chart): x = time, y = hip height as % of body height (`hip_height_rel · 100`), a single green line. For strides of the first stride's foot, put small markers at each `top` and `bottom` and a thin vertical bracket per stride. Label "average bounce {vo}% of body height".
    - **Summary:** no chart beat; it stays as it is.
- Acceptance:
  - `ruff check . && pytest -q`, `node --check`.
  - `test_metrics.py`: `body_height` on the fixture is 0.6. `hip_height` on the fixture with `hip_amp=0.015` has a peak-to-peak of about 0.05 and a median of about 0. NaN frames give NaN. The existing oscillation tests are unchanged.
  - `test_web.py`: `series.hip_height_rel` has n_frames entries, with null for NaN frames.
  - Lead checks in headless Chrome with the sample clip: screenshots of all four chart beats and the cut into the zoomed video. Hovering shows a tooltip. No label collisions. No console errors.
- Out of scope: new metrics, export.

### W7 — Immersive single-shot tour
- Why: user feedback on W6 was that the chart-only beats break the feel. The tour should be one continuous shot in which the video never leaves the screen. Measurements live *inside* the shot as overlays tied to the body (head-up-display style, "HUD"), not on separate screens.
- Goal: the guided tour plays as one unbroken, immersive sequence. Each scene's data, including the vertical oscillation graph, is drawn in-world, anchored to the body, while the camera glides between body parts.
- Files: `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`, `tests/test_web.py`
- Steps:
  - **Remove the W6 chart beats completely:** the chart panel, chart canvas, beat system, chart hover and cross-fade. Leave no dead code. Remove `beat` from the debug hook. Each scene is one continuous beat: 9 s for cadence, lean, knee and bounce, and 7 s for summary. The API stays unchanged; `series.hip_height_rel` is no longer required by the front end.
  - **Lower-third instead of the scene card:**
    - A gradient scrim (transparent → rgba(0, 0, 0, 0.65)) across the bottom ~30% of the stage, above the letterbox bar.
    - Bottom left on top of it: a small uppercase label in the scene accent ("02 · TRUNK LEAN"), then the big value in a 44 px monospace font that **counts up** from 0 over 900 ms (ease-out), then a one-line caption (15 px).
    - It slides up and fades in 400 ms after the scene starts, and fades out over the last 500 ms.
    - At phone width it stays overlaid on the video at a smaller size (value 30 px, caption 13 px).
    - Captions:
      - cadence: "Each heel strike is a step — this is your rhythm."
      - lean: "How far your torso tips forward from vertical."
      - knee: "Your knee angle the instant your foot lands. 180° is a straight leg."
      - bounce: "How much your hips rise and fall with every stride."
      - summary: "That's your stride."
    - Summary shows the four values in a single row (2×2 on phone) instead of one big number.
  - **Overlay fades:** every scene overlay is drawn with an `alpha` that eases in over the first 700 ms and out over the last 600 ms of the scene. The camera glides to the next focus during the fade. Nothing pops. The skeleton dims to 40% during scenes, as now.
  - **Cadence HUD (rhythm strip):**
    - Keep the heel rings.
    - Replace the full-clip timeline with a strip floating in-world just below the lowest foot point (projected), 60% of the stage width, centered on the feet's x.
    - It shows ±2 s of strikes scrolling right to left past a fixed center playhead, with left ticks on the top row and right ticks on the bottom row.
    - A tick brightens and glows as it crosses the playhead.
    - Clamp the strip inside the stage, above the lower-third.
  - **Lean HUD (dial):**
    - Keep the amber trunk line, dashed vertical and arc on the body.
    - Add a small semicircular dial (radius about 44 px) floating up and to the right of the shoulder midpoint (projected, clamped inside the stage). Its scale runs 0–20°, with ticks every 5°.
    - An amber needle shows the current frame's lean, smoothed with an EMA of about 150 ms. A small white mark shows the average.
    - The current value is drawn in the dial's center in a monospace font.
    - Remove the old lean pill label, since the dial replaces it.
  - **Knee HUD:**
    - Keep the freeze on strike frames, plus the pink leg, knee arc and angle pill.
    - On each freeze, add a white flash (a full-stage overlay at alpha 0.22 fading to 0 over 300 ms) and a camera punch: target scale × 1.08, easing back over 600 ms.
    - Add a strike history: a vertical stack of the last 5 strike angles beside the knee (on the side away from the body's facing direction), the newest at the top in pink and older ones fading.
  - **Bounce HUD (the in-world graph):**
    - Upgrade the seismograph into a live graph anchored to the hip midpoint. The trace covers the last 3 s (90 frames at 30 fps; use fps) and scrolls left from the current hip point.
    - x offset = `(frameIndex − i) · stageWidth · 0.5 / window_frames`, so 3 s spans half the stage. The y is each frame's projected hip-mid y.
    - Line: 2.5 px with a glow.
    - Faint horizontal guide lines at the current stride's top and bottom y, spanning the trace width.
    - For every stride of `strides[0].foot` whose `top` frame is inside the trace window, a thin vertical bracket at that point from bottom to top, with a small pill showing that stride's value ("8.4%"). Skip labels that would overlap.
    - A glowing dot at the current hip point.
  - **Summary:** no overlay. The camera eases to full frame and the skeleton returns to full opacity.
  - Keep the title card, intro, camera, backdrop, vignette, letterbox bars, chips, controls, reduced motion (count-ups snap, no flash or punch) and the debug hook (phase, scene, frameIndex, camera).
- Acceptance:
  - `ruff check . && pytest -q`, `node --check`.
  - `test_web.py`: the served index has the lower-third element and no chart panel.
  - Lead checks in headless Chrome with the sample clip:
    - a continuous tour (the video is visible in every screenshot)
    - each HUD: rhythm strip, lean dial, knee flash and history, bounce graph with stride labels
    - the lower-third count-up
    - the phone layout
    - no console errors
- Out of scope: API changes, new metrics.

### W8 — Speed ramps: slow-mo on key moments, fast transitions
- Goal: the tour uses speed ramps the way sports edits do. It speeds through camera moves and slows into the moments that matter: heel strikes, knee strikes and the peak of each bounce. A small speed marker appears while the speed is changing.
- Files: `src/runform/static/index.html`, `src/runform/static/style.css`, `src/runform/static/app.js`
- Steps:
  - **Rate model:** `baseRate` is the user's speed button (0.25/0.5/1×, default 0.5). Each frame computes a multiplier `m` from the phase, the scene, the scene time and frameIndex (look ahead 2 frames for event proximity). The target rate is `clamp(baseRate · m, 0.0625, 3)`. The applied rate eases toward the target (τ = 180 ms) and is written to `video.playbackRate` only when it changes by more than 0.01. Don't touch playbackRate while the video is paused (knee freeze); resume at the eased rate.
  - **Multipliers** (use smoothstep for every ramp, never steps):
    - **Scene transitions:** a bump to m = 3 (1.5× at default speed) across the last 600 ms of a scene and the first 700 ms of the next, peaking at the boundary.
    - **Tour start (after the intro):** m ramps from 0.4 to 1 over 1.5 s.
    - **Cadence:** slow-mo, m = 0.35, within ±3 frames of each **left** strike only, so each stride has one slow landing and one fast push-off.
    - **Trunk lean:** steady at m = 0.8, a calm contrast.
    - **Knee:** m eases from 1 to 0.3 over the 6 frames before each strike. The freeze happens as now, then m eases back from 0.3 to 1 over the next 6 frames.
    - **Bounce:** m = 0.4 within ±3 frames of each stride `top` (for `strides[0].foot`), so the hips seem to hang at the peak.
    - **Summary:** m eases up to 2 (1× at default) over 1 s.
    - **Free mode:** m = 1.
  - **Speed marker:**
    - A small mono pill at the top right of the stage, just below the letterbox bar. It shows "SLOW-MO 0.18×" when the effective rate is below 0.6 · baseRate, and "1.5×"-style text otherwise.
    - It fades in when |rate − baseRate| > 0.05 and fades out 600 ms after the rate settles.
  - Add `rate` (the current video.playbackRate) to the debug hook.
  - `prefers-reduced-motion`: m = 1 always, and no marker.
  - **W7 layout fixes:**
    - (a) Knee: the angle pill and the strike-history stack overlap. Put the pill on the facing side of the knee and the history on the opposite side, at least 16 px apart, and both clamped inside the safe area.
    - (b) Lean dial: it's clipped by the top letterbox bar. Clamp every floating HUD (dial, rhythm strip, history, labels) to the safe area: the stage minus the letterbox bars, the lower-third region, and an 8 px margin.
- Acceptance:
  - `ruff check . && pytest -q`, `node --check`.
  - Lead checks in headless Chrome with the sample clip, sampling `rate` over time:
    - cadence dips to about 0.18 near left strikes and returns to about 0.5
    - transitions reach about 1.5
    - knee eases into the freeze
    - bounce dips near tops
    - summary reaches about 1.0
    - the marker is visible during a slow-mo
    - the knee pill and history don't overlap, and the lean dial isn't clipped
    - no console errors
- Out of scope: API changes, audio.

### W9 — Locked framing per scene; tour ends on the summary
- Why: user feedback was that the per-frame auto-tracking zoom keeps shifting, which makes it hard to watch. Pick one framing per scene and hold it. Also, after the tour the page should stay on the summary instead of dropping into free mode.
- Goal: each scene holds a fixed, steady shot, and the camera moves only during the glide between scenes. When the tour finishes, the summary stays on screen.
- Files: `src/runform/static/app.js`, `tests/test_web.py` (only if an assertion needs updating)
- Steps:
  - **Fixed framings:** when the stage starts, compute one framing per scene and one for the intro close-up, from the **whole clip**:
    - For the focus joints, take the 5th–95th percentile of x and of y over every non-null frame. Pad as now (25%; bounce adds 40% vertically). Then scale = `0.8 · min(1/boxW, 1/boxH)` with the aspect handled as now, clamped to [1, 2.6], and the center clamped as now.
    - Cache these framings. Remove the per-frame focus box and its EMA tracking entirely.
  - **Camera moves only between framings:** when the target framing changes (intro → cadence → … → summary, or a chip jump), glide to it over 1.1 s with ease-in-out cubic. Within a scene the camera is exactly constant. Remove the knee "camera punch"; keep the white flash. Keep the intro pull-back from the close-up to full frame, as one deliberate move.
  - **The tour ends on the summary:** the summary scene has no end. After the bounce scene it stays on the summary indefinitely:
    - the lower-third with the four values stays visible
    - the camera stays at full frame and the skeleton at full opacity
    - the video keeps looping at the summary rate
    - the letterbox bars stay
    There's no automatic switch to free "Live tracking" mode anymore. The chips still jump to any scene, and choosing Summary again just stays there. Replay intro still restarts everything.
  - Reduced motion: the glides snap.
- Acceptance:
  - `ruff check . && pytest -q`, `node --check`.
  - Lead checks in headless Chrome with the sample clip:
    - sampling `camera` every 100 ms for 3 s in the middle of each scene shows it unchanged (to within 1e-6)
    - the transitions take about 1.1 s
    - 20 s after the summary starts, the scene is still `summary`, the lower-third is visible, and the video is still playing
    - no console errors
- Out of scope: API changes.

## Later (not in MVP)
- `web.py` recomputes the knee-at-strike angle per strike instead of sharing `metrics.knee_flexion_at_strikes` (which drops NaNs). Unify them with an option to keep NaNs.
- Deduplicate the body-height computation in `gait.py` and `metrics.py`, and the `frames_with_pose` count in `cli.py` and `report.py`.
- Stream frames instead of holding the whole video in memory (`read_frames` returns a list).
- Download the pose model atomically (temp file, then rename) so an interrupted download can't leave a corrupt cache.
- An annotated output video with the skeleton and angles drawn on it.
- Overstride measurement (the foot's horizontal offset from the hip at strike).
- Ground contact time.
- Front-view metrics.
