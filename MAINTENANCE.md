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

### 2026-05-28 - Runtime Logging

- Added a structured runtime log for debugging real model-generation failures.
- Renderer events are kept in `mindlinker.runtimeLogs` as a browser/test fallback.
- Electron writes daily JSON-lines logs under the app user data directory in `runtime-logs/`.
- Log lifecycle:
  - Local fallback keeps the latest 600 entries from the last 7 days.
  - Electron prunes log files older than 7 days.
  - API keys, authorization headers, tokens, and secrets are filtered from metadata.
- Logged model lifecycle now includes:
  - main-answer request start, raw model reply, streaming progress, marker parsing;
  - explanation-chain request start, raw model reply, parsed explanation count;
  - title generation, inline question calls, manual explanation calls, and settings connection tests.
- Verification:
  - `npm test -- src/App.test.tsx -t "records model replies"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Graph Detail Formula Rendering

- Fixed knowledge-graph node detail text rendering for model explanations that contain bare math expressions such as `Σ a_i log(a_i/b_i) ≥ ...`.
- The graph detail renderer now:
  - strips leaked malformed explanation tags such as `[[jensen-inequality]]Jensen不等式`;
  - renders obvious bare formulas with KaTeX;
  - normalizes slash fractions inside those formulas to `\frac{...}{...}`.
- Scope intentionally stayed inside `KnowledgeGraphView.tsx`; main-answer and explanation-card renderers were not changed.
- Regression coverage:
  - added a graph-detail test for bare formulas, slash fractions, and leaked tags;
  - reran graph/formula-related tests to guard previous fixes.
- Verification:
  - `npm test -- src/App.test.tsx -t "renders bare formulas"`
  - `npm test -- src/App.test.tsx -t "graph|formula|math|tags"`
  - `npm test -- src/App.test.tsx -t "renders formulas inside model explanation cards|removes markdown wrappers from formula blocks|removes formula wrapper quotes|renders standalone quoted math-like lines"`
  - `npm test`
  - `npm run build`
