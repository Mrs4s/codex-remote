type ParsedSubagentNotification = {
  agentId: string;
  status: string;
  output: string;
};

const SUBAGENT_NOTIFICATION_PATTERN =
  /^\s*<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>\s*$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeStatus(value: string) {
  const normalized = value.trim().replace(/[\s-]+/g, "_").toLowerCase();
  if (!normalized) {
    return "";
  }
  if (/(fail|error|interrupt|cancel)/.test(normalized)) {
    return "errored";
  }
  if (/(pending|running|processing|started|progress)/.test(normalized)) {
    return "inProgress";
  }
  if (/(complete|completed|success|done|finished|closed)/.test(normalized)) {
    return "completed";
  }
  return normalized;
}

export function parseSubagentNotificationTaggedMessage(
  text: string,
): ParsedSubagentNotification | null {
  const match = text.match(SUBAGENT_NOTIFICATION_PATTERN);
  if (!match) {
    return null;
  }

  const payloadText = match[1]?.trim();
  if (!payloadText) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record) {
    return null;
  }

  const agentId = asText(
    record.agent_id ?? record.agentId ?? record.thread_id ?? record.threadId ?? record.id,
  );
  const statusRecord = asRecord(record.status);
  const [statusKey, statusValue] =
    statusRecord && Object.keys(statusRecord).length > 0
      ? (Object.entries(statusRecord)[0] ?? ["", ""])
      : ["", ""];
  const status = normalizeStatus(String(statusKey ?? ""));
  const output = asText(statusValue);

  if (!agentId && !status && !output) {
    return null;
  }

  return {
    agentId,
    status: status || "updated",
    output,
  };
}
