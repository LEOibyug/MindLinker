# MindLinker Maintenance Log

This project now uses git commits as bug-fix checkpoints.

## Working Rule

- Before fixing a bug, identify the likely data flow or UI boundary that failed.
- Add or update a regression test for the observed behavior before changing implementation.
- Run the relevant targeted tests first, then run `npm test` and `npm run build` before saying the bug is fixed.
- Commit each completed bug fix with a clear message that states what changed and why.
- Do not mix unrelated refactors into bug-fix commits.

## Log

### 2026-05-29 - Project Deletion Rules Refactor

- Extracted project, conversation, and project-reference deletion data rules into `domain/projectLifecycle.ts`.
- Moved pure cleanup logic for project titles, included document ids, parsed references, reference cache, drafts, explanations, inline conversations, running conversations, and next active targets out of `App.tsx`.
- Kept user-facing delete confirmations, notices, and UI state transitions in `App.tsx`.
- Added domain tests for project deletion cleanup, conversation deletion cleanup, and reference id removal scoped to one project.
- Reduced `App.tsx` from roughly 1,735 lines to roughly 1,708 lines.
- Verification:
  - `npm test -- --run src/domain/projectLifecycle.test.ts`
  - `npm test -- --run src/app/App.test.tsx -t "delete|删除|referenceParseCache|parsed references|删除参考|删除项目|删除对话|confirmation"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Reader Context Menu Anchor Refactor

- Extracted reader right-click/selection anchor calculation from `App.tsx` into `components/reader/readerInteraction.ts`.
- Moved DOM helpers for selection offsets, element fallback offsets, caret-range lookup, and context-menu state construction behind a tested reader interaction boundary.
- Replaced the large `openReaderMenu` body in `App.tsx` with a single call to `buildReaderContextMenuState`.
- Added DOM-level tests for repeated text offsets, selection offsets, normalized explainable-marker text offsets, and explanation-card source context.
- Reduced `App.tsx` from roughly 1,829 lines to roughly 1,735 lines.
- Verification:
  - `npm test -- --run src/components/reader/readerInteraction.test.ts`
  - `npm test -- --run src/app/App.test.tsx -t "context menu|selection actions|manual explanation|right-click position|selected text|position question|位置提问|formula block|inline question markers|renders position question"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Inline Conversation Rules Refactor

- Moved inline-question draft, saved conversation, and summary-title construction rules into `domain/inlineConversations.ts`.
- Moved `InlineConversationDraft` ownership from the UI component to the domain layer while keeping a type re-export for UI callers.
- Replaced `App.tsx` inline object construction for selected-text/position questions and saved question threads with tested domain helpers.
- Added domain tests for selected-text labels, empty-selection position labels, saved conversation payloads, and title fallbacks.
- Reduced `App.tsx` from roughly 1,839 lines to roughly 1,829 lines.
- Verification:
  - `npm test -- --run src/domain/inlineConversations.test.ts`
  - `npm test -- --run src/app/App.test.tsx -t "inline question|inline conversation|位置提问|right-click position|selected text location|summary panel|streams inline"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Persistent State Refactor

- Extracted localStorage read/write and normalized persistent state handling from `App.tsx` into `services/persistentState.ts`.
- Replaced repeated app-level persistence setters for projects, providers, RAG settings, vector stores, inline conversations, parsed references, reference cache, conversation drafts, and explanations with `usePersistentState`.
- Preserved transient in-memory draft updates for streaming model output so partial chunks do not force localStorage writes on every token.
- Kept the one-time conversation-draft normalization write in `App.tsx` for stored legacy data migration.
- Added service-level tests for fallback reads, write failures, functional updates, normalization, and transient updates.
- Reduced `App.tsx` from roughly 1,962 lines to roughly 1,839 lines.
- Verification:
  - `npm test -- --run src/services/persistentState.test.tsx`
  - `npm test -- --run src/app/App.test.tsx -t "localStorage|persistence|persist|stored|restore|restores|conversationDrafts|inlineConversations|referenceParseCache|stream|streaming|draft persistence|legacy"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Project Lifecycle Logic Refactor

- Extracted project/conversation lifecycle rules from `App.tsx` into `domain/projectLifecycle.ts`.
- Moved pure logic for:
  - home-created project and first-conversation construction;
  - project-level conversation construction with the empty-prompt fallback;
  - reference-state label generation;
  - conversation-status to visible generation-phase mapping;
  - project navigation target selection.
- Kept async reference parsing, state persistence, UI cleanup, deletion side effects, and model generation orchestration in `App.tsx`.
- Added domain-level tests for fallback prompts/titles, reference-state labels, title truncation, and navigation phase mapping.
- Reduced `App.tsx` from roughly 1,991 lines to roughly 1,962 lines.
- Verification:
  - `npm test -- --run src/domain/projectLifecycle.test.ts`
  - `npm test -- --run src/app/App.test.tsx -t "starts a usable project|自主学习导读|home-style project starter|switches between learning projects|new conversation|background|running|opens an existing project"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Provider Diagnostics Refactor

- Extracted provider/model connection-test request construction from `App.tsx` into `services/providerDiagnostics.ts`.
- Kept settings validation, notices, and runtime logging in `App.tsx` while moving pure/network request logic for:
  - normalized provider test URLs;
  - provider `/models` checks with bearer auth;
  - model checks for both Chat Completions and Responses API formats;
  - readable HTTP failure errors.
- Added service-level tests for URL normalization, auth headers, chat/responses payloads, and failure handling.
- Reduced `App.tsx` from roughly 2,025 lines to roughly 1,991 lines.
- Verification:
  - `npm test -- --run src/services/providerDiagnostics.test.ts`
  - `npm test -- --run src/app/App.test.tsx -t "provider and model test buttons|provider test failures|API formats|Responses API|configured main provider|custom API providers"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Home Reference Logic Refactor

- Extracted home-screen reference preflight helpers from `App.tsx` into `services/homeReferences.ts`.
- Kept async parsing, local state, and project creation orchestration in `App.tsx` while moving pure logic for:
  - building pending home reference items from selected files;
  - summarizing parsing/ready/failed status text;
  - removing a pending reference and its backing file;
  - preserving the previous parsed-document behavior after a user removes an already parsed reference.
- Added module-level tests for file item generation, status text, and removal/document-resolution behavior.
- Reduced `App.tsx` from roughly 2,040 lines to roughly 2,025 lines.
- Verification:
  - `npm test -- --run src/services/homeReferences.test.ts`
  - `npm test -- --run src/app/App.test.tsx -t "home references|attached home reference|appends home references|prepares home references|prominent parsing|starts a usable project|home-style project starter|removes an attached home reference"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Source Directory Structure Refactor

- Reorganized `src/` into responsibility-oriented directories:
  - `app/` for application entry, shell, workspace composition, and app-level tests;
  - `components/` for UI components grouped by home, reader, panels, sidebar, and inline conversation;
  - `domain/` for domain types and pure domain helpers;
  - `services/` for model, PDF/reference, runtime log, provider settings, and reference cache services.
- Moved tests alongside their implementation files to keep component and service boundaries easy to discover.
- Updated `index.html` to load `src/app/main.tsx` and adjusted the app stylesheet import to keep the Electron/Vite entry working.
- Kept behavior unchanged; this commit is a structural move only.
- Verification:
  - `npm run build -- --mode development`
  - `npm test`

### 2026-05-29 - Reference Cache Logic Refactor

- Extracted local reference-cache helpers from `App.tsx` into `referenceCache.ts`.
- Kept asynchronous parsing and UI status orchestration in `App.tsx` while moving pure logic for:
  - uploaded-file fingerprinting;
  - cloning cached parsed references into project-local document ids;
  - creating cache entries without preserving project-local ids;
  - pruning parsed references only when no remaining project still uses them;
  - pruning cache entries against the remaining parsed reference set.
- Added module-level tests for cache cloning, cache entry creation, and cross-project safe pruning.
- Reduced `App.tsx` from roughly 2,053 lines to roughly 2,040 lines.
- Verification:
  - `npm test -- --run src/referenceCache.test.ts`
  - `npm test -- --run src/App.test.tsx -t "reference|参考|parsed reference|home references|delete reference|导入|删除参考|cache"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Provider Settings Logic Refactor

- Extracted provider configuration rules from `App.tsx` into `providerSettings.ts`.
- Kept notification, persistence, and network test orchestration in `App.tsx` while moving pure logic for:
  - active provider fallback selection;
  - creating a default custom provider;
  - adding main-model rows;
  - updating provider fields and model names;
  - deleting providers while keeping a valid active provider;
  - preventing the last provider or last model from disappearing.
- Added module-level tests for provider creation, model defaults, scoped updates, active-provider fallback, provider deletion, and model deletion.
- Reduced `App.tsx` from roughly 2,106 lines to roughly 2,053 lines.
- Verification:
  - `npm test -- --run src/providerSettings.test.ts`
  - `npm test -- --run src/SettingsPage.test.tsx src/App.test.tsx -t "provider|供应商|模型|API 格式|RAG|settings"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Workspace View Refactor

- Extracted the workspace three-column composition from `App.tsx` into `WorkspaceView.tsx`.
- Kept application state, model orchestration, persistence, and event handlers in `App.tsx` while moving presentation composition for:
  - project sidebar;
  - reader toolbar;
  - reader content surface;
  - reader context menu;
  - explanation panel.
- Exported the existing component prop types so `WorkspaceView` can compose those boundaries without duplicating contracts.
- Added component-level tests for workspace composition, automatic-explanation toolbar wiring, settings-hidden state, and reader context-menu rendering.
- Reduced `App.tsx` from roughly 2,112 lines to roughly 2,106 lines while moving the JSX surface behind a named component boundary.
- Verification:
  - `npm test -- --run src/WorkspaceView.test.tsx`
  - `npm test -- --run src/App.test.tsx -t "renders the reader-centered workspace|context menu|knowledge graph|automatic explanation|summary panel|folder with reference|project titles|new conversation|inline question"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - App Chrome Refactor

- Extracted the repeated application shell chrome from `App.tsx` into `AppChrome.tsx`.
- Kept app state and navigation decisions in `App.tsx` while moving presentation for:
  - shared MindLinker topbar and subtitle;
  - home/workspace settings entry;
  - workspace vector-store entry;
  - dismissible runtime notice toast;
  - shared app-shell wrapper click handling.
- Added component-level tests for brand/subtitle rendering, settings action, vector-store action, child rendering, and notice dismissal.
- Reduced `App.tsx` from roughly 2,158 lines to roughly 2,112 lines.
- Verification:
  - `npm test -- --run src/AppChrome.test.tsx`
  - `npm test -- --run src/App.test.tsx -t "MindLinker shell|opens settings from a compact toolbar button|manages local vector stores|switches between learning projects|provider test failures|auto-dismisses ordinary status"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Reader Content Refactor

- Extracted the central reader content surface from `App.tsx` into `ReaderContent.tsx`.
- Kept workspace orchestration in `App.tsx` while moving presentation for:
  - knowledge-graph rendering and graph error fallback;
  - in-reader new-conversation canvas;
  - generated answer rendering and content/annotation loading states;
  - model configuration/failure state panels;
  - fallback saved inline-question markers;
  - reference-change patch/full-rewrite controls;
  - selected-text rewrite draft preview.
- Added component-level coverage for generated answer rendering, KaTeX rendering, loading states, fallback inline-question markers, reference update callbacks, rewrite draft display, graph error fallback, and the new-conversation branch.
- Reduced `App.tsx` from roughly 2,260 lines to roughly 2,158 lines.
- Verification:
  - `npm test -- --run src/ReaderContent.test.tsx`
  - `npm test -- --run src/App.test.tsx -t "keeps a generated answer visible|knowledge graph|reference|rewrite draft|inline question markers|model state|生成回答"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Reader Controls Refactor

- Extracted reading toolbar and reader context menu presentation from `App.tsx` into `ReaderControls.tsx`.
- Kept the existing reader business actions in `App.tsx` while moving UI for:
  - search placeholder strip;
  - reader / knowledge-graph view switching;
  - `自动解释关键词` availability and disabled state;
  - position-question context-menu action;
  - selected-text explanation and rewrite actions.
- Added component-level tests for toolbar mode switching, automatic explanation visibility/disabled state, and context-menu selected/non-selected states.
- Reduced `App.tsx` from roughly 2,312 lines to roughly 2,260 lines.
- Verification:
  - `npm test -- --run src/ReaderControls.test.tsx`
  - `npm test -- --run src/App.test.tsx -t "automatic explanation|context menu|manual explanation|rewrite draft|knowledge graph"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Home Page Refactor

- Extracted the home project list and starter composer from `App.tsx` into `HomePage.tsx`.
- Kept home business flow in `App.tsx` while moving presentation for:
  - existing project list;
  - drag/drop and picker reference import area;
  - horizontal learning prompt composer;
  - main-answer style selection;
  - local reference parsing status and removable pending-reference pills.
- Added component-level tests for project opening, prompt editing, answer-mode selection, file forwarding, reference removal, empty project state, and settings-hidden state.
- Reduced `App.tsx` from roughly 2,402 lines to roughly 2,312 lines.
- Verification:
  - `npm test -- --run src/HomePage.test.tsx`
  - `npm test -- --run src/HomePage.test.tsx src/App.test.tsx -t "home screen|home project list|home prompt|home references|appends home references|removes an attached home reference|prominent parsing|empty|main-answer style|home-style project starter"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Explanation Panel Refactor

- Extracted the right-side explanation chain and summary UI from `App.tsx` into `ExplanationPanel.tsx`.
- Kept `App.tsx` responsible for state, persistence, model calls, and event orchestration while moving presentation for:
  - explanation/summary mode switching;
  - selected-text explanation progress;
  - annotation-generation progress;
  - reference-change explanation impacts;
  - explanation card stack and nested explanation links;
  - summary lists for explanations and saved inline questions.
- Added component-level tests for chain-mode interactions, summary-mode interactions, KaTeX rendering in explanation text, rewrite callbacks, and inline-question summary callbacks.
- Reduced `App.tsx` from roughly 2,526 lines to roughly 2,402 lines.
- Verification:
  - `npm test -- --run src/ExplanationPanel.test.tsx`
  - `npm test -- --run src/ExplanationPanel.test.tsx src/App.test.tsx -t "summary panel|manual explanation progress|explanation text|参考状态变更|解释链"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Sidebar Style Regression Fix

- Restored the extracted project sidebar to the existing workspace sidebar style contract.
- Root cause:
  - the refactor renamed key style hooks from `library-panel`, `panel-title`, and `project-folder-button`;
  - the existing CSS no longer matched, so project folder controls fell back to native button styling.
- Fixed `ProjectSidebar.tsx` to keep the old layout/style classes while preserving the extracted component boundary.
- Added component coverage to assert the sidebar keeps `library-panel`, `project-folder-button`, and folder metadata text.
- Verification:
  - `npm test -- --run src/ProjectSidebar.test.tsx src/App.test.tsx -t "folder with reference|project titles|persists parsed reference"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Project Sidebar And New Conversation Refactor

- Extracted workspace project navigation into `ProjectSidebar.tsx`.
- Extracted the in-project new-conversation composer into `NewConversationPanel.tsx`.
- Preserved the existing sidebar behavior while moving it out of `App.tsx`:
  - project folders keep their tree semantics and active-folder switching;
  - reference import still exposes `引入参考`;
  - project title editing and model-title generation controls remain available;
  - running/deleting conversation and reference states are still rendered in the owning rows.
- Added component-level tests for the extracted sidebar and new-conversation composer.
- Reduced `App.tsx` from roughly 2,711 lines to roughly 2,526 lines.
- Verification:
  - `npm test -- --run src/NewConversationPanel.test.tsx src/ProjectSidebar.test.tsx`
  - `npm test -- --run src/App.test.tsx -t "folder with reference|persists parsed reference|project titles"`
  - `npm test`
  - `npm run build -- --mode development`

### 2026-05-29 - Settings And Vector Store UI Refactor

- Extracted settings UI from `App.tsx` into `SettingsPage.tsx`.
- Extracted local vector-store management dialog from `App.tsx` into `VectorStoreDialog.tsx`.
- Kept the existing UI copy, aria labels, provider/RAG interactions, and vector-store actions stable.
- Added component-level tests for:
  - provider format changes, RAG toggling, visual-model hint, and model test callbacks;
  - vector-store totals, cleanup, rebuild, and close callbacks.
- Reduced `App.tsx` from roughly 2,943 lines to roughly 2,711 lines.
- Verification:
  - `npm test -- --run src/SettingsPage.test.tsx src/VectorStoreDialog.test.tsx`
  - `npm test`
  - `npm run build`

### 2026-05-29 - App Module Boundary Refactor

- Continued reducing `App.tsx` by extracting non-UI responsibilities into focused modules:
  - `conversationDrafts.ts` for conversation draft types, normalization, answer-mode prompts, fallback answers, title cleanup, and inline-conversation storage normalization.
  - `markedTerms.ts` for explanation marker parsing, malformed marker cleanup, visible streaming text cleanup, keyword JSON parsing, explanation JSON parsing, and term batching.
  - `modelClient.ts` for provider/model selection, OpenAI-compatible and Responses requests, SSE stream parsing, model payload text extraction, title generation, keyword extraction, explanation generation, rewrite prompt construction, and inline question calls.
- Kept `App.tsx` focused on application state orchestration, UI event handlers, persistence wiring, and rendering.
- Added module-level regression coverage for the extracted helpers so future contributors can test protocol parsing and draft normalization without mounting the full app.
- Reduced `App.tsx` from roughly 4,179 lines to roughly 2,944 lines while keeping behavior stable.
- Verification:
  - `npm test -- --run src/conversationDrafts.test.ts src/markedTerms.test.ts src/modelClient.test.ts`
  - `npm test`
  - `npm run build`

### 2026-05-29 - Explanation Panel Summary

- Added an "解释 / 汇总" switch to the explanation panel.
- The summary view now lists:
  - all explanation items for the current conversation;
  - all saved inline position questions for the current conversation.
- Clicking a summary explanation opens its explanation card.
- Clicking a summary question switches back to the reader, scrolls toward the saved marker when present, and opens the inline question dialog.
- Saved inline questions now request a short model-generated title; if title generation is unavailable, the first user question remains the fallback title.
- Fixed explanation links inside Markdown headings so concepts in large/bold heading blocks are clickable like concepts in paragraphs.
- Improved empty-selection right-click anchoring by falling back to the clicked paragraph/list item/heading/formula block instead of arbitrary inner text.
- Regression coverage:
  - heading concepts render as explanation links;
  - summary panel lists explanations and titled questions;
  - saved inline questions can receive model-generated titles;
  - position question markers still render once per line.
- Verification:
  - `npm test -- --run src/App.test.tsx -t "markdown headings|summary panel|model to title saved inline questions|right-click position|position question markers"`
  - `npm test -- --run src/App.test.tsx`
  - `npm run build`

### 2026-05-29 - Home Reference Append Imports

- Fixed the home reference file picker so importing files multiple times appends to the pending reference list instead of replacing earlier files.
- Kept drag-and-drop behavior aligned with the picker by using the same append path.
- Cleared the file input after each selection so selecting the same filename again can still fire a change event.
- Regression coverage:
  - first and second picker imports both remain visible;
  - starting a project after multiple imports carries all pending references into the workspace;
  - existing home reference remove and home start flows remain stable.
- Verification:
  - `npm test -- --run src/App.test.tsx -t "appends home references|home references|attached home reference|starts a usable project from the home prompt"`

### 2026-05-29 - Workspace New Project Starter

- Changed the workspace "新建项目" action to open the same home-style project starter used on first launch instead of creating an empty placeholder project.
- The starter resets any previous home prompt, pending files, parsed-reference state, and answer-style choice so a new project begins from a clean composer.
- Project creation, reference import, title fallback, and initial conversation generation continue to use the existing home-start flow.
- Regression coverage:
  - clicking "新建项目" from the workspace shows the `Let's link your mind` starter with reference import;
  - starting from that composer creates a normal deletable project with imported references;
  - ordinary notices still auto-dismiss.
- Verification:
  - `npm test -- --run src/App.test.tsx -t "home-style project starter|auto-dismisses ordinary status"`

### 2026-05-29 - Answer Rendering Boundary Refactor

- Extracted answer rendering out of `App.tsx` into focused modules:
  - `answerRendering.tsx` for Markdown-ish answer parsing, KaTeX rendering, tables, explanation links, and inline-question marker placement.
  - `InlineConversationUi.tsx` for the inline question dialog and marker button.
  - `explanations.ts`, `inlineConversations.ts`, and `textAnchors.ts` for shared domain helpers.
- Kept behavior intentionally stable while reducing `App.tsx` by roughly 850 lines.
- Added module-level regression coverage for table rendering and formula normalization so future renderer work can be tested without mounting the full application.
- Verification:
  - `npm test -- --run src/answerRendering.test.tsx`
  - `npm test -- --run src/App.test.tsx`
  - `npm run build`

### 2026-05-29 - Knowledge Graph Edge Pruning

- Investigated a real runtime log entry where the graph view failed with `node not found: concept-即时码`.
- Root cause:
  - project knowledge graphs were capped to 28 visible nodes;
  - edge filtering still checked the pre-cap node map, so some visible graph data referenced nodes that had already been hidden.
- Fixed graph construction to filter edges against the final visible node set before passing data to the force layout.
- Regression coverage:
  - graph data with more explanation concepts than the node limit no longer renders the graph failure fallback;
  - hidden concepts are omitted together with their edges.
- Verification:
  - `npm test -- --run src/App.test.tsx -t "drops graph edges"`
  - `npm test -- --run src/App.test.tsx`
  - `npm run build`

### 2026-05-29 - Line-End Inline Question Markers

- Fixed a rendering bug where one saved position question could appear multiple times on the same line when the line contained repeated explanation links.
- New position-based inline question markers now render once at the end of the matched line instead of being injected into every split text fragment.
- Multiple saved questions on the same line render as multiple compact markers at that line end.
- Legacy selection-text markers still render beside their selected text for backward compatibility.
- Regression coverage:
  - repeated explanation links no longer duplicate a position-question marker;
  - multiple questions on one line appear as multiple line-end markers;
  - existing selected-text markers, saved inline questions, explanation links, formulas, and manual explanations remain stable.
- Verification:
  - `npm test -- src/App.test.tsx -t "renders position question markers once|anchors saved inline question markers|saves a marker for a right-click position|asks and saves an inline question"`
  - `npm test -- src/App.test.tsx -t "inline question|位置提问|saved inline question|manual explanation|selected text|formula|math|marker|markers|explanation links"`
  - `npm test`
  - `npm run build`

### 2026-05-29 - Home Reference Removal

- Added a remove button to each reference attached on the home screen before a project is created.
- Removing a home reference now updates the visible preflight list, the pending file set, and the parsed-reference promise used by project creation.
- Guarded the parsing race where a deleted reference could finish parsing later and still be imported into the new project.
- Regression coverage:
  - attached home references can be removed before starting;
  - removed references do not appear in the created project;
  - existing home reference preparation and home project creation flows remain stable.
- Verification:
  - `npm test -- src/App.test.tsx -t "home references|attached home reference|starts a usable project from the home prompt|starts a project from home with references"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Inline Question Position Anchors

- Fixed saved inline question markers so new conversations anchor to a character position in the rendered answer instead of matching every repeated text fragment.
- Empty-selection right-click questions now save a marker near the clicked answer position instead of disappearing after save.
- Inline question answers now request streaming model output and update the small dialog while chunks arrive.
- Moved the inline question text input into a local dialog component so typing no longer re-renders the whole workspace on every keypress.
- Adjusted the dialog interaction:
  - Enter sends the current question.
  - Ctrl+Enter or Cmd+Enter inserts a newline.
  - The primary action is now "发送"; saving is a compact secondary action.
- Regression coverage:
  - repeated phrases only receive one marker at the saved position;
  - empty-selection right-click questions leave a saved marker;
  - inline question answers stream into the dialog;
  - existing selected-text inline markers, formulas, and manual explanations continue to render.
- Verification:
  - `npm test -- src/App.test.tsx -t "anchors saved inline question markers|saves a marker for a right-click position|streams inline question answers"`
  - `npm test -- src/App.test.tsx -t "inline question|位置提问|saved inline question|manual explanation|selected text|formula|math"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Responses Text Extraction And LaTeX JSON Recovery

- Investigated the latest runtime log for selected-text explanations and inline questions.
- Root cause:
  - OpenAI Responses non-streaming replies were returning text under `output[].content[].text`, while the shared extractor only read `output_text` and chat-completions fields.
  - Some compatible providers returned explanation JSON with raw LaTeX backslashes such as `\(` and `\frac`, which made `JSON.parse` fail or corrupt formula text.
- Fixed the shared model payload extractor so selected explanations, title generation, keyword extraction, and inline questions can read non-streaming Responses message content.
- Added a tolerant explanation JSON parse fallback that protects LaTeX-style backslashes before retrying JSON parsing.
- Regression coverage:
  - selected-text explanations parse non-streaming Responses `output.content` payloads;
  - inline question answers parse non-streaming Responses `output.content` payloads;
  - explanation JSON with raw LaTeX backslashes parses and still renders formulas with KaTeX.
- Verification:
  - `npm test -- src/App.test.tsx -t "non-streaming Responses output content|unescaped backslashes"`
  - `npm test -- src/App.test.tsx -t "manual explanation|selected text|inline question|位置提问|Responses|runtime log|unescaped backslashes"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Selection Explanations And Inline Question Anchors

- Fixed selected-text explanations created from inside an explanation card so the request includes the active explanation card body as local context.
- Hardened explanation JSON parsing for common model replies that wrap JSON in prose, fenced `json` blocks, or return a single explanation object instead of an array.
- Ensured a failed selected-text explanation does not poison later selected-text explanation attempts.
- Rendered saved inline question markers at selected-text anchors inside the answer body; only non-anchorable saved questions remain in the fallback list.
- Regression coverage:
  - explanation-card selected text uses `当前解释` context and accepts wrapped object JSON;
  - selected-text explanation recovers after an empty-model result;
  - saved inline question markers appear beside their selected answer text.
- Verification:
  - `npm test -- src/App.test.tsx -t "wrapped object JSON|recovers after a failed selected-text explanation|saved inline question markers"`
  - `npm test -- src/App.test.tsx -t "manual explanation|selected text|inline question|位置提问|formula|math|explanation text"`
  - `npm test`
  - `npm run build`

### 2026-05-28 - Inline Question Dialog Rendering

- Fixed the inline "在此处提问" dialog so opening it no longer dims the workspace behind it.
- Reused the existing answer Markdown renderer for inline question messages, so inline and block formulas render through KaTeX instead of appearing as raw `$...$` text.
- Kept the change scoped to the inline question dialog; settings and vector-store modals still use their normal backdrop behavior.
- Regression coverage:
  - inline question dialog now asserts a transparent dialog-specific backdrop;
  - saved and active inline question answers render formulas with KaTeX;
  - formula-related renderer tests continue to cover main answers and explanation cards.
- Verification:
  - `npm test -- src/App.test.tsx -t "asks and saves an inline question thread"`
  - `npm test -- src/App.test.tsx -t "inline question|在此处提问|formula|math"`
  - `npm test`
  - `npm run build`

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
