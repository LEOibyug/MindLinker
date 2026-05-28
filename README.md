# MindLinker

MindLinker is an open-source desktop learning assistant for course notes, theory study, and paper reading. It helps users build a grounded answer from local references, then turn important concepts into explorable links, explanation cards, inline questions, and a project-level knowledge graph.

The app is built with Electron, React, TypeScript, and Vite. It is designed as a local desktop application rather than a hosted chatbot page.

## Features

- **Project-based workspace**: organize learning projects as top-level folders with references and conversations under each project.
- **Reference-aware conversations**: import PDFs and other files, parse them locally, and use the parsed reference content when asking a model.
- **Configurable model providers**: add custom providers, choose the active provider, and use either OpenAI-compatible Chat Completions or OpenAI Responses-style APIs.
- **Main model and RAG separation**: keep the primary reasoning model separate from optional embedding/RAG configuration.
- **Structured PDF handling**: parse PDF pages into model-readable text and preserve page/image context for more difficult layouts.
- **Explanation links**: extract keywords or explain selected text, then render explained terms as inline links and cards.
- **Position questions**: ask questions at a specific location in a reply, continue the small-window thread, and save it back as a marker in the answer.
- **Knowledge graph**: inspect concept relationships for a conversation and open concept details from graph nodes.
- **Local persistence**: projects, conversations, parsed references, explanations, saved questions, and runtime logs are kept locally unless the user deletes them.
- **Runtime logs for debugging**: model requests, replies, and app events are recorded with secret filtering to make real provider issues diagnosable.

## Screenshots

Screenshots are not included yet. Contributions that add current UI screenshots are welcome.

## Getting Started

### Requirements

- Node.js 20 or newer
- npm
- A model provider API key if you want to call external models

### Install

```bash
npm install
```

### Run the Desktop App

```bash
npm run dev
```

This starts the Vite renderer and launches Electron. For a production-style local run:

```bash
npm run start:desktop
```

## Configuration

Open the app settings and add a model provider:

- Provider name
- Base URL
- API key
- API format: OpenAI-compatible Chat Completions or OpenAI Responses
- Main model name

RAG and embedding settings are configured separately from the main model. If RAG is disabled, references are sent as structured context to the configured main model instead of requiring an embedding model.

Do not commit API keys, private reference files, or generated runtime data.

## Development

Common commands:

```bash
npm test
npm run build
```

Useful scripts:

- `npm run dev`: run renderer and Electron in development mode.
- `npm run app`: alias for development mode.
- `npm run start:desktop`: build and launch Electron.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run build`: type-check and build the renderer.

The maintenance workflow is tracked in [MAINTENANCE.md](MAINTENANCE.md). Bug fixes should include focused verification and clear git commits.

## Project Structure

```text
electron/              Electron main and preload scripts
src/                   React renderer, domain logic, tests, and runtime logging
src/pdfReferences.ts   Local PDF/reference parsing helpers
src/runtimeLog.ts      Renderer-side runtime logging utilities
src/KnowledgeGraphView.tsx
                       Knowledge graph UI
MAINTENANCE.md         Maintenance and bug-fix log
```

## Data And Privacy

MindLinker stores app data locally. Model requests are sent only to the provider configured by the user, but those requests may include user prompts, parsed reference content, and selected conversation context. Review provider policies before using private or sensitive documents.

Runtime logs are intended for local debugging. They filter common secret fields, but you should still review logs before sharing them publicly.

## Roadmap

- App packaging and release artifacts for macOS.
- Stronger vector-store management and import/export flows.
- Better graph layout controls and graph export.
- More robust handling for scanned PDFs, tables, and multimodal page images.
- Optional project backup and sync.

## Contributing

Issues and pull requests are welcome. Please keep changes focused, include tests when behavior changes, and describe the user-facing impact clearly.

Before opening a pull request, run:

```bash
npm test
npm run build
```

## License

MindLinker is released under the MIT License. See [LICENSE](LICENSE) for details.
