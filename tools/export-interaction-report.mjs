#!/usr/bin/env node
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const storageKeys = [
  "mindlinker.projects",
  "mindlinker.conversationDrafts",
  "mindlinker.conversationExplanations",
  "mindlinker.inlineConversations",
  "mindlinker.parsedReferences",
  "mindlinker.referenceParseCache",
  "mindlinker.runtimeLogs"
];

const parseArgs = (argv) => {
  const options = {
    userData: defaultUserDataDir(),
    logs: [],
    state: "",
    out: path.resolve("mindlinker-interaction-report.md"),
    extractImages: false,
    all: false,
    since: "",
    until: "",
    conversationId: "",
    projectId: "",
    message: "",
    maxPageChars: 2400,
    maxLogChars: 8000,
    maxImageDataChars: 120
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--user-data") {
      options.userData = path.resolve(argv[++index] ?? "");
    } else if (arg === "--logs") {
      options.logs.push(path.resolve(argv[++index] ?? ""));
    } else if (arg === "--state") {
      options.state = path.resolve(argv[++index] ?? "");
    } else if (arg === "--out" || arg === "-o") {
      options.out = path.resolve(argv[++index] ?? "");
    } else if (arg === "--extract-images") {
      options.extractImages = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--since") {
      options.since = argv[++index] ?? "";
    } else if (arg === "--until") {
      options.until = argv[++index] ?? "";
    } else if (arg === "--conversation-id") {
      options.conversationId = argv[++index] ?? "";
    } else if (arg === "--project-id") {
      options.projectId = argv[++index] ?? "";
    } else if (arg === "--message") {
      options.message = argv[++index] ?? "";
    } else if (arg === "--max-page-chars") {
      options.maxPageChars = Number(argv[++index] ?? options.maxPageChars);
    } else if (arg === "--max-log-chars") {
      options.maxLogChars = Number(argv[++index] ?? options.maxLogChars);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

function defaultUserDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "mindlinker");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "mindlinker");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "mindlinker");
}

const printHelp = () => {
  console.log(`MindLinker interaction report exporter

Usage:
  node tools/export-interaction-report.mjs [options]
  npm run export:interactions -- [options]

Options:
  --user-data <dir>       Electron userData directory. Defaults to the current platform's MindLinker directory.
  --logs <file-or-dir>    Runtime log file or directory. Can be repeated. Defaults to <user-data>/runtime-logs.
  --state <file>          JSON file containing exported localStorage state or raw MindLinker storage keys.
  --out, -o <file>        Markdown output path. Defaults to ./mindlinker-interaction-report.md.
  --extract-images        Write data-url images to an assets folder and link them from the report.
  --all                   Export all available projects/logs. By default, exports the latest conversation.
  --since <date>          Keep logs at or after this date/time, e.g. 2026-06-02 or 2026-06-02T01:00:00Z.
  --until <date>          Keep logs before this date/time.
  --project-id <id>       Keep logs and project sections matching a project id.
  --conversation-id <id>  Keep logs and conversation sections matching a conversation id.
  --message <text>        Keep logs whose message contains the text.
  --max-page-chars <n>    Max characters shown per parsed reference page. Defaults to 2400.
  --help, -h              Show this help.

State JSON formats accepted by --state:
  1. {"mindlinker.projects":[...], "mindlinker.conversationDrafts":{...}}
  2. {"projects":[...], "conversationDrafts":{...}, "parsedReferences":[...]}
  3. A browser localStorage dump where values are JSON strings.

Without filters, the default scope is the latest conversation found in runtime logs or persisted projects.
Without --state, the tool will try a conservative scan of Chromium Local Storage LevelDB files.
Runtime logs are read from Electron's runtime-logs JSONL files when available.`);
};

const readJsonFile = async (filePath) => {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
};

const normalizeState = (raw) => {
  const read = (canonical, short, fallback) => {
    const value = raw?.[canonical] ?? raw?.[short];
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value ?? fallback;
  };
  return {
    projects: read("mindlinker.projects", "projects", []),
    conversationDrafts: read("mindlinker.conversationDrafts", "conversationDrafts", {}),
    conversationExplanations: read("mindlinker.conversationExplanations", "conversationExplanations", {}),
    inlineConversations: read("mindlinker.inlineConversations", "inlineConversations", []),
    parsedReferences: read("mindlinker.parsedReferences", "parsedReferences", []),
    referenceParseCache: read("mindlinker.referenceParseCache", "referenceParseCache", {}),
    runtimeLogs: read("mindlinker.runtimeLogs", "runtimeLogs", [])
  };
};

const decodeUtf16JsonNear = (buffer, start) => {
  const valueStart = buffer.indexOf(Buffer.from([0x5b, 0x00]), start);
  const objectStart = buffer.indexOf(Buffer.from([0x7b, 0x00]), start);
  const jsonStart =
    valueStart < 0 ? objectStart : objectStart < 0 ? valueStart : Math.min(valueStart, objectStart);
  if (jsonStart < 0) {
    return null;
  }
  const maxEnd = Math.min(buffer.length, jsonStart + 30_000_000);
  let best = null;
  for (let end = jsonStart + 2; end < maxEnd; end += 2) {
    const byte = buffer[end];
    const next = buffer[end + 1];
    if ((byte !== 0x5d && byte !== 0x7d) || next !== 0x00) {
      continue;
    }
    const text = buffer.subarray(jsonStart, end + 2).toString("utf16le");
    try {
      best = JSON.parse(text);
    } catch {
      continue;
    }
  }
  return best;
};

const scanLevelDbState = async (userDataDir) => {
  const levelDbDir = path.join(userDataDir, "Local Storage", "leveldb");
  if (!existsSync(levelDbDir)) {
    return {};
  }
  const files = await fs.readdir(levelDbDir);
  const candidates = files
    .filter((name) => /\.(log|ldb)$/i.test(name))
    .map((name) => path.join(levelDbDir, name));
  const state = {};
  for (const file of candidates) {
    const buffer = await fs.readFile(file);
    for (const key of storageKeys) {
      const keyBuffer = Buffer.from(key);
      let offset = 0;
      while (offset >= 0) {
        const found = buffer.indexOf(keyBuffer, offset);
        if (found < 0) {
          break;
        }
        const parsed = decodeUtf16JsonNear(buffer, found + keyBuffer.length);
        if (parsed !== null) {
          state[key] = parsed;
        }
        offset = found + keyBuffer.length;
      }
    }
  }
  return state;
};

const collectLogFiles = async (options) => {
  const inputs = options.logs.length > 0 ? options.logs : [path.join(options.userData, "runtime-logs")];
  const files = [];
  for (const input of inputs) {
    if (!existsSync(input)) {
      continue;
    }
    const stat = await fs.stat(input);
    if (stat.isDirectory()) {
      const children = await fs.readdir(input);
      files.push(
        ...children
          .filter((name) => name.endsWith(".log"))
          .map((name) => path.join(input, name))
      );
    } else {
      files.push(input);
    }
  }
  return [...new Set(files)].sort();
};

const readRuntimeLogs = async (options) => {
  const entries = [];
  for (const file of await collectLogFiles(options)) {
    const text = await fs.readFile(file, "utf8");
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        try {
          entries.push({ ...JSON.parse(line), file });
        } catch {
          entries.push({
            timestamp: "",
            level: "warn",
            scope: "log",
            message: "无法解析日志行",
            metadata: { file, line }
          });
        }
      });
  }
  return entries.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
};

const parseFilterTime = (value, endOfDay = false) => {
  if (!value) {
    return null;
  }
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : value;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
};

const filterLogs = (logs, options) => {
  const since = parseFilterTime(options.since);
  const until = parseFilterTime(options.until, true);
  const message = options.message.toLocaleLowerCase();
  return logs.filter((entry) => {
    const metadata = entry.metadata ?? {};
    const timestamp = Date.parse(entry.timestamp ?? "");
    if (since !== null && !Number.isNaN(timestamp) && timestamp < since) {
      return false;
    }
    if (until !== null && !Number.isNaN(timestamp) && timestamp > until) {
      return false;
    }
    if (options.projectId && metadata.projectId !== options.projectId) {
      return false;
    }
    if (options.conversationId && metadata.conversationId !== options.conversationId) {
      return false;
    }
    if (message && !String(entry.message ?? "").toLocaleLowerCase().includes(message)) {
      return false;
    }
    return true;
  });
};

const filterState = (state, options) => {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const filteredProjects = projects
    .filter((project) => !options.projectId || project.id === options.projectId)
    .map((project) => ({
      ...project,
      conversations: Array.isArray(project.conversations)
        ? project.conversations.filter((conversation) => !options.conversationId || conversation.id === options.conversationId)
        : []
    }))
    .filter((project) => !options.conversationId || project.conversations.length > 0);
  const conversationIds = new Set(filteredProjects.flatMap((project) => project.conversations.map((conversation) => conversation.id)));
  const projectIds = new Set(filteredProjects.map((project) => project.id));
  const keepConversation = (conversationId) => conversationIds.size === 0 || conversationIds.has(conversationId);
  return {
    ...state,
    projects: filteredProjects,
    conversationDrafts: Object.fromEntries(
      Object.entries(state.conversationDrafts ?? {}).filter(([conversationId]) => keepConversation(conversationId))
    ),
    conversationExplanations: Object.fromEntries(
      Object.entries(state.conversationExplanations ?? {}).filter(([conversationId]) => keepConversation(conversationId))
    ),
    inlineConversations: Array.isArray(state.inlineConversations)
      ? state.inlineConversations.filter(
          (item) =>
            (!options.projectId || item.projectId === options.projectId) &&
            (!options.conversationId || item.conversationId === options.conversationId)
        )
      : [],
    parsedReferences: Array.isArray(state.parsedReferences)
      ? state.parsedReferences.filter((document) => projectIds.size === 0 || projectIds.has(document.projectId) || filteredProjects.some((project) => project.documents?.includes(document.id)))
      : []
  };
};

const hasExplicitScope = (options) =>
  Boolean(options.all || options.since || options.until || options.conversationId || options.projectId || options.message);

const getLatestConversationScope = (state, logs) => {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const metadata = logs[index]?.metadata ?? {};
    if (
      typeof metadata.conversationId === "string" &&
      metadata.conversationId.trim() &&
      !metadata.conversationId.startsWith("inline-")
    ) {
      return {
        conversationId: metadata.conversationId,
        projectId: typeof metadata.projectId === "string" ? metadata.projectId : ""
      };
    }
  }
  const projects = Array.isArray(state.projects) ? state.projects : [];
  for (let projectIndex = projects.length - 1; projectIndex >= 0; projectIndex -= 1) {
    const project = projects[projectIndex];
    const conversations = Array.isArray(project.conversations) ? project.conversations : [];
    if (conversations.length > 0) {
      return {
        conversationId: conversations[conversations.length - 1].id,
        projectId: project.id
      };
    }
  }
  return { conversationId: "", projectId: "" };
};

const applyDefaultLatestConversationScope = (options, state, logs) => {
  if (hasExplicitScope(options)) {
    return options;
  }
  const latest = getLatestConversationScope(state, logs);
  return {
    ...options,
    conversationId: latest.conversationId,
    projectId: latest.projectId,
    defaultedToLatestConversation: Boolean(latest.conversationId)
  };
};

const loadState = async (options) => {
  if (options.state) {
    return normalizeState(await readJsonFile(options.state));
  }
  const scanned = await scanLevelDbState(options.userData).catch(() => ({}));
  return normalizeState(scanned);
};

const truncate = (value, max = 2400) => {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}\n\n...[truncated ${text.length - max} chars]` : text;
};

const code = (value) => String(value ?? "").replace(/`/g, "\\`");

const safeFilePart = (value) =>
  String(value ?? "asset")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset";

const writeDataUrlAsset = async (dataUrl, outPath, baseName) => {
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mime = match[1];
  const ext = mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "bin";
  const assetsDir = `${outPath.replace(/\.md$/i, "")}-assets`;
  await fs.mkdir(assetsDir, { recursive: true });
  const filePath = path.join(assetsDir, `${safeFilePart(baseName)}.${ext}`);
  await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
  return path.relative(path.dirname(outPath), filePath).replaceAll(path.sep, "/");
};

const renderMetadata = (metadata, maxChars) => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }
  return `\n\n\`\`\`json\n${truncate(JSON.stringify(metadata, null, 2), maxChars)}\n\`\`\``;
};

const renderLogEntry = (entry, options) => {
  const metadata = entry.metadata ?? {};
  if (metadata.answer || metadata.rawText || metadata.rawTitle) {
    const body = metadata.answer ?? metadata.rawText ?? metadata.rawTitle;
    return `### ${entry.timestamp || "No timestamp"} · ${entry.scope}/${entry.message}\n\n${truncate(body, options.maxLogChars)}\n`;
  }
  return `### ${entry.timestamp || "No timestamp"} · ${entry.scope}/${entry.message}\n\n- level: \`${entry.level ?? "info"}\`${renderMetadata(metadata, options.maxLogChars)}\n`;
};

const groupLogs = (logs) => {
  const groups = new Map();
  logs.forEach((entry) => {
    const metadata = entry.metadata ?? {};
    const key = metadata.conversationId || metadata.projectId || metadata.conversationTitle || "global";
    const items = groups.get(key) ?? [];
    items.push(entry);
    groups.set(key, items);
  });
  return groups;
};

const renderReferences = async (documents, options) => {
  if (!Array.isArray(documents) || documents.length === 0) {
    return "No parsed references found.\n";
  }
  const sections = [];
  for (const document of documents) {
    sections.push(`## ${document.title ?? document.id}\n\n- id: \`${code(document.id)}\`\n- kind: \`${code(document.kind)}\`\n- status: \`${code(document.status)}\`\n- pages: \`${code(document.pageCount ?? document.pages?.length ?? 0)}\`\n`);
    const images = Array.isArray(document.images) ? document.images : [];
    if (images.length > 0) {
      sections.push(`### Images\n`);
      for (const image of images) {
        const label = `${image.id ?? "image"} · ${image.alt ?? ""}`.trim();
        if (options.extractImages && image.dataUrl) {
          const assetPath = await writeDataUrlAsset(image.dataUrl, options.out, image.id ?? label);
          sections.push(assetPath ? `![${label}](${assetPath})\n\n` : `- \`${code(image.id)}\` ${image.alt ?? ""}\n`);
        } else {
          sections.push(`- \`${code(image.id)}\` page ${image.pageNumber ?? "?"}: ${image.alt ?? ""}${image.dataUrl ? ` · dataUrl: \`${truncate(image.dataUrl, options.maxImageDataChars)}\`` : ""}\n`);
        }
      }
    }
    if (Array.isArray(document.pages) && document.pages.length > 0) {
      sections.push(`### Parsed Pages\n`);
      document.pages.forEach((page) => {
        sections.push(`#### Page ${page.pageNumber}\n\n- quality: \`${code(page.textQuality)}\`\n- needsImage: \`${Boolean(page.needsImage)}\`\n\n${truncate(page.text, options.maxPageChars)}\n`);
      });
    }
  }
  return sections.join("\n");
};

const renderProjects = (state) => {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  if (projects.length === 0) {
    return "No persisted projects found.\n";
  }
  return projects
    .map((project) => {
      const conversations = Array.isArray(project.conversations) ? project.conversations : [];
      const docs = Array.isArray(project.documents) ? project.documents : [];
      const lines = [`## ${project.title ?? project.id}`, "", `- id: \`${code(project.id)}\``, `- references: ${docs.map((id) => `\`${code(id)}\``).join(", ") || "none"}`, ""];
      conversations.forEach((conversation) => {
        const draft = state.conversationDrafts?.[conversation.id];
        lines.push(`### ${conversation.title ?? conversation.id}`);
        lines.push(`- id: \`${code(conversation.id)}\``);
        lines.push(`- status: \`${code(conversation.status)}\``);
        lines.push(`- referenceState: \`${code(conversation.referenceState)}\``);
        if (draft?.prompt) {
          lines.push(`\n#### Prompt\n\n${truncate(draft.prompt, 4000)}`);
        }
        if (draft?.answerMarkdown) {
          lines.push(`\n#### Answer Markdown\n\n${truncate(draft.answerMarkdown, 12000)}`);
        }
        const explanations = state.conversationExplanations?.[conversation.id] ?? [];
        if (Array.isArray(explanations) && explanations.length > 0) {
          lines.push(`\n#### Explanations\n`);
          explanations.forEach((item) => lines.push(`- **${item.term}** (${item.source ?? "no source"}): ${truncate(item.body, 1200)}`));
        }
      });
      return lines.join("\n");
    })
    .join("\n\n");
};

const renderInlineConversations = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return "No saved inline conversations found.\n";
  }
  return items
    .map((item) => {
      const messages = Array.isArray(item.messages) ? item.messages : [];
      return [
        `## ${item.title ?? item.anchor ?? item.id}`,
        "",
        `- id: \`${code(item.id)}\``,
        `- projectId: \`${code(item.projectId)}\``,
        `- conversationId: \`${code(item.conversationId)}\``,
        `- position: ${item.positionLabel ?? item.anchor ?? ""}`,
        "",
        ...messages.map((message, index) => `### ${index + 1}. ${message.role}\n\n${truncate(message.content, 6000)}`)
      ].join("\n");
    })
    .join("\n\n");
};

const buildReport = async (state, logs, options) => {
  const groupedLogs = groupLogs(logs);
  const lines = [
    "# MindLinker Interaction Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `User data: \`${code(options.userData)}\``,
    `Scope: ${options.all ? "all" : options.defaultedToLatestConversation ? "latest conversation" : "custom filters"}`,
    options.projectId ? `Project id: \`${code(options.projectId)}\`` : "",
    options.conversationId ? `Conversation id: \`${code(options.conversationId)}\`` : "",
    "",
    "## Summary",
    "",
    `- Projects: ${Array.isArray(state.projects) ? state.projects.length : 0}`,
    `- Conversation drafts: ${Object.keys(state.conversationDrafts ?? {}).length}`,
    `- Parsed references: ${Array.isArray(state.parsedReferences) ? state.parsedReferences.length : 0}`,
    `- Inline conversations: ${Array.isArray(state.inlineConversations) ? state.inlineConversations.length : 0}`,
    `- Runtime log entries: ${logs.length}`,
    "",
    "# Projects And Conversations",
    "",
    renderProjects(state),
    "",
    "# Saved Inline Questions",
    "",
    renderInlineConversations(state.inlineConversations),
    "",
    "# Parsed References",
    "",
    await renderReferences(state.parsedReferences, options),
    "",
    "# Runtime Logs",
    ""
  ];

  if (logs.length === 0) {
    lines.push("No runtime logs found.");
  } else {
    for (const [key, entries] of groupedLogs.entries()) {
      lines.push(`## ${key}`);
      entries.forEach((entry) => lines.push(renderLogEntry(entry, options)));
    }
  }
  return lines.join("\n");
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const loadedState = await loadState(options);
  const logs = [
    ...(Array.isArray(loadedState.runtimeLogs) ? loadedState.runtimeLogs : []),
    ...(await readRuntimeLogs(options))
  ];
  const scopedOptions = applyDefaultLatestConversationScope(options, loadedState, logs);
  const state = filterState(loadedState, scopedOptions);
  const seen = new Set();
  const uniqueLogs = filterLogs(logs, scopedOptions).filter((entry) => {
    const key = `${entry.timestamp}|${entry.scope}|${entry.message}|${JSON.stringify(entry.metadata ?? {})}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const report = await buildReport(state, uniqueLogs, scopedOptions);
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, report, "utf8");
  console.log(`Wrote ${options.out}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
