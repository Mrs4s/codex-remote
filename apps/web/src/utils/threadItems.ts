import type {
  CollabAgentRef,
  CollabAgentStatus,
  ConversationCommandAction,
  ConversationItem,
} from "../types";
import { CHAT_SCROLLBACK_DEFAULT } from "./chatScrollback";

export type PrepareThreadItemsOptions = {
  maxItemsPerThread?: number | null;
};

const DEFAULT_MAX_ITEMS_PER_THREAD = CHAT_SCROLLBACK_DEFAULT;
const MAX_ITEM_TEXT = 20000;
const MAX_LARGE_TOOL_TEXT = 200000;
const TOOL_OUTPUT_RECENT_ITEMS = 40;
// Keep this prefix CSS-selector-friendly (avoid ":"), since item ids are reused
// inside DOM ids (e.g. aria-controls targets).
const EXPLORE_ITEM_ID_PREFIX = "explore__";
const LARGE_TOOL_TYPES = new Set(["fileChange", "commandExecution"]);
const READ_COMMANDS = new Set(["cat", "sed", "head", "tail", "less", "more", "nl"]);
const LIST_COMMANDS = new Set(["ls", "tree", "find", "fd"]);
const SEARCH_COMMANDS = new Set(["rg", "grep", "ripgrep", "findstr"]);
const PATH_HINT_REGEX = /[\\/]/;
const PATHLIKE_REGEX = /(\.[a-z0-9]+$)|(^\.{1,2}$)/i;
const GLOB_HINT_REGEX = /[*?[\]{}]/;
const RG_FLAGS_WITH_VALUES = new Set([
  "-g",
  "--glob",
  "--iglob",
  "-t",
  "--type",
  "--type-add",
  "--type-not",
  "-m",
  "--max-count",
  "-A",
  "-B",
  "-C",
  "--context",
  "--max-depth",
]);

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asTextScalar(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
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

export function extractStructuredText(value: unknown, separator = "\n\n") {
  return extractStructuredTextSegments(value)
    .filter((entry) => entry.trim().length > 0)
    .join(separator);
}

function stringifyJsonValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return asString(value);
  }
}

function parseJsonStringValue(value: string): unknown {
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

function normalizeToolStatus(value: unknown, successValue?: unknown) {
  const status = asString(value).trim();
  if (status) {
    return status;
  }
  if (successValue === false) {
    return "failed";
  }
  if (successValue === true) {
    return "completed";
  }
  return "";
}

function normalizeCommandActions(value: unknown): ConversationCommandAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const type = asString(record.type).trim();
      const command = asString(record.command ?? "").trim();
      if (type === "read") {
        const path = asString(record.path ?? "").trim();
        const name = asString(record.name ?? "").trim();
        if (!command && !path && !name) {
          return null;
        }
        return {
          type: "read",
          command,
          name: name || path.split(/[\\/]/g).filter(Boolean).pop() || path,
          path,
        } satisfies ConversationCommandAction;
      }
      if (type === "listFiles") {
        return {
          type: "listFiles",
          command,
          path: asString(record.path ?? "").trim() || null,
        } satisfies ConversationCommandAction;
      }
      if (type === "search") {
        return {
          type: "search",
          command,
          query: asString(record.query ?? "").trim() || null,
          path: asString(record.path ?? "").trim() || null,
        } satisfies ConversationCommandAction;
      }
      if (!type || type === "unknown") {
        if (!command) {
          return null;
        }
        return {
          type: "unknown",
          command,
        } satisfies ConversationCommandAction;
      }
      if (!command) {
        return null;
      }
      return {
        type: "unknown",
        command,
      } satisfies ConversationCommandAction;
    })
    .filter((entry): entry is ConversationCommandAction => Boolean(entry));
  return normalized.length > 0 ? normalized : undefined;
}

function commandTextFromValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean).join(" ").trim();
  }
  return asString(value).trim();
}

function extractTextContentItems(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .flatMap((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return [];
      }
      const type = asString(record.type ?? "").trim();
      if (type === "inputText" || type === "text" || type === "outputText") {
        return extractStructuredTextSegments(record.text ?? record.value ?? "");
      }
      return [];
    })
    .filter((entry) => entry.trim().length > 0)
    .join("\n\n");
}

function normalizeFileChanges(
  value: unknown,
): NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: Array<
    NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>[number] | null
  > = value
    .map((change) => {
      const record = asRecord(change);
      if (!record) {
        return null;
      }
      const path = asString(record.path ?? "").trim();
      const kind = record.kind;
      const kindType =
        typeof kind === "string"
          ? kind
          : typeof kind === "object" && kind
            ? asString((kind as Record<string, unknown>).type ?? "")
            : "";
      const normalizedKind = kindType ? kindType.toLowerCase() : "";
      const diff = asString(record.diff ?? "");
      if (!path) {
        return null;
      }
      return {
        path,
        kind: normalizedKind || undefined,
        diff: diff || undefined,
      };
    });
  return normalized
    .filter(
      (
        change,
      ): change is NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>[number] =>
        Boolean(change),
    );
}

function formatFileChangeDetail(
  changes: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>,
) {
  return changes
    .map((change) => {
      const prefix =
        change.kind === "add"
          ? "A"
          : change.kind === "delete"
            ? "D"
            : change.kind
              ? "M"
              : "";
      return [prefix, change.path].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

function buildFileChangeToolItem(
  id: string,
  params: {
    title?: string;
    status?: string;
    changes?: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>;
    output?: string;
  },
): Extract<ConversationItem, { kind: "tool" }> {
  const changes = params.changes ?? [];
  const diffOutput = changes
    .map((change) => change.diff ?? "")
    .filter(Boolean)
    .join("\n\n");
  const extraOutput = asString(params.output ?? "").trim();
  return {
    id,
    kind: "tool",
    toolType: "fileChange",
    title: params.title ?? "File changes",
    detail: formatFileChangeDetail(changes) || "Pending changes",
    status: params.status ?? "",
    output: [diffOutput, extraOutput].filter(Boolean).join("\n\n"),
    changes,
  };
}

function parseApplyPatchChanges(
  patchText: string,
): NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]> {
  const trimmed = patchText.trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split(/\r?\n/g);
  const changes: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]> = [];
  let current:
    | {
        path: string;
        kind?: string;
        diffLines: string[];
      }
    | null = null;

  const flush = () => {
    if (!current?.path) {
      current = null;
      return;
    }
    changes.push({
      path: current.path,
      kind: current.kind,
      diff: current.diffLines.length > 0 ? current.diffLines.join("\n").trim() : undefined,
    });
    current = null;
  };

  lines.forEach((line) => {
    if (line.startsWith("*** Add File: ")) {
      flush();
      current = {
        path: line.slice("*** Add File: ".length).trim(),
        kind: "add",
        diffLines: [line],
      };
      return;
    }
    if (line.startsWith("*** Delete File: ")) {
      flush();
      current = {
        path: line.slice("*** Delete File: ".length).trim(),
        kind: "delete",
        diffLines: [line],
      };
      return;
    }
    if (line.startsWith("*** Update File: ")) {
      flush();
      current = {
        path: line.slice("*** Update File: ".length).trim(),
        kind: "update",
        diffLines: [line],
      };
      return;
    }
    if (line.startsWith("*** Move to: ")) {
      if (current) {
        current.path = line.slice("*** Move to: ".length).trim() || current.path;
        current.kind = current.kind === "add" ? "add" : "move";
        current.diffLines.push(line);
      }
      return;
    }
    if (line.startsWith("*** End Patch")) {
      flush();
      return;
    }
    if (line.startsWith("*** Begin Patch")) {
      return;
    }
    if (current) {
      current.diffLines.push(line);
    }
  });

  flush();
  return changes;
}

function buildCommandExecutionToolItem(
  id: string,
  params: {
    command: string;
    cwd?: string;
    status?: string;
    output?: string;
    durationMs?: number | null;
    commandActions?: ConversationCommandAction[];
  },
): Extract<ConversationItem, { kind: "tool" }> {
  const tool: Extract<ConversationItem, { kind: "tool" }> = {
    id,
    kind: "tool",
    toolType: "commandExecution",
    title: params.command ? `Command: ${params.command}` : "Command",
    detail: params.cwd ?? "",
    status: params.status ?? "",
    output: params.output ?? "",
    durationMs: params.durationMs ?? null,
  };
  if (params.commandActions && params.commandActions.length > 0) {
    tool.commandActions = params.commandActions;
  }
  return tool;
}

function resolveConversationItemId(type: string, item: Record<string, unknown>) {
  const explicitId = asString(item.id ?? "").trim();
  if (explicitId) {
    return explicitId;
  }
  const callId = asString(item.call_id ?? item.callId ?? "").trim();
  if (callId) {
    return callId;
  }
  if (type === "local_shell_call") {
    const action = asRecord(item.action);
    const command = commandTextFromValue(action?.command ?? "");
    return command ? `raw-local-shell:${Date.now()}:${command}` : "";
  }
  if (type === "web_search_call") {
    const action = asRecord(item.action);
    const query =
      normalizeStringList(action?.queries ?? action?.query)[0] ||
      asString(action?.pattern ?? action?.url ?? "").trim();
    return query ? `raw-web-search:${Date.now()}:${query}` : "";
  }
  if (type === "custom_tool_call" || type === "function_call") {
    const toolName = asString(item.name ?? "").trim();
    return toolName ? `raw-tool:${Date.now()}:${toolName}` : "";
  }
  return "";
}

function buildDynamicToolCallConversationItem(
  id: string,
  item: Record<string, unknown>,
): ConversationItem | null {
  const tool = asString(item.tool ?? item.name ?? "").trim();
  if (!tool) {
    return null;
  }

  const argumentsValue = item.arguments ?? item.input ?? null;
  const argsRecord = asRecord(argumentsValue);
  const status = normalizeToolStatus(item.status, item.success);
  const durationMs = asNumber(item.durationMs ?? item.duration_ms);
  const output = extractTextContentItems(item.contentItems ?? item.content_items);

  if (tool === "exec_command") {
    const command =
      commandTextFromValue(argsRecord?.cmd ?? argsRecord?.command ?? argsRecord?.commandLine) ||
      stringifyJsonValue(argumentsValue);
    const cwd = asString(
      argsRecord?.workdir ??
        argsRecord?.cwd ??
        argsRecord?.working_directory ??
        argsRecord?.workingDirectory ??
        "",
    ).trim();
    return buildCommandExecutionToolItem(id, {
      command,
      cwd,
      status,
      output,
      durationMs,
    });
  }

  if (tool === "view_image") {
    return {
      id,
      kind: "tool",
      toolType: "imageView",
      title: "Image view",
      detail: asString(argsRecord?.path ?? "").trim(),
      status,
      output: output || "",
      durationMs,
    };
  }

  if (tool === "apply_patch") {
    const patchText = typeof argumentsValue === "string" ? argumentsValue : stringifyJsonValue(argumentsValue);
    const changes = parseApplyPatchChanges(patchText);
    if (changes.length > 0) {
      return buildFileChangeToolItem(id, {
        title: "Apply patch",
        status,
        changes,
        output,
      });
    }
  }

  if (tool === "write_stdin") {
    const sessionId = asString(argsRecord?.session_id ?? argsRecord?.sessionId ?? "").trim();
    const chars = asString(argsRecord?.chars ?? "").replace(/\r\n/g, "\n");
    const stdinOutput = chars
      ? `[stdin]\n${chars}${chars.endsWith("\n") ? "" : "\n"}`
      : "";
    return {
      id,
      kind: "tool",
      toolType: "dynamicToolCall",
      title: chars ? "Terminal input" : "Terminal session output",
      detail: sessionId ? `Session ${sessionId}` : "Terminal session",
      status,
      output: [stdinOutput, output].filter(Boolean).join("\n"),
      durationMs,
    };
  }

  return {
    id,
    kind: "tool",
    toolType: "dynamicToolCall",
    title: `Tool: ${tool}`,
    detail: stringifyJsonValue(argumentsValue),
    status,
    output,
    durationMs,
  };
}

function exploreItemIdForToolId(toolId: string) {
  if (!toolId) {
    return `${EXPLORE_ITEM_ID_PREFIX}${Date.now()}`;
  }
  return toolId.startsWith(EXPLORE_ITEM_ID_PREFIX)
    ? toolId
    : `${EXPLORE_ITEM_ID_PREFIX}${toolId}`;
}

function truncateText(text: string, maxLength = MAX_ITEM_TEXT) {
  if (text.length <= maxLength) {
    return text;
  }
  const sliceLength = Math.max(0, maxLength - 3);
  return `${text.slice(0, sliceLength)}...`;
}

function truncateToolText(toolType: string, text: string) {
  const maxLength = LARGE_TOOL_TYPES.has(toolType)
    ? MAX_LARGE_TOOL_TEXT
    : MAX_ITEM_TEXT;
  return truncateText(text, maxLength);
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function buildCollabAgentRef(
  threadIdValue: unknown,
  nicknameValue?: unknown,
  roleValue?: unknown,
): CollabAgentRef | null {
  const threadId = asString(threadIdValue).trim();
  if (!threadId) {
    return null;
  }
  const nickname = asString(nicknameValue ?? "").trim() || undefined;
  const role = asString(roleValue ?? "").trim() || undefined;
  return { threadId, nickname, role };
}

function parseCollabAgentRef(value: unknown): CollabAgentRef | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return buildCollabAgentRef(
    record.threadId ?? record.thread_id ?? record.id,
    record.agentNickname ?? record.agent_nickname ?? record.nickname,
    record.agentRole ??
      record.agent_role ??
      record.agentType ??
      record.agent_type ??
      record.role,
  );
}

function parseCollabAgentRefs(value: unknown) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => parseCollabAgentRef(entry))
      .filter((entry): entry is CollabAgentRef => Boolean(entry));
  }
  const single = parseCollabAgentRef(value);
  return single ? [single] : [];
}

function mergeCollabAgentRefs(...lists: CollabAgentRef[][]) {
  const byThreadId = new Map<string, CollabAgentRef>();
  lists.forEach((list) => {
    list.forEach((entry) => {
      const existing = byThreadId.get(entry.threadId);
      if (!existing) {
        byThreadId.set(entry.threadId, { ...entry });
        return;
      }
      byThreadId.set(entry.threadId, {
        threadId: existing.threadId,
        nickname: existing.nickname ?? entry.nickname,
        role: existing.role ?? entry.role,
      });
    });
  });
  return Array.from(byThreadId.values());
}

function parseCollabAgentStatusesFromMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([threadId, state]) => {
      const stateRecord =
        state && typeof state === "object"
          ? (state as Record<string, unknown>)
          : null;
      const status = asString(stateRecord?.status ?? state ?? "").trim();
      if (!status || !threadId) {
        return null;
      }
      return buildCollabAgentStatus(
        threadId,
        status,
        stateRecord?.agentNickname ??
          stateRecord?.agent_nickname ??
          stateRecord?.nickname,
        stateRecord?.agentRole ??
          stateRecord?.agent_role ??
          stateRecord?.agentType ??
          stateRecord?.agent_type ??
          stateRecord?.role,
      );
    })
    .filter((entry): entry is CollabAgentStatus => Boolean(entry));
}

function buildCollabAgentStatus(
  threadIdValue: unknown,
  statusValue: unknown,
  nicknameValue?: unknown,
  roleValue?: unknown,
): CollabAgentStatus | null {
  const status = asString(statusValue).trim();
  if (!status) {
    return null;
  }
  const base = buildCollabAgentRef(threadIdValue, nicknameValue, roleValue);
  if (!base) {
    return null;
  }
  return { ...base, status };
}

function parseCollabAgentStatuses(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      return buildCollabAgentStatus(
        record.threadId ?? record.thread_id ?? record.id,
        record.status,
        record.agentNickname ?? record.agent_nickname ?? record.nickname,
        record.agentRole ??
          record.agent_role ??
          record.agentType ??
          record.agent_type ??
          record.role,
      );
    })
    .filter((entry): entry is CollabAgentStatus => Boolean(entry));
}

function mergeCollabAgentStatuses(...lists: CollabAgentStatus[][]) {
  const byThreadId = new Map<string, CollabAgentStatus>();
  lists.forEach((list) => {
    list.forEach((entry) => {
      const existing = byThreadId.get(entry.threadId);
      if (!existing) {
        byThreadId.set(entry.threadId, { ...entry });
        return;
      }
      byThreadId.set(entry.threadId, {
        threadId: existing.threadId,
        status: existing.status || entry.status,
        nickname: existing.nickname ?? entry.nickname,
        role: existing.role ?? entry.role,
      });
    });
  });
  return Array.from(byThreadId.values());
}

function withCollabAgentMetadata(
  statuses: CollabAgentStatus[],
  agents: CollabAgentRef[],
) {
  if (statuses.length === 0 || agents.length === 0) {
    return statuses;
  }
  const byThreadId = new Map(agents.map((agent) => [agent.threadId, agent]));
  return statuses.map((entry) => {
    const metadata = byThreadId.get(entry.threadId);
    if (!metadata) {
      return entry;
    }
    return {
      ...entry,
      nickname: entry.nickname ?? metadata.nickname,
      role: entry.role ?? metadata.role,
    };
  });
}

function formatCollabAgentLabel(agent: CollabAgentRef) {
  const nickname = agent.nickname?.trim();
  const role = agent.role?.trim();
  if (nickname && role) {
    return `${nickname} [${role}]`;
  }
  if (nickname) {
    return nickname;
  }
  if (role) {
    return `${agent.threadId} [${role}]`;
  }
  return agent.threadId;
}

function formatCollabAgentStatuses(value: CollabAgentStatus[]) {
  if (value.length === 0) {
    return "";
  }
  return value
    .map((entry) => `${formatCollabAgentLabel(entry)}: ${entry.status}`)
    .join("\n");
}

export function normalizeItem(item: ConversationItem): ConversationItem {
  if (item.kind === "message") {
    return { ...item, text: truncateText(item.text) };
  }
  if (item.kind === "explore") {
    const toolCalls = item.toolCalls;
    if (!toolCalls || toolCalls.length === 0) {
      return item;
    }
    const normalizedCalls = toolCalls
      .map((tool) => normalizeItem(tool))
      .filter(
        (entry): entry is Extract<ConversationItem, { kind: "tool" }> =>
          entry.kind === "tool",
      );
    return { ...item, toolCalls: normalizedCalls };
  }
  if (item.kind === "reasoning") {
    return {
      ...item,
      summary: truncateText(item.summary),
      content: truncateText(item.content),
    };
  }
  if (item.kind === "diff") {
    return { ...item, diff: truncateText(item.diff) };
  }
  if (item.kind === "tool") {
    return {
      ...item,
      title: truncateText(item.title, 200),
      detail: truncateText(item.detail, 2000),
      output: item.output
        ? truncateToolText(item.toolType, item.output)
        : item.output,
      changes: item.changes
        ? item.changes.map((change) => ({
            ...change,
            diff: change.diff
              ? truncateToolText(item.toolType, change.diff)
              : change.diff,
          }))
        : item.changes,
    };
  }
  return item;
}

function cleanCommandText(commandText: string) {
  if (!commandText) {
    return "";
  }
  const trimmed = commandText.trim();
  const shellMatch = trimmed.match(
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-lc\s+(?:(['"])([\s\S]+)\1|([\s\S]+))$/,
  );
  const inner = shellMatch ? (shellMatch[2] ?? shellMatch[3] ?? "") : trimmed;
  const cdMatch = inner.match(
    /^\s*cd\s+[^&;]+(?:\s*&&\s*|\s*;\s*)([\s\S]+)$/i,
  );
  const stripped = cdMatch ? cdMatch[1] : inner;
  return stripped.trim();
}

function tokenizeCommand(command: string) {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let match: RegExpExecArray | null = regex.exec(command);
  while (match) {
    const [, doubleQuoted, singleQuoted, backticked, bare] = match;
    const value = doubleQuoted ?? singleQuoted ?? backticked ?? bare ?? "";
    if (value) {
      tokens.push(value);
    }
    match = regex.exec(command);
  }
  return tokens;
}

function splitCommandSegments(command: string) {
  return command
    .split(/\s*(?:&&|;)\s*/g)
    .map((segment) => trimAtPipe(segment))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function trimAtPipe(command: string) {
  if (!command) {
    return "";
  }
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char !== "|" || inSingle || inDouble) {
      continue;
    }
    const prev = index > 0 ? command[index - 1] : "";
    const next = index + 1 < command.length ? command[index + 1] : "";
    const prevIsSpace = prev === "" || /\s/.test(prev);
    const nextIsSpace = next === "" || /\s/.test(next);
    if (!prevIsSpace || !nextIsSpace) {
      continue;
    }
    return command.slice(0, index).trim();
  }
  return command.trim();
}

function isOptionToken(token: string) {
  return token.startsWith("-");
}

function isPathLike(token: string) {
  if (!token || isOptionToken(token)) {
    return false;
  }
  if (GLOB_HINT_REGEX.test(token)) {
    return false;
  }
  return PATH_HINT_REGEX.test(token) || PATHLIKE_REGEX.test(token);
}

function collectNonFlagOperands(tokens: string[], commandName: string) {
  const operands: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isOptionToken(token)) {
      if (commandName === "rg" && RG_FLAGS_WITH_VALUES.has(token)) {
        index += 1;
      }
      continue;
    }
    operands.push(token);
  }
  return operands;
}

function findPathTokens(tokens: string[]) {
  const commandName = tokens[0]?.toLowerCase() ?? "";
  const positional = collectNonFlagOperands(tokens, commandName);
  const pathLike = positional.filter(isPathLike);
  return pathLike.length > 0 ? pathLike : positional;
}

function normalizeCommandStatus(status?: string) {
  const normalized = (status ?? "").toLowerCase();
  return /(pending|running|processing|started|in[_ -]?progress|inprogress)/.test(
    normalized,
  )
    ? "exploring"
    : "explored";
}

function isFailedStatus(status?: string) {
  const normalized = (status ?? "").toLowerCase();
  return /(fail|error)/.test(normalized);
}

type ExploreEntry = Extract<ConversationItem, { kind: "explore" }>["entries"][number];
type ExploreItem = Extract<ConversationItem, { kind: "explore" }>;
type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

function mergeToolCalls(existing: ToolItem[] | undefined, incoming: ToolItem[] | undefined) {
  if ((!existing || existing.length === 0) && (!incoming || incoming.length === 0)) {
    return undefined;
  }
  const merged: ToolItem[] = existing ? [...existing] : [];
  (incoming ?? []).forEach((tool) => {
    const index = merged.findIndex((entry) => entry.id === tool.id);
    if (index >= 0) {
      merged[index] = tool;
    } else {
      merged.push(tool);
    }
  });
  return merged.length > 0 ? merged : undefined;
}

function summarizeCommandActions(actions: ConversationCommandAction[]) {
  const entries: ExploreEntry[] = [];
  actions.forEach((action) => {
    if (action.type === "read") {
      const path = action.path.trim();
      const name = action.name.trim();
      if (!path && !name) {
        return;
      }
      entries.push(
        name && path && name !== path
          ? { kind: "read", label: name, detail: path }
          : { kind: "read", label: path || name },
      );
      return;
    }
    if (action.type === "listFiles") {
      entries.push({
        kind: "list",
        label: action.path?.trim() || cleanCommandText(action.command) || "files",
      });
      return;
    }
    if (action.type === "search") {
      const query = action.query?.trim() || "";
      const path = action.path?.trim() || "";
      const label = query ? (path ? `${query} in ${path}` : query) : path;
      entries.push({
        kind: "search",
        label: label || cleanCommandText(action.command) || "search",
      });
      return;
    }
    const cleaned = cleanCommandText(action.command);
    if (cleaned) {
      entries.push({ kind: "run", label: cleaned });
    }
  });
  return entries;
}

function parseSearch(tokens: string[]): ExploreEntry | null {
  const commandName = tokens[0]?.toLowerCase() ?? "";
  const hasFilesFlag = tokens.some((token) => token === "--files");
  if (tokens[0] === "rg" && hasFilesFlag) {
    const paths = findPathTokens(tokens);
    const path = paths[paths.length - 1] || "rg --files";
    return { kind: "list", label: path };
  }
  const positional = collectNonFlagOperands(tokens, commandName);
  if (positional.length === 0) {
    return null;
  }
  const query = positional[0];
  const rawPath = positional.length > 1 ? positional[1] : "";
  const path =
    commandName === "rg" ? rawPath : rawPath && isPathLike(rawPath) ? rawPath : "";
  const label = path ? `${query} in ${path}` : query;
  return { kind: "search", label };
}

function parseRead(tokens: string[]): ExploreEntry[] | null {
  const paths = findPathTokens(tokens).filter(Boolean);
  if (paths.length === 0) {
    return null;
  }
  const entries = paths.map((path) => {
    const name = path.split(/[\\/]/g).filter(Boolean).pop() ?? path;
    return name && name !== path
      ? ({ kind: "read", label: name, detail: path } satisfies ExploreEntry)
      : ({ kind: "read", label: path } satisfies ExploreEntry);
  });
  const seen = new Set<string>();
  const deduped: ExploreEntry[] = [];
  for (const entry of entries) {
    const key = entry.detail ? `${entry.label}|${entry.detail}` : entry.label;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function parseList(tokens: string[]): ExploreEntry {
  const paths = findPathTokens(tokens);
  const path = paths[paths.length - 1];
  return { kind: "list", label: path || tokens[0] };
}

function parseCommandSegment(command: string): ExploreEntry[] | null {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return null;
  }
  const commandName = tokens[0].toLowerCase();
  if (READ_COMMANDS.has(commandName)) {
    return parseRead(tokens);
  }
  if (LIST_COMMANDS.has(commandName)) {
    return [parseList(tokens)];
  }
  if (SEARCH_COMMANDS.has(commandName)) {
    const entry = parseSearch(tokens);
    return entry ? [entry] : null;
  }
  return null;
}

function coalesceReadEntries(entries: ExploreEntry[]) {
  const result: ExploreEntry[] = [];
  const seenReads = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== "read") {
      result.push(entry);
      continue;
    }
    const key = entry.detail ? `${entry.label}|${entry.detail}` : entry.label;
    if (seenReads.has(key)) {
      continue;
    }
    seenReads.add(key);
    result.push(entry);
  }
  return result;
}

function mergeExploreEntries(base: ExploreEntry[], next: ExploreEntry[]) {
  const merged = [...base, ...next];
  const seen = new Set<string>();
  const deduped: ExploreEntry[] = [];
  for (const entry of merged) {
    const key = `${entry.kind}|${entry.label}|${entry.detail ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function summarizeCommandExecution(item: Extract<ConversationItem, { kind: "tool" }>) {
  if (isFailedStatus(item.status)) {
    return null;
  }
  const commandActionEntries = item.commandActions
    ? summarizeCommandActions(item.commandActions)
    : [];
  if (commandActionEntries.length > 0) {
    const summary: ExploreItem = {
      id: exploreItemIdForToolId(item.id),
      kind: "explore",
      status: normalizeCommandStatus(item.status),
      entries: coalesceReadEntries(commandActionEntries),
      toolCalls: [item],
    };
    return summary;
  }
  const rawCommand = item.title.replace(/^Command:\s*/i, "").trim();
  const cleaned = cleanCommandText(rawCommand);
  if (!cleaned) {
    return null;
  }
  const segments = splitCommandSegments(cleaned);
  if (segments.length === 0) {
    return null;
  }
  const entries: ExploreEntry[] = [];
  for (const segment of segments) {
    const parsed = parseCommandSegment(segment);
    if (!parsed) {
      return null;
    }
    entries.push(...parsed);
  }
  if (entries.length === 0) {
    return null;
  }
  const coalescedEntries = coalesceReadEntries(entries);
  const status: ExploreItem["status"] = normalizeCommandStatus(item.status);
  const summary: ExploreItem = {
    id: exploreItemIdForToolId(item.id),
    kind: "explore",
    status,
    entries: coalescedEntries,
    toolCalls: [item],
  };
  return summary;
}

function summarizeExploration(items: ConversationItem[]) {
  const result: ConversationItem[] = [];

  for (const item of items) {
    if (item.kind === "explore") {
      const last = result[result.length - 1];
      if (last?.kind === "explore" && last.status === item.status) {
        result[result.length - 1] = {
          ...last,
          entries: mergeExploreEntries(last.entries, item.entries),
          toolCalls: mergeToolCalls(last.toolCalls, item.toolCalls),
        };
        continue;
      }
      result.push(item);
      continue;
    }
    if (item.kind === "tool" && item.toolType === "commandExecution") {
      const summary = summarizeCommandExecution(item);
      if (!summary) {
        result.push(item);
        continue;
      }
      const last = result[result.length - 1];
      if (last?.kind === "explore" && last.status === summary.status) {
        result[result.length - 1] = {
          ...last,
          entries: mergeExploreEntries(last.entries, summary.entries),
          toolCalls: mergeToolCalls(last.toolCalls, summary.toolCalls),
        };
        continue;
      }
      result.push(summary);
      continue;
    }
    result.push(item);
  }
  return result;
}

export function prepareThreadItems(items: ConversationItem[], options?: PrepareThreadItemsOptions) {
  const filtered: ConversationItem[] = [];
  for (const item of items) {
    const last = filtered[filtered.length - 1];
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      last?.kind === "review" &&
      last.state === "completed" &&
      item.text.trim() === last.text.trim()
    ) {
      continue;
    }
    filtered.push(item);
  }
  const normalized = filtered.map((item) => normalizeItem(item));
  const maxItemsPerThreadRaw = options?.maxItemsPerThread;
  const maxItemsPerThread =
    maxItemsPerThreadRaw === null
      ? null
      : typeof maxItemsPerThreadRaw === "number" &&
          Number.isFinite(maxItemsPerThreadRaw) &&
          maxItemsPerThreadRaw > 0
        ? Math.floor(maxItemsPerThreadRaw)
        : DEFAULT_MAX_ITEMS_PER_THREAD;
  const limited =
    maxItemsPerThread === null
      ? normalized
      : normalized.length > maxItemsPerThread
        ? normalized.slice(-maxItemsPerThread)
        : normalized;
  const summarized = summarizeExploration(limited);
  const cutoff = Math.max(0, summarized.length - TOOL_OUTPUT_RECENT_ITEMS);
  return summarized.map((item, index) => {
    if (index >= cutoff) {
      return item;
    }

    if (item.kind === "tool") {
      const output = item.output ? truncateText(item.output) : item.output;
      const changes = item.changes
        ? item.changes.map((change) => ({
            ...change,
            diff: change.diff ? truncateText(change.diff) : change.diff,
          }))
        : item.changes;
      if (output === item.output && changes === item.changes) {
        return item;
      }
      return { ...item, output, changes };
    }

    if (item.kind === "explore" && item.toolCalls && item.toolCalls.length > 0) {
      let didChange = false;
      const toolCalls = item.toolCalls.map((tool) => {
        const output = tool.output ? truncateText(tool.output) : tool.output;
        const changes = tool.changes
          ? tool.changes.map((change) => ({
              ...change,
              diff: change.diff ? truncateText(change.diff) : change.diff,
            }))
          : tool.changes;
        if (output === tool.output && changes === tool.changes) {
          return tool;
        }
        didChange = true;
        return { ...tool, output, changes };
      });
      return didChange ? { ...item, toolCalls } : item;
    }

    return item;
  });
}

function mergeToolUpdate(existing: ToolItem, incoming: ToolItem): ToolItem {
  const existingOutput = existing.output ?? "";
  const incomingOutput = incoming.output ?? "";
  const hasIncomingOutput = incomingOutput.trim().length > 0;
  const hasIncomingChanges = (incoming.changes?.length ?? 0) > 0;
  return {
    ...existing,
    ...incoming,
    title: incoming.title?.trim() ? incoming.title : existing.title,
    detail: incoming.detail?.trim() ? incoming.detail : existing.detail,
    status: incoming.status?.trim() ? incoming.status : existing.status,
    output: hasIncomingOutput ? incomingOutput : existingOutput,
    changes: hasIncomingChanges ? incoming.changes : existing.changes,
    durationMs:
      typeof incoming.durationMs === "number" ? incoming.durationMs : existing.durationMs,
  };
}

function deriveExploreStatusFromToolCalls(
  toolCalls: ToolItem[] | undefined,
  fallback: ExploreItem["status"],
) {
  if (!toolCalls || toolCalls.length === 0) {
    return fallback;
  }
  return toolCalls.some((tool) => normalizeCommandStatus(tool.status) === "exploring")
    ? "exploring"
    : "explored";
}

function upsertNestedToolCall(
  list: ConversationItem[],
  tool: ToolItem,
): ConversationItem[] | null {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (entry.kind !== "explore") {
      continue;
    }
    const calls = entry.toolCalls;
    const callIndex = calls ? calls.findIndex((call) => call.id === tool.id) : -1;
    if (!calls || callIndex < 0) {
      continue;
    }
    const nextCalls = [...calls];
    nextCalls[callIndex] = mergeToolUpdate(nextCalls[callIndex], tool);
    const nextExplore: ExploreItem = {
      ...entry,
      status: deriveExploreStatusFromToolCalls(nextCalls, entry.status),
      toolCalls: nextCalls,
    };
    const next = [...list];
    next[index] = nextExplore;
    return next;
  }
  return null;
}

export function upsertItem(list: ConversationItem[], item: ConversationItem) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    if (item.kind === "tool") {
      const nested = upsertNestedToolCall(list, item);
      if (nested) {
        return nested;
      }
    }
    return [...list, item];
  }
  const existing = list[index];
  const next = [...list];

  if (existing.kind !== item.kind) {
    next[index] = item;
    return next;
  }

  if (existing.kind === "message" && item.kind === "message") {
    const existingText = existing.text ?? "";
    const incomingText = item.text ?? "";
    next[index] = {
      ...existing,
      ...item,
      text: incomingText.length >= existingText.length ? incomingText : existingText,
      images: item.images?.length ? item.images : existing.images,
    };
    return next;
  }

  if (existing.kind === "reasoning" && item.kind === "reasoning") {
    const existingSummary = existing.summary ?? "";
    const incomingSummary = item.summary ?? "";
    const existingContent = existing.content ?? "";
    const incomingContent = item.content ?? "";
    next[index] = {
      ...existing,
      ...item,
      summary:
        incomingSummary.length >= existingSummary.length
          ? incomingSummary
          : existingSummary,
      content:
        incomingContent.length >= existingContent.length
          ? incomingContent
          : existingContent,
    };
    return next;
  }

  if (existing.kind === "tool" && item.kind === "tool") {
    next[index] = mergeToolUpdate(existing, item);
    return next;
  }

  if (existing.kind === "diff" && item.kind === "diff") {
    const existingDiff = existing.diff ?? "";
    const incomingDiff = item.diff ?? "";
    next[index] = {
      ...existing,
      ...item,
      title: item.title?.trim() ? item.title : existing.title,
      status: item.status?.trim() ? item.status : existing.status,
      diff: incomingDiff.length >= existingDiff.length ? incomingDiff : existingDiff,
    };
    return next;
  }

  if (existing.kind === "review" && item.kind === "review") {
    const existingText = existing.text ?? "";
    const incomingText = item.text ?? "";
    next[index] = {
      ...existing,
      ...item,
      text: incomingText.length >= existingText.length ? incomingText : existingText,
    };
    return next;
  }

  next[index] = { ...existing, ...item };
  return next;
}

function normalizeThreadTimestamp(raw: unknown) {
  let numeric: number;
  if (typeof raw === "string") {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {
      numeric = asNumber;
    } else {
      const parsed = Date.parse(raw);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      numeric = parsed;
    }
  } else {
    numeric = Number(raw);
  }
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export function getThreadTimestamp(thread: Record<string, unknown>) {
  const raw =
    (thread.updatedAt ?? thread.updated_at ?? thread.createdAt ?? thread.created_at) ??
    0;
  return normalizeThreadTimestamp(raw);
}

export function getThreadCreatedTimestamp(thread: Record<string, unknown>) {
  const raw = (thread.createdAt ?? thread.created_at) ?? 0;
  return normalizeThreadTimestamp(raw);
}

export function previewThreadName(text: string, fallback: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
}

export function buildConversationItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = resolveConversationItemId(type, item);
  if (!id || !type) {
    return null;
  }
  if (type === "agentMessage") {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content);
    return {
      id,
      kind: "message",
      role: "user",
      text,
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "reasoning") {
    const summary = extractStructuredText(item.summary ?? "");
    const content = extractStructuredText(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  if (type === "plan") {
    return {
      id,
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: asString(item.status ?? ""),
      status: asString(item.status ?? ""),
      output: asString(item.text ?? ""),
    };
  }
  if (type === "commandExecution") {
    const command = commandTextFromValue(item.command ?? "");
    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
    return buildCommandExecutionToolItem(id, {
      command,
      cwd: asString(item.cwd ?? "").trim(),
      status: asString(item.status ?? ""),
      output: asString(item.aggregatedOutput ?? ""),
      durationMs,
      commandActions: normalizeCommandActions(
        item.commandActions ?? item.command_actions,
      ),
    });
  }
  if (type === "dynamicToolCall") {
    return buildDynamicToolCallConversationItem(id, item);
  }
  if (type === "local_shell_call") {
    const action = asRecord(item.action);
    const command = commandTextFromValue(action?.command ?? "");
    const cwd = asString(
      action?.working_directory ?? action?.workingDirectory ?? "",
    ).trim();
    return buildCommandExecutionToolItem(id, {
      command,
      cwd,
      status: normalizeToolStatus(item.status),
      output: "",
    });
  }
  if (type === "custom_tool_call" || type === "function_call") {
    const toolName = asString(item.name ?? "").trim();
    const rawArguments = type === "custom_tool_call" ? item.input : item.arguments;
    const parsedArguments =
      typeof rawArguments === "string"
        ? parseJsonStringValue(rawArguments)
        : rawArguments;
    return buildDynamicToolCallConversationItem(id, {
      type: "dynamicToolCall",
      id,
      tool: toolName,
      arguments: parsedArguments,
      status:
        type === "custom_tool_call"
          ? item.status ?? "completed"
          : "completed",
      success: true,
    });
  }
  if (type === "web_search_call") {
    const action = asRecord(item.action);
    const actionType = asString(action?.type ?? "").trim().toLowerCase();
    const searchQueries = normalizeStringList(action?.queries ?? action?.query);
    const primaryQuery =
      searchQueries[0] ||
      asString(action?.pattern ?? action?.url ?? "").trim();
    const detail =
      actionType === "openpage" || actionType === "open_page"
        ? primaryQuery || "Open page"
        : actionType === "findinpage" || actionType === "find_in_page"
          ? primaryQuery || "Find in page"
          : primaryQuery;
    return {
      id,
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail,
      status: normalizeToolStatus(item.status, true) || "completed",
      output: "",
    };
  }
  if (type === "fileChange") {
    return buildFileChangeToolItem(id, {
      status: asString(item.status ?? ""),
      changes: normalizeFileChanges(item.changes),
    });
  }
  if (type === "mcpToolCall") {
    const server = asString(item.server ?? "");
    const tool = asString(item.tool ?? "");
    const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    return {
      id,
      kind: "tool",
      toolType: type,
      title: `Tool: ${server}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(item.status ?? ""),
      output: asString(item.result ?? item.error ?? ""),
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    const tool = asString(item.tool ?? "");
    const status = asString(item.status ?? "");
    const senderThreadId = asString(item.senderThreadId ?? item.sender_thread_id ?? "");
    const sender = buildCollabAgentRef(
      senderThreadId,
      item.senderAgentNickname ??
        item.sender_agent_nickname ??
        item.agentNickname ??
        item.agent_nickname,
      item.senderAgentRole ??
        item.sender_agent_role ??
        item.agentRole ??
        item.agent_role ??
        item.agentType ??
        item.agent_type,
    );
    const receiverFromInteraction = buildCollabAgentRef(
      item.receiverThreadId ?? item.receiver_thread_id,
      item.receiverAgentNickname ?? item.receiver_agent_nickname,
      item.receiverAgentRole ??
        item.receiver_agent_role ??
        item.receiverAgentType ??
        item.receiver_agent_type,
    );
    const receiverFromSpawn = buildCollabAgentRef(
      item.newThreadId ?? item.new_thread_id,
      item.newAgentNickname ?? item.new_agent_nickname,
      item.newAgentRole ?? item.new_agent_role ?? item.newAgentType ?? item.new_agent_type,
    );
    const receiverIds = [
      ...normalizeStringList(item.receiverThreadId ?? item.receiver_thread_id),
      ...normalizeStringList(item.receiverThreadIds ?? item.receiver_thread_ids),
      ...normalizeStringList(item.newThreadId ?? item.new_thread_id),
    ]
      .map((entry) => buildCollabAgentRef(entry))
      .filter((entry): entry is CollabAgentRef => Boolean(entry));
    const receiverAgents = mergeCollabAgentRefs(
      receiverIds,
      parseCollabAgentRefs(item.receiverAgents ?? item.receiver_agents),
      receiverFromInteraction ? [receiverFromInteraction] : [],
      receiverFromSpawn ? [receiverFromSpawn] : [],
    );
    const collabStatuses = withCollabAgentMetadata(
      mergeCollabAgentStatuses(
        parseCollabAgentStatuses(item.agentStatuses ?? item.agent_statuses),
        parseCollabAgentStatusesFromMap(item.statuses),
        parseCollabAgentStatusesFromMap(
          item.agentStatus ?? item.agentsStates ?? item.agents_states,
        ),
      ),
      receiverAgents,
    );
    const prompt = asString(item.prompt ?? "");
    const agentsState = formatCollabAgentStatuses(collabStatuses);
    const detailParts = [sender ? `From ${formatCollabAgentLabel(sender)}` : ""]
      .concat(
        receiverAgents.length > 0
          ? `→ ${receiverAgents.map((entry) => formatCollabAgentLabel(entry)).join(", ")}`
          : "",
      )
      .filter(Boolean);
    const outputParts = [prompt, agentsState].filter(Boolean);
    const primaryReceiver = receiverFromInteraction ?? receiverFromSpawn ?? receiverAgents[0];
    return {
      id,
      kind: "tool",
      toolType: "collabToolCall",
      title: tool ? `Collab: ${tool}` : "Collab tool call",
      detail: detailParts.join(" "),
      status,
      output: outputParts.join("\n\n"),
      collabSender: sender ?? undefined,
      collabReceiver: primaryReceiver ?? undefined,
      collabReceivers: receiverAgents.length > 0 ? receiverAgents : undefined,
      collabStatuses: collabStatuses.length > 0 ? collabStatuses : undefined,
    };
  }
  if (type === "webSearch") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Web search",
      detail: asString(item.query ?? ""),
      status: status || "completed",
      output: "",
    };
  }
  if (type === "imageView") {
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Image view",
      detail: asString(item.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (type === "contextCompaction") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Context compaction",
      detail: "Compacting conversation context to fit token limits.",
      status: status || "completed",
      output: "",
    };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return {
      id,
      kind: "review",
      state: type === "enteredReviewMode" ? "started" : "completed",
      text: asString(item.review ?? ""),
    };
  }
  return null;
}

function extractImageInputValue(input: Record<string, unknown>) {
  const value =
    asString(input.url ?? "") ||
    asString(input.path ?? "") ||
    asString(input.value ?? "") ||
    asString(input.data ?? "") ||
    asString(input.source ?? "");
  return value.trim();
}

function parseUserInputs(inputs: Array<Record<string, unknown>>) {
  const textParts: string[] = [];
  const images: string[] = [];
  inputs.forEach((input) => {
    const type = asString(input.type);
    if (type === "text") {
      const text = asString(input.text);
      if (text) {
        textParts.push(text);
      }
      return;
    }
    if (type === "skill") {
      const name = asString(input.name);
      if (name) {
        textParts.push(`$${name}`);
      }
      return;
    }
    if (type === "image" || type === "localImage") {
      const value = extractImageInputValue(input);
      if (value) {
        images.push(value);
      }
    }
  });
  return { text: textParts.join(" ").trim(), images };
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = resolveConversationItemId(type, item);
  if (!id || !type) {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content);
    return {
      id,
      kind: "message",
      role: "user",
      text,
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "agentMessage") {
    return {
      id,
      kind: "message",
      role: "assistant",
      text: extractStructuredText(item.text ?? item.content ?? ""),
    };
  }
  if (type === "reasoning") {
    const summary = extractStructuredText(item.summary ?? "");
    const content = extractStructuredText(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  return buildConversationItem(item);
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const converted = buildConversationItemFromThreadItem(item);
      if (converted) {
        items.push(converted);
      }
    });
  });
  return items;
}

export function isReviewingFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let reviewing = false;
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const type = asString(item?.type ?? "");
      if (type === "enteredReviewMode") {
        reviewing = true;
      } else if (type === "exitedReviewMode") {
        reviewing = false;
      }
    });
  });
  return reviewing;
}

function chooseRicherItem(remote: ConversationItem, local: ConversationItem) {
  if (remote.kind !== local.kind) {
    return remote;
  }
  if (remote.kind === "message" && local.kind === "message") {
    return local.text.length > remote.text.length ? local : remote;
  }
  if (remote.kind === "reasoning" && local.kind === "reasoning") {
    const remoteLength = remote.summary.length + remote.content.length;
    const localLength = local.summary.length + local.content.length;
    return localLength > remoteLength ? local : remote;
  }
  if (remote.kind === "tool" && local.kind === "tool") {
    const remoteOutput = remote.output ?? "";
    const localOutput = local.output ?? "";
    const hasRemoteOutput = remoteOutput.trim().length > 0;
    const remoteStatus = remote.status?.trim();
    return {
      ...remote,
      status: remoteStatus ? remote.status : local.status,
      output: hasRemoteOutput ? remoteOutput : localOutput,
      changes: remote.changes ?? local.changes,
      collabSender: remote.collabSender ?? local.collabSender,
      collabReceiver: remote.collabReceiver ?? local.collabReceiver,
      collabReceivers:
        (remote.collabReceivers?.length ?? 0) > 0
          ? remote.collabReceivers
          : local.collabReceivers,
      collabStatuses:
        (remote.collabStatuses?.length ?? 0) > 0
          ? remote.collabStatuses
          : local.collabStatuses,
    };
  }
  if (remote.kind === "diff" && local.kind === "diff") {
    const useLocal = local.diff.length > remote.diff.length;
    const remoteStatus = remote.status?.trim();
    return {
      ...remote,
      diff: useLocal ? local.diff : remote.diff,
      status: remoteStatus ? remote.status : local.status,
    };
  }
  return remote;
}

export function mergeThreadItems(
  remoteItems: ConversationItem[],
  localItems: ConversationItem[],
) {
  if (!localItems.length) {
    return remoteItems;
  }
  const byId = new Map(remoteItems.map((item) => [item.id, item]));
  const merged = remoteItems.map((item) => {
    const local = localItems.find((entry) => entry.id === item.id);
    return local ? chooseRicherItem(item, local) : item;
  });
  localItems.forEach((item) => {
    if (!byId.has(item.id)) {
      merged.push(item);
    }
  });
  return merged;
}
