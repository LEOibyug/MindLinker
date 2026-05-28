export type RuntimeLogLevel = "info" | "warn" | "error";

export type RuntimeLogEntry = {
  timestamp: string;
  level: RuntimeLogLevel;
  scope: string;
  message: string;
  metadata?: Record<string, unknown>;
};

declare global {
  interface Window {
    mindlinkerRuntimeLog?: {
      append: (entry: RuntimeLogEntry) => Promise<{ ok: boolean; path?: string; error?: string }>;
      read: () => Promise<{ ok: boolean; path?: string; entries?: RuntimeLogEntry[]; error?: string }>;
      clear: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

const runtimeLogKey = "mindlinker.runtimeLogs";
const maxStoredEntries = 600;
const maxEntryAgeMs = 7 * 24 * 60 * 60 * 1000;

const sanitizeMetadata = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.length > 24_000 ? `${value.slice(0, 24_000)}\n...[truncated ${value.length - 24_000} chars]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 80).map(sanitizeMetadata);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !/api[-_ ]?key|authorization|token|secret/i.test(key))
        .map(([key, item]) => [key, sanitizeMetadata(item)])
    );
  }
  return String(value);
};

const pruneEntries = (entries: RuntimeLogEntry[]) => {
  const cutoff = Date.now() - maxEntryAgeMs;
  return entries
    .filter((entry) => {
      const time = Date.parse(entry.timestamp);
      return Number.isNaN(time) || time >= cutoff;
    })
    .slice(-maxStoredEntries);
};

export const readRuntimeLogEntries = (): RuntimeLogEntry[] => {
  try {
    return JSON.parse(window.localStorage.getItem(runtimeLogKey) ?? "[]") as RuntimeLogEntry[];
  } catch {
    return [];
  }
};

const appendLocalRuntimeLog = (entry: RuntimeLogEntry) => {
  const entries = pruneEntries([...readRuntimeLogEntries(), entry]);
  window.localStorage.setItem(runtimeLogKey, JSON.stringify(entries));
};

export const appendRuntimeLog = (
  scope: string,
  message: string,
  metadata: Record<string, unknown> = {},
  level: RuntimeLogLevel = "info"
) => {
  const entry: RuntimeLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    metadata: sanitizeMetadata(metadata) as Record<string, unknown>
  };
  appendLocalRuntimeLog(entry);
  void window.mindlinkerRuntimeLog?.append(entry).catch(() => undefined);
  return entry;
};

