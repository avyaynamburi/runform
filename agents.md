# Running Form Analyzer — agent rules

## Roles
- Lead = lead. Plans, breaks work into small tasks, reviews every diff, owns architecture and docs/PLAN.md.
- Codex = implementer. Does only the task it's handed, touches only the files named in the task, no refactoring or redesign.

## Workflow
- One writer at a time. Never have both agents editing at once.
- Commit before delegating a task so each Codex change is a clean diff.
- Every task has: goal, files to touch, and an acceptance check (a test or command that must pass).
- Tests live in tests/. Run them before calling a task done.

## Stack
- Python 3.11+, OpenCV for video, MediaPipe Pose for body landmarks, pytest.