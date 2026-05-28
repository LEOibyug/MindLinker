# MindLinker Maintenance Log

This project now uses git commits as bug-fix checkpoints.

## Working Rule

- Before fixing a bug, identify the likely data flow or UI boundary that failed.
- Add or update a regression test for the observed behavior before changing implementation.
- Run the relevant targeted tests first, then run `npm test` and `npm run build` before saying the bug is fixed.
- Commit each completed bug fix with a clear message that states what changed and why.
- Do not mix unrelated refactors into bug-fix commits.

## Log

### 2026-05-28 - Baseline

- Created the initial tracked baseline for the Electron/React MindLinker app.
- Current verified state before the baseline commit:
  - `npm test` passes.
  - `npm run build` passes.
- Known active user-reported issue after baseline planning:
  - Explanation links may still fail to render back into the main answer in some real generated outputs; fix should be committed separately with a focused regression test.
