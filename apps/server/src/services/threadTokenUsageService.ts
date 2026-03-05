import fs from "node:fs/promises";
import { createReadStream, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type ThreadTokenUsageSnapshot = {
  threadId: string;
  tokenUsage: ThreadTokenUsage | null;
  updatedAt: number | null;
};

const MAX_LINE_CHARS = 512_000;
const SESSIONS_SCAN_MAX_DEPTH = 4;
const ARCHIVED_SCAN_MAX_DEPTH = 1;
const sessionFileCache = new Map<string, string>();

type ParsedTokenUsage = {
  tokenUsage: ThreadTokenUsage;
  updatedAt: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readI64(map: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const raw = map[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(0, Math.trunc(raw));
    }
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.trunc(parsed));
      }
    }
  }
  return 0;
}

function readOptionalNumber(
  map: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const raw = map[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.trunc(raw);
    }
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
  }
  return null;
}

function readTimestampMs(value: Record<string, unknown>): number | null {
  const raw = value.timestamp;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const numeric = Math.trunc(raw);
    if (numeric > 0 && numeric < 1_000_000_000_000) {
      return numeric * 1000;
    }
    return numeric;
  }
  return null;
}

function findUsageMap(
  info: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!info) {
    return null;
  }
  for (const key of keys) {
    const candidate = asRecord(info[key]);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function normalizeWorkspacePath(workspacePath?: string | null): string | null {
  const raw = workspacePath?.trim();
  if (!raw) {
    return null;
  }
  return path.resolve(raw);
}

function pathMatchesWorkspace(cwd: string, workspacePath: string): boolean {
  const cwdPath = path.resolve(cwd);
  const workspace = path.resolve(workspacePath);
  if (cwdPath === workspace) {
    return true;
  }
  const relative = path.relative(workspace, cwdPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveDefaultCodexHome(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".codex");
}

function buildTokenBreakdown(usage: Record<string, unknown>): TokenUsageBreakdown {
  const inputTokens = readI64(usage, ["input_tokens", "inputTokens"]);
  const cachedInputTokens = readI64(usage, [
    "cached_input_tokens",
    "cache_read_input_tokens",
    "cachedInputTokens",
    "cacheReadInputTokens",
  ]);
  const outputTokens = readI64(usage, ["output_tokens", "outputTokens"]);
  const reasoningOutputTokens = readI64(usage, [
    "reasoning_output_tokens",
    "reasoningOutputTokens",
  ]);
  const totalTokensRaw = readI64(usage, ["total_tokens", "totalTokens"]);
  const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : inputTokens + outputTokens;
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: Math.min(cachedInputTokens, inputTokens),
    outputTokens,
    reasoningOutputTokens,
  };
}

async function findSessionFileInRoot(
  root: string,
  fileSuffix: string,
  maxDepth: number,
): Promise<string | null> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let newestPath: string | null = null;
  let newestMtime = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      if (!entry.name.endsWith(fileSuffix)) {
        continue;
      }

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.mtimeMs >= newestMtime) {
        newestMtime = stat.mtimeMs;
        newestPath = fullPath;
      }
    }
  }

  return newestPath;
}

async function findThreadSessionFile(threadId: string): Promise<string | null> {
  const cachedPath = sessionFileCache.get(threadId);
  if (cachedPath) {
    try {
      await fs.access(cachedPath);
      return cachedPath;
    } catch {
      sessionFileCache.delete(threadId);
    }
  }

  const codexHome = resolveDefaultCodexHome();
  const fileSuffix = `${threadId}.jsonl`;
  const roots: Array<{ root: string; maxDepth: number }> = [
    { root: path.join(codexHome, "sessions"), maxDepth: SESSIONS_SCAN_MAX_DEPTH },
    { root: path.join(codexHome, "archived_sessions"), maxDepth: ARCHIVED_SCAN_MAX_DEPTH },
  ];

  let newestPath: string | null = null;
  let newestMtime = 0;

  for (const candidate of roots) {
    const match = await findSessionFileInRoot(
      candidate.root,
      fileSuffix,
      candidate.maxDepth,
    );
    if (!match) {
      continue;
    }
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(match);
    } catch {
      continue;
    }
    if (stat.mtimeMs >= newestMtime) {
      newestMtime = stat.mtimeMs;
      newestPath = match;
    }
  }

  if (newestPath) {
    sessionFileCache.set(threadId, newestPath);
  }
  return newestPath;
}

async function parseThreadTokenUsageFromFile(
  filePath: string,
  workspacePath: string | null,
): Promise<ParsedTokenUsage | null> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let workspaceMatched = true;
  let latestTotal: TokenUsageBreakdown | null = null;
  let latestLast: TokenUsageBreakdown | null = null;
  let latestModelContextWindow: number | null = null;
  let latestTimestampMs: number | null = null;

  try {
    for await (const line of reader) {
      if (line.length > MAX_LINE_CHARS) {
        continue;
      }

      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(line) as unknown;
      } catch {
        continue;
      }

      const parsed = asRecord(parsedRaw);
      if (!parsed) {
        continue;
      }

      const entryType = typeof parsed.type === "string" ? parsed.type : "";
      if (entryType === "session_meta" || entryType === "turn_context") {
        const payload = asRecord(parsed.payload);
        const cwd = typeof payload?.cwd === "string" ? payload.cwd : null;
        if (cwd && workspacePath) {
          workspaceMatched = pathMatchesWorkspace(cwd, workspacePath);
          if (!workspaceMatched) {
            break;
          }
        }
      }

      if (!workspaceMatched) {
        continue;
      }

      if (entryType !== "event_msg" && entryType !== "") {
        continue;
      }

      const payload = asRecord(parsed.payload);
      if (!payload || payload.type !== "token_count") {
        continue;
      }

      const info = asRecord(payload.info);
      const totalUsage = findUsageMap(info, ["total_token_usage", "totalTokenUsage"]);
      const lastUsage = findUsageMap(info, ["last_token_usage", "lastTokenUsage"]);
      if (!totalUsage && !lastUsage) {
        continue;
      }

      if (totalUsage) {
        latestTotal = buildTokenBreakdown(totalUsage);
      }
      if (lastUsage) {
        latestLast = buildTokenBreakdown(lastUsage);
      }

      const modelContextWindow = info
        ? readOptionalNumber(info, ["model_context_window", "modelContextWindow"])
        : null;
      if (modelContextWindow !== null) {
        latestModelContextWindow = modelContextWindow;
      }

      const timestampMs = readTimestampMs(parsed);
      if (timestampMs !== null) {
        latestTimestampMs = timestampMs;
      }
    }
  } finally {
    reader.close();
    stream.close();
  }

  if (!workspaceMatched) {
    return null;
  }
  if (!latestTotal && !latestLast) {
    return null;
  }

  const fallback = latestTotal ?? latestLast;
  if (!fallback) {
    return null;
  }

  return {
    tokenUsage: {
      total: latestTotal ?? fallback,
      last: latestLast ?? fallback,
      modelContextWindow: latestModelContextWindow,
    },
    updatedAt: latestTimestampMs,
  };
}

export async function threadTokenUsageSnapshot(
  threadId: string,
  workspacePath?: string | null,
): Promise<ThreadTokenUsageSnapshot> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new Error("threadId is required");
  }

  const sessionFile = await findThreadSessionFile(normalizedThreadId);
  if (!sessionFile) {
    return {
      threadId: normalizedThreadId,
      tokenUsage: null,
      updatedAt: null,
    };
  }

  const parsed = await parseThreadTokenUsageFromFile(
    sessionFile,
    normalizeWorkspacePath(workspacePath),
  );
  if (!parsed) {
    return {
      threadId: normalizedThreadId,
      tokenUsage: null,
      updatedAt: null,
    };
  }

  return {
    threadId: normalizedThreadId,
    tokenUsage: parsed.tokenUsage,
    updatedAt: parsed.updatedAt,
  };
}
