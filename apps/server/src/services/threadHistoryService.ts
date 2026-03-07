import fs from "node:fs/promises";
import { createReadStream, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const MAX_LINE_CHARS = 512_000;
const SESSIONS_SCAN_MAX_DEPTH = 4;
const ARCHIVED_SCAN_MAX_DEPTH = 1;
const sessionFileCache = new Map<string, string>();

type ThreadHistoryEntry = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "contextCompaction";
  item: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return value === null || value === undefined ? "" : String(value);
}

function asTextScalar(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asString(entry).trim())
      .filter(Boolean);
  }
  const single = asString(value).trim();
  return single ? [single] : [];
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

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function stringifyOutput(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractSessionIdFromOutput(outputText: string): string | null {
  const match = outputText.match(/\bsession(?:\s+id|_id)?\s*[:=]?\s*(\d+)\b/i);
  return match?.[1] ?? null;
}

function extractMessageText(content: unknown): string {
  return extractStructuredText(content);
}

function extractStructuredTextSegments(value: unknown): string[] {
  const scalar = asTextScalar(value);
  if (scalar) {
    return [scalar];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractStructuredTextSegments(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const directFields = [record.text, record.value]
    .flatMap((entry) => extractStructuredTextSegments(entry))
    .filter((entry) => entry.trim().length > 0);
  if (directFields.length > 0) {
    return directFields;
  }

  const nestedFields = [
    record.content,
    record.contentItems,
    record.content_items,
    record.summary,
    record.parts,
    record.items,
    record.message,
  ];
  for (const field of nestedFields) {
    const extracted = extractStructuredTextSegments(field).filter(
      (entry) => entry.trim().length > 0,
    );
    if (extracted.length > 0) {
      return extracted;
    }
  }

  return [];
}

function extractStructuredText(value: unknown, separator = "\n\n"): string {
  return extractStructuredTextSegments(value)
    .filter((entry) => entry.trim().length > 0)
    .join(separator);
}

function normalizeUserContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }

  const normalized: Array<Record<string, unknown> | null> = content
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const type = asString(record.type).trim().toLowerCase();
      if (type === "text" || type === "input_text" || type === "inputtext") {
        const text = asString(record.text ?? record.value ?? "").trim();
        return text ? { type: "text", text } : null;
      }
      if (type === "image" || type === "input_image" || type === "inputimage") {
        const url = asString(record.url ?? record.value ?? "").trim();
        const imagePath = asString(record.path ?? "").trim();
        if (url) {
          return { type: "image", url };
        }
        if (imagePath) {
          return { type: "localImage", path: imagePath };
        }
      }
      return null;
    });

  return normalized.filter(
    (entry): entry is Record<string, unknown> => entry !== null,
  );
}

function createDynamicToolItem(
  id: string,
  name: string,
  argumentsValue: unknown,
): Record<string, unknown> {
  return {
    type: "dynamicToolCall",
    id,
    tool: name,
    arguments: argumentsValue,
    status: "in_progress",
    contentItems: [],
  };
}

function createCommandExecutionItem(
  id: string,
  action: Record<string, unknown> | null,
): Record<string, unknown> {
  const commandTokens = asStringList(action?.command ?? action?.cmd ?? "");
  return {
    type: "commandExecution",
    id,
    command: commandTokens.length > 0 ? commandTokens : asString(action?.command ?? ""),
    cwd: asString(
      action?.working_directory ??
        action?.workingDirectory ??
        action?.cwd ??
        action?.workdir ??
        "",
    ).trim(),
    status: "in_progress",
    aggregatedOutput: "",
  };
}

function createWebSearchItem(
  id: string,
  action: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    type: "web_search_call",
    id,
    action: action ?? {},
    status: "in_progress",
  };
}

function createMcpToolCallItem(
  id: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "mcpToolCall",
    id,
    server: asString(payload.server ?? "").trim(),
    tool: asString(payload.tool ?? payload.name ?? "").trim(),
    arguments: payload.arguments ?? payload.input ?? null,
    status: "in_progress",
    result: "",
  };
}

function createToolItemFromPayload(
  payload: Record<string, unknown>,
  fallbackId: string,
): Record<string, unknown> | null {
  const payloadType = asString(payload.type).trim();
  const id =
    asString(payload.call_id ?? payload.callId ?? payload.id ?? "").trim() || fallbackId;
  if (!id) {
    return null;
  }

  if (payloadType === "function_call") {
    const name = asString(payload.name).trim();
    if (!name) {
      return null;
    }
    const rawArguments = payload.arguments;
    const parsedArguments =
      typeof rawArguments === "string" ? parseJsonString(rawArguments) : rawArguments;
    return createDynamicToolItem(id, name, parsedArguments);
  }

  if (payloadType === "custom_tool_call") {
    const name = asString(payload.name).trim();
    if (!name) {
      return null;
    }
    const rawInput = payload.input ?? payload.arguments;
    const parsedInput = typeof rawInput === "string" ? parseJsonString(rawInput) : rawInput;
    return createDynamicToolItem(id, name, parsedInput);
  }

  if (payloadType === "local_shell_call") {
    return createCommandExecutionItem(id, asRecord(payload.action));
  }

  if (payloadType === "web_search_call") {
    return createWebSearchItem(id, asRecord(payload.action));
  }

  if (payloadType === "mcp_tool_call") {
    return createMcpToolCallItem(id, payload);
  }

  return null;
}

function appendOutputText(item: Record<string, unknown>, outputText: string) {
  if (!outputText) {
    return;
  }
  const existing = asString(item.aggregatedOutput ?? item.result ?? "");
  const nextValue =
    existing && outputText
      ? `${existing}${existing.endsWith("\n") || outputText.startsWith("\n") ? "" : "\n"}${outputText}`
      : existing || outputText;

  if (item.type === "commandExecution") {
    item.aggregatedOutput = nextValue;
    return;
  }
  if (item.type === "mcpToolCall") {
    item.result = nextValue;
    return;
  }
  const contentItems = Array.isArray(item.contentItems)
    ? [...item.contentItems]
    : [];
  contentItems.push({ type: "outputText", text: outputText });
  item.contentItems = contentItems;
}

function applyToolOutput(
  item: Record<string, unknown> | null | undefined,
  output: unknown,
  execSessionItems?: Map<string, Record<string, unknown>>,
) {
  if (!item) {
    return;
  }
  const outputText = stringifyOutput(output);
  appendOutputText(item, outputText);
  item.status = "completed";
  if (execSessionItems && asString(item.tool ?? "").trim() === "exec_command") {
    const sessionId = extractSessionIdFromOutput(outputText);
    if (sessionId) {
      execSessionItems.set(sessionId, item);
    }
  }
}

function finalizeToolItem(item: Record<string, unknown>) {
  const status = asString(item.status).trim().toLowerCase();
  if (!status || status === "in_progress") {
    item.status = "completed";
  }
}

function getEntriesForTurn(
  entriesByTurn: Map<string, ThreadHistoryEntry[]>,
  turnId: string,
): ThreadHistoryEntry[] {
  const existing = entriesByTurn.get(turnId);
  if (existing) {
    return existing;
  }
  const created: ThreadHistoryEntry[] = [];
  entriesByTurn.set(turnId, created);
  return created;
}

async function resolveRolloutPath(
  thread: Record<string, unknown>,
  threadId: string,
): Promise<string | null> {
  const directPath = asString(
    thread.path ?? thread.rolloutPath ?? thread.rollout_path ?? "",
  ).trim();
  if (directPath) {
    return directPath;
  }
  return findThreadSessionFile(threadId);
}

async function parseRolloutEntries(
  filePath: string,
  workspacePath: string | null,
): Promise<Map<string, ThreadHistoryEntry[]> | null> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let workspaceMatched = true;
  let currentTurnId = "";
  let toolSequence = 0;
  const entriesByTurn = new Map<string, ThreadHistoryEntry[]>();
  const pendingTools = new Map<string, Record<string, unknown>>();
  const execSessionItems = new Map<string, Record<string, unknown>>();

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

      const entryType = asString(parsed.type).trim();
      if (entryType === "session_meta" || entryType === "turn_context") {
        const payload = asRecord(parsed.payload);
        const cwd = asString(payload?.cwd ?? "").trim();
        if (cwd && workspacePath) {
          workspaceMatched = pathMatchesWorkspace(cwd, workspacePath);
          if (!workspaceMatched) {
            break;
          }
        }
        if (entryType === "turn_context") {
          currentTurnId = asString(payload?.turn_id ?? payload?.turnId ?? "").trim();
        }
        continue;
      }

      if (!workspaceMatched || !currentTurnId) {
        continue;
      }

      if (entryType === "compacted") {
        getEntriesForTurn(entriesByTurn, currentTurnId).push({
          kind: "contextCompaction",
          item: { type: "contextCompaction" },
        });
        continue;
      }

      if (entryType !== "response_item") {
        continue;
      }

      const payload = asRecord(parsed.payload);
      if (!payload) {
        continue;
      }

      const payloadType = asString(payload.type).trim();
      if (payloadType === "message") {
        const role = asString(payload.role).trim();
        if (role === "user") {
          const content = normalizeUserContent(payload.content);
          if (content.length > 0) {
            getEntriesForTurn(entriesByTurn, currentTurnId).push({
              kind: "user",
              item: { type: "userMessage", content },
            });
          }
          continue;
        }
        if (role === "assistant") {
          const text = extractMessageText(payload.content).trim();
          if (text) {
            const item: Record<string, unknown> = {
              type: "agentMessage",
              text,
            };
            const phase = asString(payload.phase).trim();
            if (phase) {
              item.phase = phase;
            }
            getEntriesForTurn(entriesByTurn, currentTurnId).push({
              kind: "assistant",
              item,
            });
          }
        }
        continue;
      }

      if (payloadType === "reasoning") {
        const summary = extractStructuredText(payload.summary ?? "");
        const content = extractStructuredText(payload.content ?? "").trim();
        if (summary.length > 0 || content) {
          getEntriesForTurn(entriesByTurn, currentTurnId).push({
            kind: "reasoning",
            item: { type: "reasoning", summary, content },
          });
        }
        continue;
      }

      if (
        payloadType === "function_call_output" ||
        payloadType === "custom_tool_call_output" ||
        payloadType === "local_shell_call_output" ||
        payloadType === "web_search_call_output" ||
        payloadType === "mcp_tool_call_output"
      ) {
        const callId = asString(payload.call_id ?? payload.callId ?? payload.id ?? "").trim();
        if (callId) {
          applyToolOutput(
            pendingTools.get(callId),
            payload.output ?? payload.result ?? payload.error ?? "",
            execSessionItems,
          );
        }
        continue;
      }

      const toolName = asString(payload.name).trim();
      if (
        (payloadType === "function_call" || payloadType === "custom_tool_call") &&
        toolName === "write_stdin"
      ) {
        const rawArguments =
          payloadType === "custom_tool_call"
            ? payload.input ?? payload.arguments
            : payload.arguments;
        const parsedArguments =
          typeof rawArguments === "string" ? parseJsonString(rawArguments) : rawArguments;
        const argsRecord = asRecord(parsedArguments);
        const sessionId = asString(
          argsRecord?.session_id ?? argsRecord?.sessionId ?? "",
        ).trim();
        const sessionItem = sessionId ? execSessionItems.get(sessionId) ?? null : null;
        const callId = asString(payload.call_id ?? payload.callId ?? payload.id ?? "").trim();
        if (sessionItem) {
          const chars = asString(argsRecord?.chars ?? "").replace(/\r\n/g, "\n");
          if (chars) {
            const suffix = chars.endsWith("\n") ? "" : "\n";
            appendOutputText(sessionItem, `[stdin]\n${chars}${suffix}`);
          }
          if (callId) {
            pendingTools.set(callId, sessionItem);
          }
          continue;
        }
      }

      const toolItem = createToolItemFromPayload(payload, `tool-${currentTurnId}-${++toolSequence}`);
      if (!toolItem) {
        continue;
      }
      getEntriesForTurn(entriesByTurn, currentTurnId).push({
        kind: "tool",
        item: toolItem,
      });
      const toolId = asString(toolItem.id).trim();
      if (toolId) {
        pendingTools.set(toolId, toolItem);
      }
    }
  } finally {
    reader.close();
    stream.close();
  }

  if (!workspaceMatched) {
    return null;
  }

  for (const entries of entriesByTurn.values()) {
    entries.forEach((entry) => {
      if (entry.kind === "tool") {
        finalizeToolItem(entry.item);
      }
    });
  }

  return entriesByTurn;
}

function nextExistingId(
  queues: Record<string, string[]>,
  type: string,
  fallback: string,
): string {
  const queue = queues[type];
  if (queue && queue.length > 0) {
    return queue.shift() ?? fallback;
  }
  return fallback;
}

function rebuildTurnItems(
  turnId: string,
  existingTurn: Record<string, unknown>,
  entries: ThreadHistoryEntry[],
): Record<string, unknown>[] {
  const existingItems = Array.isArray(existingTurn.items)
    ? (existingTurn.items as Record<string, unknown>[])
    : [];
  const existingIdsByType: Record<string, string[]> = {
    userMessage: [],
    agentMessage: [],
    reasoning: [],
    contextCompaction: [],
  };

  existingItems.forEach((item) => {
    const itemRecord = asRecord(item);
    if (!itemRecord) {
      return;
    }
    const type = asString(itemRecord.type).trim();
    const id = asString(itemRecord.id).trim();
    if (!type || !id || !existingIdsByType[type]) {
      return;
    }
    existingIdsByType[type].push(id);
  });

  const userEntryIndexes = entries
    .map((entry, index) => (entry.kind === "user" ? index : -1))
    .filter((index) => index >= 0);
  const visibleUserCount = Math.max(
    1,
    Math.min(existingIdsByType.userMessage.length || 1, userEntryIndexes.length),
  );
  const keptUserIndexes = new Set(
    userEntryIndexes.slice(Math.max(0, userEntryIndexes.length - visibleUserCount)),
  );

  let sequence = 0;
  const userItems: Record<string, unknown>[] = [];
  const nonUserItems: Record<string, unknown>[] = [];

  entries.forEach((entry, index) => {
    if (entry.kind === "user" && !keptUserIndexes.has(index)) {
      return;
    }

    const item = { ...entry.item };
    const itemType = asString(item.type).trim();
    const fallbackId = `${turnId}:${itemType || "item"}:${++sequence}`;

    if (entry.kind === "tool") {
      item.id = asString(item.id).trim() || fallbackId;
      nonUserItems.push(item);
      return;
    }

    item.id = nextExistingId(existingIdsByType, itemType, fallbackId);
    if (entry.kind === "user") {
      userItems.push(item);
      return;
    }
    nonUserItems.push(item);
  });

  const items = [...userItems, ...nonUserItems];
  if (items.length === 0) {
    return existingItems;
  }
  return items;
}

function enrichThread(
  thread: Record<string, unknown>,
  entriesByTurn: Map<string, ThreadHistoryEntry[]>,
): Record<string, unknown> | null {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  if (turns.length === 0) {
    return null;
  }

  let didChange = false;
  const nextTurns = turns.map((turn) => {
    const turnRecord = asRecord(turn);
    if (!turnRecord) {
      return turn;
    }
    const turnId = asString(turnRecord.id).trim();
    if (!turnId) {
      return turn;
    }

    const entries = entriesByTurn.get(turnId);
    if (!entries || entries.length === 0) {
      return turn;
    }

    const reconstructedItems = rebuildTurnItems(turnId, turnRecord, entries);
    const existingItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    const shouldReplace =
      reconstructedItems.length > existingItems.length ||
      reconstructedItems.some((item) => {
        const type = asString(item.type).trim();
        return type !== "userMessage" && type !== "agentMessage";
      });
    if (!shouldReplace) {
      return turn;
    }

    didChange = true;
    return {
      ...turnRecord,
      items: reconstructedItems,
    };
  });

  if (!didChange) {
    return null;
  }

  return {
    ...thread,
    turns: nextTurns,
  };
}

export async function enrichThreadResumeResultFromRollout(
  result: unknown,
  workspacePath?: string | null,
): Promise<unknown> {
  const response = asRecord(result);
  if (!response) {
    return result;
  }

  const thread = asRecord(response.thread);
  if (!thread) {
    return result;
  }

  const threadId = asString(thread.id).trim();
  if (!threadId) {
    return result;
  }

  const rolloutPath = await resolveRolloutPath(thread, threadId);
  if (!rolloutPath) {
    return result;
  }

  const parsedEntries = await parseRolloutEntries(
    rolloutPath,
    normalizeWorkspacePath(workspacePath),
  );
  if (!parsedEntries || parsedEntries.size === 0) {
    return result;
  }

  const enrichedThread = enrichThread(thread, parsedEntries);
  if (!enrichedThread) {
    return result;
  }

  return {
    ...response,
    thread: enrichedThread,
  };
}
