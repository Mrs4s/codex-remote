import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

type RawRecord = Record<string, unknown>;

export type McpTransportType = "streamable_http" | "stdio";

export type McpTransportConfig = {
  type: string;
  url: string | null;
  bearerTokenEnvVar: string | null;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  httpHeaders: Record<string, string> | null;
  envHttpHeaders: Record<string, string> | null;
};

export type McpServerConfigSummary = {
  name: string;
  enabled: boolean;
  disabledReason: string | null;
  transport: McpTransportConfig;
  startupTimeoutSec: number | null;
  toolTimeoutSec: number | null;
  authStatus: string | null;
};

export type McpServerConfigDetail = McpServerConfigSummary & {
  enabledTools: string[] | null;
  disabledTools: string[] | null;
};

export type AddMcpServerInput = {
  name: string;
  transport: McpTransportType;
  url?: string | null;
  bearerTokenEnvVar?: string | null;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
};

function asRecord(value: unknown): RawRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RawRecord;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const next = value
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter((item) => item.length > 0);
  return next.length > 0 ? next : [];
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const next: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    next[key] = String(rawValue);
  }
  return Object.keys(next).length > 0 ? next : {};
}

function normalizeTransport(value: unknown): McpTransportConfig {
  const record = asRecord(value) ?? {};
  return {
    type: normalizeString(record.type) ?? "unknown",
    url: normalizeString(record.url),
    bearerTokenEnvVar:
      normalizeString(record.bearerTokenEnvVar) ??
      normalizeString(record.bearer_token_env_var),
    command: normalizeString(record.command),
    args: normalizeStringArray(record.args),
    env: normalizeStringRecord(record.env),
    httpHeaders:
      normalizeStringRecord(record.httpHeaders) ??
      normalizeStringRecord(record.http_headers),
    envHttpHeaders:
      normalizeStringRecord(record.envHttpHeaders) ??
      normalizeStringRecord(record.env_http_headers),
  };
}

function normalizeSummary(value: unknown): McpServerConfigSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const name = normalizeString(record.name);
  if (!name) {
    return null;
  }
  return {
    name,
    enabled: record.enabled === true,
    disabledReason:
      normalizeString(record.disabledReason) ??
      normalizeString(record.disabled_reason),
    transport: normalizeTransport(record.transport),
    startupTimeoutSec:
      normalizeNumber(record.startupTimeoutSec) ??
      normalizeNumber(record.startup_timeout_sec),
    toolTimeoutSec:
      normalizeNumber(record.toolTimeoutSec) ??
      normalizeNumber(record.tool_timeout_sec),
    authStatus:
      normalizeString(record.authStatus) ??
      normalizeString(record.auth_status),
  };
}

function normalizeDetail(value: unknown): McpServerConfigDetail | null {
  const summary = normalizeSummary(value);
  if (!summary) {
    return null;
  }
  const record = asRecord(value) ?? {};
  const enabledTools =
    normalizeStringArray(record.enabledTools) ??
    normalizeStringArray(record.enabled_tools);
  const disabledTools =
    normalizeStringArray(record.disabledTools) ??
    normalizeStringArray(record.disabled_tools);
  return {
    ...summary,
    enabledTools,
    disabledTools,
  };
}

function normalizeCommandName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("name is required");
  }
  return trimmed;
}

function parseCodexJson<T>(rawStdout: string, commandName: string): T {
  const stdout = rawStdout.trim();
  if (!stdout) {
    throw new Error(`codex ${commandName} returned empty output`);
  }

  const firstObjectIndex = stdout.indexOf("{");
  const firstArrayIndex = stdout.indexOf("[");
  const firstJsonIndex =
    firstObjectIndex < 0
      ? firstArrayIndex
      : firstArrayIndex < 0
        ? firstObjectIndex
        : Math.min(firstObjectIndex, firstArrayIndex);
  const jsonText = firstJsonIndex > 0 ? stdout.slice(firstJsonIndex) : stdout;

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    throw new Error(`Unable to parse JSON from codex ${commandName} output`);
  }
}

function describeCodexFailure(error: unknown, args: string[]): string {
  const command = `codex ${args.join(" ")}`.trim();
  if (!error || typeof error !== "object") {
    return `${command} failed`;
  }
  const message = (error as { message?: unknown }).message;
  const stderr = (error as { stderr?: unknown }).stderr;
  const stdout = (error as { stdout?: unknown }).stdout;
  const details = [stderr, stdout, message]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .join("\n");
  return details ? `${command} failed: ${details}` : `${command} failed`;
}

export class McpManagerService {
  constructor(private readonly getCodexBin: () => Promise<string>) {}

  private async runMcpCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const codexBin = await this.getCodexBin();
    try {
      const response = await execFileAsync(codexBin, ["mcp", ...args], {
        env: process.env,
        maxBuffer: COMMAND_MAX_BUFFER,
      });
      return {
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
      };
    } catch (error) {
      throw new Error(describeCodexFailure(error, ["mcp", ...args]));
    }
  }

  async listServers(): Promise<{ data: McpServerConfigSummary[] }> {
    const { stdout } = await this.runMcpCommand(["list", "--json"]);
    const parsed = parseCodexJson<unknown>(stdout, "mcp list --json");
    if (!Array.isArray(parsed)) {
      throw new Error("Unexpected codex mcp list --json response");
    }

    const servers = parsed
      .map((entry) => normalizeSummary(entry))
      .filter((entry): entry is McpServerConfigSummary => Boolean(entry))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { data: servers };
  }

  async getServer(name: string): Promise<McpServerConfigDetail> {
    const serverName = normalizeCommandName(name);
    const { stdout } = await this.runMcpCommand(["get", serverName, "--json"]);
    const parsed = parseCodexJson<unknown>(stdout, "mcp get --json");
    const detail = normalizeDetail(parsed);
    if (!detail) {
      throw new Error(`Unable to read MCP server details: ${serverName}`);
    }
    return detail;
  }

  async addServer(input: AddMcpServerInput): Promise<void> {
    const name = normalizeCommandName(input.name);
    const args = ["add", name];

    if (input.transport === "streamable_http") {
      const url = normalizeString(input.url);
      if (!url) {
        throw new Error("url is required for streamable_http MCP servers");
      }
      args.push("--url", url);

      const bearerTokenEnvVar = normalizeString(input.bearerTokenEnvVar);
      if (bearerTokenEnvVar) {
        args.push("--bearer-token-env-var", bearerTokenEnvVar);
      }
    } else {
      const command = normalizeString(input.command);
      if (!command) {
        throw new Error("command is required for stdio MCP servers");
      }
      const envRecord = input.env ?? {};
      const envEntries = Object.entries(envRecord)
        .map(([rawKey, rawValue]) => [rawKey.trim(), String(rawValue)] as const)
        .filter(([key]) => key.length > 0)
        .sort(([left], [right]) => left.localeCompare(right));
      for (const [key, value] of envEntries) {
        args.push("--env", `${key}=${value}`);
      }

      const commandArgs = (input.args ?? [])
        .map((entry) => String(entry))
        .filter((entry) => entry.length > 0);
      args.push("--", command, ...commandArgs);
    }

    await this.runMcpCommand(args);
  }

  async removeServer(name: string): Promise<void> {
    const serverName = normalizeCommandName(name);
    await this.runMcpCommand(["remove", serverName]);
  }

  async logoutServer(name: string): Promise<void> {
    const serverName = normalizeCommandName(name);
    await this.runMcpCommand(["logout", serverName]);
  }
}
