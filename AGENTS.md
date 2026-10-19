# Running Form Analyzer — agent rules

Read by Codex and by the lead. Plan and task list: `docs/PLAN.md`.

## Roles
- **Lead = planner and reviewer.** Plans, writes task specs, delegates, reviews every diff, runs the tests, and owns the architecture, `docs/PLAN.md`, and this file.
  - Lead does not write implementation code or tests in `src/` or `tests/`. All of that work goes to Codex.
  - Lead may make a trivial fix itself (a typo, or one line) only when it says so in the review notes.
- **Codex = implementer.** Does only the task it's handed and touches only the files named in the task. No refactoring, no redesign, and no new dependencies unless the task lists them.
  - If the task can't be done within those files, Codex stops and reports why instead of widening the scope.
  - Codex ends every task with a **task note** in this format:
    ```
    Changed: <one line for each file>
    Assumptions: <decisions not spelled out in the spec>
    Concerns: <known gaps or risks, or "none">
    ```

## Tracer bullets (vertical slices)
- Every task is a vertical slice. It runs end to end, from `runform analyze <video>` through to a value in the report, even if each layer does very little.
- No layer-only tasks such as "write all of gait.py" or "add smoothing." A layer grows only when a slice needs it.
- Every task's acceptance check includes a CLI-level test (`tests/test_cli.py`) proving the new output appears in the JSON report. Unit tests are extra, not a replacement.
- Web tasks (W*) run end to end from upload to something visible in the page. Their acceptance check includes a `tests/test_web.py` case proving the new data appears in the `/api/analyze` response, plus Lead's own check in a real browser.
- After every task, `runform analyze` still runs and `pytest` passes. `main` is never left broken.
- When Lead writes a task spec, it confirms the slice touches the CLI, the pipeline, and the report. If it doesn't, Lead re-cuts the task.

## Task loop (Lead runs this every time)
1. **Spec.** Lead writes the task in `docs/PLAN.md` using the template below.
2. **Clean tree.** Lead commits so that `git status` is clean before delegating.
3. **Delegate.** Lead hands the spec to Codex through the `codex:codex-rescue` agent, pasting in the full spec text. Only one writer at a time: Lead edits nothing while Codex is working.
4. **Review the diff.** Lead checks four things:
   - `git diff --stat`: only the named files changed. Anything else is rejected.
   - The diff itself: correctness, matches the spec, no scope creep, no dead code.
   - Tests: they actually check the behavior and aren't tautologies or over-mocked.
   - The tracer-bullet rule is met.
5. **Test.** Lead runs the commands itself, not trusting what Codex reports:
   - the task's acceptance check
   - the full check command (see Conventions)
   - once `samples/side_run.mp4` exists, the CLI smoke test: `runform analyze samples/side_run.mp4`
6. **Decide.**
   - **Pass:** commit as `T<n>: <goal>`, with Codex's task note as the commit body. Then mark the task done in `docs/PLAN.md`.
   - **Fail:** send Codex specific, numbered fixes and go back to step 4. After 2 failed rounds, Lead re-cuts the task (smaller slice or clearer spec) instead of looping on the same one.
7. **Report and continue.** Lead logs what passed, what was reviewed, and any concerns in the commit body, then moves straight to the next task. The user is not in the loop. Lead makes the decisions and only stops to ask when a decision truly needs the user (something only they can provide or verify, such as a new sample clip or a manual cadence count).

## Task template
```
### T<n> — <slice name>
- Goal: <user-visible result: what new value appears in the report>
- Files: <the exact list; Codex may touch only these>
- Steps: <short notes on the approach, where non-obvious>
- Acceptance: <exact commands that must pass, including a tests/test_cli.py case>
- Out of scope: <anything tempting but not part of this task>
```

## Conventions
- Tests live in `tests/`. Shared synthetic fixtures live in `tests/conftest.py`.
- Only `src/runform/pose.py` imports MediaPipe. Only `video.py` and `pose.py` import OpenCV.
- Check command: `ruff check . && pytest -q`. Both must pass. Ruff is configured in `pyproject.toml`.
- `samples/` holds real clips that the user adds. Codex never edits or generates anything in it.

## Stack
- Python 3.11+, OpenCV for video, MediaPipe Pose for body landmarks, NumPy and SciPy, pytest.
