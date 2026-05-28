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

### 2026-05-28 - Fenced Math And Inline Code Cleanup

- Fixed model replies that wrap display formulas in Markdown code fences such as ` ```math ` so backticks no longer leak into the reader.
- Fenced math content is now parsed as a formula block and rendered through KaTeX.
- Inline backtick snippets that are only mathematical symbols, such as `i` or `a_i/b_i`, no longer render as gray code pills.
- Tightened the math formula prompt to forbid code fences and inline-code formatting for math notation.
- Regression coverage:
  - fenced Log-sum formulas render as a single formula block without leaked backticks or `math` labels;
  - simple mathematical inline-code snippets do not become visible code pills;
  - main-answer prompts explicitly discourage code fences and inline-code math.
- Verification:
  - `npm test -- src/App.test.tsx -t "fenced math blocks|code fences or inline code"`
  - `npm test -- src/App.test.tsx -t "formula|math|markdown wrappers|inline math|inline code|fenced|code fences|backticks"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Markdown Quote Marker Cleanup

- Fixed model replies that use Markdown blockquote syntax for definitions or formulas so leading `>` characters no longer leak into the reader.
- The answer parser now strips a single line-level quote prefix before classifying text, inline math, and formula blocks.
- Tightened the math formula prompt to tell the main model not to use Markdown quote blocks for definitions, formulas, or derivations.
- Regression coverage:
  - blockquoted definition prose renders without visible `>` markers;
  - blockquoted standalone formulas still render through KaTeX;
  - the main-answer prompt explicitly forbids Markdown quote blocks for math-heavy content.
- Verification:
  - `npm test -- src/App.test.tsx -t "blockquote markers|code fences or inline code"`
  - `npm test -- src/App.test.tsx -t "formula|math|markdown wrappers|inline math|inline code|fenced|code fences|backticks|blockquote|quoted"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Markdown Table And List Continuation Rendering

- Added renderer support for Markdown tables in model answers so pipe-delimited rows no longer appear as raw text.
- Table cells reuse the existing inline renderer, so terms, bold text, and inline KaTeX formulas still render inside cells.
- Table parsing now ignores pipe characters inside inline math such as `|\mathcal{X}|`.
- Indented continuation lines after a list item now stay inside the preceding bullet and keep inline formula rendering, instead of being promoted to a separate formula block.
- Regression coverage:
  - Markdown tables render as `.answer-table` with header cells and inline formulas;
  - indented formula continuations remain inside their list item;
  - prior formula, Markdown wrapper, blockquote, heading, and list-item regressions remain covered.
- Verification:
  - `npm test -- src/App.test.tsx -t "markdown tables|indented formula continuations"`
  - `npm test -- src/App.test.tsx -t "formula|math|markdown wrappers|markdown tables|inline math|inline code|fenced|code fences|backticks|blockquote|quoted|list items|headings"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Unclosed Explainable Marker Cleanup

- Fixed malformed model output such as `[[ml:code-length]]码长` so internal marker ids no longer render into the answer.
- The cleanup now distinguishes two malformed cases:
  - a start marker immediately followed by visible term text is removed while keeping the visible term;
  - consecutive or empty malformed start markers still keep their id text as a fallback readable term.
- Regression coverage:
  - unclosed start markers before list terms do not expose `[[ml:...]]` or ids such as `code-length`;
  - previous malformed-marker, id-suffixed closing-marker, and streaming-marker regressions still pass.
- Verification:
  - `npm test -- src/App.test.tsx -t "unclosed explainable start markers|malformed explanation markers|malformed closing explainable markers|streaming visible"`
  - `npm test -- src/App.test.tsx -t "marker|markers|explanation text|explanation links|malformed|unclosed|streaming visible|formula|math|list items"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Manual Explanation Chain Generation

- Removed explanation-chain and marker instructions from the main-answer prompt so the first model call only generates user-visible Markdown.
- Stopped automatic keyword extraction and explanation generation after main answers finish, including conversations that complete in the background.
- Added a reader toolbar button for users to explicitly run keyword extraction and grouped explanation requests.
- Kept manual selection explanations available, without automatic recursive explanation generation.
- Added active provider selection coverage so main answers, extraction, explanations, and rewrites use the currently selected custom provider.
- Regression coverage:
  - main-answer prompts do not mention explanation chains or `[[ml:...]]` markers;
  - explanation generation starts only after clicking the reader button;
  - background conversations finish the main answer without auto-generating explanation links;
  - explanation cards still render formulas, malformed-marker cleanup, manual selected explanations, and persisted links.
- Verification:
  - `npm test`
  - `npm run build`
