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

### 2026-05-28 - Streaming Markers And Graph Crash Guard

- Fixed streaming preview truncation when a provider emits id-suffixed closing tags such as `[[/ml:stable-english-id]]`.
- Tightened the main-answer and nested-explanation prompts with explicit correct and incorrect marker examples:
  - correct: `[[ml:cross-entropy]]交叉熵[[/ml]]`
  - incorrect: `[[ml:cross-entropy]]交叉熵[[/ml:cross-entropy]]`
- Added a graph error boundary and a graph-build fallback panel so graph render/build failures no longer blank the whole app.
- Reduced runtime log pressure by sampling streaming progress instead of writing every chunk.
- Regression coverage:
  - streamed id-suffixed closing marker stays visible and strips markers;
  - graph error boundary displays a fallback instead of crashing the app.
- Verification:
  - `npm test -- src/App.test.tsx -t "keeps streaming visible|shows a graph fallback"`
  - `npm test -- src/App.test.tsx -t "graph|formula|math|streams the main answer|incomplete markup"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Formula Delimiter Normalization

- Tightened the main-answer prompt so models must emit display formulas with `$$` on their own lines and use plain `$...$` or `\(...\)` for inline formulas.
- Added renderer tolerance for model replies that still contain escaped inline dollar delimiters or inline `$$...$$` fragments inside prose.
- Prevented prose-prefixed `$$...$$` lines such as `即 $$...$$` from being mistaken for standalone formula blocks.
- Regression coverage:
  - escaped inline dollar formulas render through KaTeX without visible dollar markers;
  - prose-prefixed inline display delimiters no longer leak raw `$$` or TeX text into visible output;
  - main model requests include strict formula delimiter rules.
- Verification:
  - `npm test -- src/App.test.tsx -t "escaped inline dollar|inline display delimiters|strict formula delimiter"`
  - `npm test -- src/App.test.tsx -t "formula|math|quoted|markdown wrappers|inline math"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Marker Grammar Alignment

- Tightened both main-answer and explanation-chain prompts to forbid bare `[[id]]` markers and require `[[ml:id]]term[[/ml]]`.
- Unified malformed marker cleanup so leaked bare bracket ids such as `[[convex-function]]` render as plain text instead of exposing internal syntax.
- Applied the cleanup to main answers and explanation card text without changing valid explanation links.
- Regression coverage:
  - bare bracket ids are stripped from rendered main answers;
  - bare bracket ids are stripped from explanation card text;
  - main-answer requests include strict explainable marker grammar;
  - explanation-chain requests include the same nested marker grammar.
- Verification:
  - `npm test -- src/App.test.tsx -t "bare bracket ids|explainable marker grammar|nested marker grammar"`
  - `npm test -- src/App.test.tsx -t "marker|markers|explanation text|explanation links|malformed|graph details|streaming visible|marked terms"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Structured Prompt Protocol

- Reworked model-facing prompts into a shared `MindLinker Prompt Protocol v1` structure.
- Main answer, explanation chain, title generation, inline position questions, and rewrite drafts now use clear sections:
  - `【任务】`
  - `【输入】`
  - `【输出格式】` or `【JSON 输出协议】`
  - `【禁止事项】`
- Kept the previously verified marker and formula constraints intact while making them easier for models to follow.
- Regression coverage:
  - main-answer prompt includes structured task/input/output/marker/formula/prohibition sections;
  - explanation-chain prompt includes structured JSON and nested-marker rules;
  - title, inline question, and rewrite prompts use the same structured protocol;
  - existing marker, formula, title, rewrite, and inline-question behavior remains stable.
- Verification:
  - `npm test -- src/App.test.tsx -t "strict formula delimiter|strict explainable marker grammar|strict nested marker grammar|project title in parallel|inserted question|rewrite draft"`
  - `npm test -- src/App.test.tsx -t "prompt|marker|formula|math|title|位置提问|rewrite|重写|inline question|strict"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - XML Prompt Sections

- Replaced Chinese bracket prompt sections such as `【任务】` and `【输出格式】` with XML-style tags.
- Model-facing prompts now use sections such as:
  - `<task>`
  - `<input>`
  - `<output_format>`
  - `<json_output_protocol>`
  - `<explainable_marker_protocol>`
  - `<math_formula_protocol>`
  - `<prohibitions>`
- Kept the existing marker and formula instructions unchanged in meaning while making the structure friendlier for model parsing.
- Regression coverage:
  - main-answer, explanation-chain, title, inline-question, and rewrite prompts use XML-style sections;
  - old Chinese bracket sections are no longer present in checked model prompts;
  - marker, formula, title, rewrite, and inline-question behavior remains stable.
- Verification:
  - `npm test -- src/App.test.tsx -t "strict formula delimiter|strict explainable marker grammar|strict nested marker grammar|project title in parallel|inserted question|rewrite draft"`
  - `npm test -- src/App.test.tsx -t "prompt|marker|formula|math|title|位置提问|rewrite|重写|inline question|strict"`
  - `npm test`
  - `npm run build`
