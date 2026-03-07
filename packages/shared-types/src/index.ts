import { z } from "zod";
import type { ChatAttachment } from "./chatAttachments.ts";
export * from "./codexArgs.ts";
export * from "./chatAttachments.ts";

export const appServerEventSchema = z.object({
  workspace_id: z.string(),
  message: z.record(z.unknown()),
});

export const terminalOutputEventSchema = z.object({
  workspaceId: z.string(),
  terminalId: z.string(),
  data: z.string(),
});

export const terminalExitEventSchema = z.object({
  workspaceId: z.string(),
  terminalId: z.string(),
});

export const dictationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state"),
    state: z.enum(["idle", "listening", "processing"]),
  }),
  z.object({
    type: z.literal("level"),
    value: z.number(),
  }),
  z.object({
    type: z.literal("transcript"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("canceled"),
    message: z.string(),
  }),
]);

export const dictationDownloadEventSchema = z.object({
  state: z.enum(["missing", "downloading", "ready", "error"]),
  modelId: z.string(),
  progress: z
    .object({
      totalBytes: z.number().nullable().optional(),
      downloadedBytes: z.number(),
    })
    .nullable()
    .optional(),
  error: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
});

export type AppServerEvent = z.infer<typeof appServerEventSchema>;
export type TerminalOutputEvent = z.infer<typeof terminalOutputEventSchema>;
export type TerminalExitEvent = z.infer<typeof terminalExitEventSchema>;
export type DictationEvent = z.infer<typeof dictationEventSchema>;
export type DictationDownloadEvent = z.infer<typeof dictationDownloadEventSchema>;

export type RpcError = {
  message: string;
  code?: string;
  details?: unknown;
};

export type RpcSuccess<T> = { result: T };
export type RpcFailure = { error: RpcError };
export type RpcResponse<T> = RpcSuccess<T> | RpcFailure;

export type LaunchScriptIconId =
  | "play"
  | "build"
  | "debug"
  | "wrench"
  | "terminal"
  | "code"
  | "server"
  | "database"
  | "package"
  | "test"
  | "lint"
  | "dev"
  | "git"
  | "config"
  | "logs";

export type LaunchScriptEntry = {
  id: string;
  script: string;
  icon: LaunchScriptIconId;
  label?: string | null;
};

export type AccessMode = "read-only" | "current" | "full-access";
export type ServiceTier = "fast" | "flex";

export type WorkspaceSettings = {
  sidebarCollapsed: boolean;
  sortOrder?: number | null;
  groupId?: string | null;
  cloneSourceWorkspaceId?: string | null;
  gitRoot?: string | null;
  launchScript?: string | null;
  launchScripts?: LaunchScriptEntry[] | null;
  worktreeSetupScript?: string | null;
  defaultAccessMode?: AccessMode | null;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  connected: boolean;
  kind?: "main" | "worktree";
  parentId?: string | null;
  worktree?: { branch: string } | null;
  settings: WorkspaceSettings;
};

export type ThreadSummary = {
  id: string;
  name: string;
  updatedAt: number;
  createdAt?: number;
  modelId?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null;
};

export type UndoCheckpointStatus = "created" | "ready" | "undone" | "failed";

export type UndoLineRange = {
  kind: "add" | "del";
  start: number;
  end: number;
};

export type UndoEditedFileSummary = {
  path: string;
  additions: number;
  deletions: number;
  lineRanges: UndoLineRange[];
};

export type UndoCheckpointSummary = {
  id: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  status: UndoCheckpointStatus;
  createdAt: number;
  completedAt: number | null;
  undoneAt: number | null;
  failedAt: number | null;
  failureMessage: string | null;
  undoable: boolean;
  files: UndoEditedFileSummary[];
  outOfBandFiles: string[];
};

export type PromptScope = "workspace" | "global";

export type PromptEntry = {
  path: string;
  scope: PromptScope;
  name: string;
  description: string | null;
  argumentHint: string | null;
  content: string;
};

export type TextFileResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
};

export type AgentSummary = {
  name: string;
  description: string | null;
  developerInstructions: string | null;
  configFile: string;
  resolvedPath: string;
  managedByApp: boolean;
  fileExists: boolean;
};

export type AgentsSettings = {
  configPath: string;
  multiAgentEnabled: boolean;
  maxThreads: number;
  maxDepth: number;
  agents: AgentSummary[];
};

export type SetAgentsCoreInput = {
  multiAgentEnabled: boolean;
  maxThreads: number;
  maxDepth: number;
};

export type CreateAgentInput = {
  name: string;
  description?: string | null;
  developerInstructions?: string | null;
  template?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
};

export type UpdateAgentInput = {
  originalName: string;
  name: string;
  description?: string | null;
  developerInstructions?: string | null;
  renameManagedFile?: boolean;
};

export type DeleteAgentInput = {
  name: string;
  deleteManagedFile?: boolean;
};

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

export type LocalUsageDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  agentTimeMs: number;
  agentRuns: number;
};

export type LocalUsageTotals = {
  last7DaysTokens: number;
  last30DaysTokens: number;
  averageDailyTokens: number;
  cacheHitRatePercent: number;
  peakDay: string | null;
  peakDayTokens: number;
};

export type LocalUsageModel = {
  model: string;
  tokens: number;
  sharePercent: number;
};

export type LocalUsageSnapshot = {
  updatedAt: number;
  days: LocalUsageDay[];
  totals: LocalUsageTotals;
  topModels: LocalUsageModel[];
};

export type LocalUsageCostDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  cachedInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

export type LocalUsageCostSnapshot = {
  updatedAt: number;
  days: LocalUsageCostDay[];
  pricingFetchedAt: number | null;
  pricingSource: "empty" | "disk" | "remote";
  missingPricingModels: string[];
};

export type LocalUsageCountingMode = "deduped" | "ccusage";

export type LiteLLMPricingLookup = {
  model: string;
  matchedModel: string | null;
  pricingFound: boolean;
  inputCostPerToken: number;
  cachedInputCostPerToken: number;
  outputCostPerToken: number;
  cacheCreationInputCostPerToken: number;
  fetchedAt: number | null;
  source: "empty" | "disk" | "remote" | "free";
};

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

export type RpcMethodMap = {
  list_workspaces: {
    params: Record<string, never>;
    result: WorkspaceInfo[];
  };
  add_workspace: {
    params: { path: string; defaultAccessMode?: AccessMode | null };
    result: WorkspaceInfo;
  };
  add_workspace_from_git_url: {
    params: {
      url: string;
      destinationPath: string;
      targetFolderName?: string | null;
      defaultAccessMode?: AccessMode | null;
    };
    result: WorkspaceInfo;
  };
  is_workspace_path_dir: {
    params: { path: string };
    result: boolean;
  };
  remove_workspace: {
    params: { id: string };
    result: { ok: true };
  };
  connect_workspace: {
    params: { id: string };
    result: { ok: true };
  };
  set_workspace_runtime_codex_args: {
    params: { workspaceId: string; codexArgs?: string | null };
    result: { appliedCodexArgs: string | null; respawned: boolean };
  };
  update_workspace_settings: {
    params: { id: string; settings: WorkspaceSettings };
    result: WorkspaceInfo;
  };
  start_thread: {
    params: { workspaceId: string; accessMode?: string | null; serviceTier?: ServiceTier | null };
    result: Record<string, unknown>;
  };
  list_threads: {
    params: {
      workspaceId: string;
      cursor?: string | null;
      limit?: number | null;
      sortKey?: "created_at" | "updated_at" | null;
    };
    result: Record<string, unknown>;
  };
  resume_thread: {
    params: { workspaceId: string; threadId: string; serviceTier?: ServiceTier | null };
    result: Record<string, unknown>;
  };
  fork_thread: {
    params: { workspaceId: string; threadId: string };
    result: Record<string, unknown>;
  };
  compact_thread: {
    params: { workspaceId: string; threadId: string };
    result: Record<string, unknown>;
  };
  archive_thread: {
    params: { workspaceId: string; threadId: string };
    result: Record<string, unknown>;
  };
  set_thread_name: {
    params: { workspaceId: string; threadId: string; name: string };
    result: Record<string, unknown>;
  };
  thread_token_usage_snapshot: {
    params: { workspaceId: string; threadId: string };
    result: ThreadTokenUsageSnapshot;
  };
  thread_live_subscribe: {
    params: { workspaceId: string; threadId: string };
    result: Record<string, unknown>;
  };
  thread_live_unsubscribe: {
    params: { workspaceId: string; threadId: string };
    result: { ok: true };
  };
  list_mcp_server_status: {
    params: { workspaceId: string; cursor?: string | null; limit?: number | null };
    result: Record<string, unknown>;
  };
  mcp_servers_list: {
    params: Record<string, never>;
    result: { data: McpServerConfigSummary[] };
  };
  mcp_server_get: {
    params: { name: string };
    result: McpServerConfigDetail;
  };
  mcp_server_add: {
    params: {
      name: string;
      transport: McpTransportType;
      url?: string | null;
      bearerTokenEnvVar?: string | null;
      command?: string | null;
      args?: string[] | null;
      env?: Record<string, string> | null;
    };
    result: { ok: true };
  };
  mcp_server_remove: {
    params: { name: string };
    result: { ok: true };
  };
  mcp_server_logout: {
    params: { name: string };
    result: { ok: true };
  };
  mcp_server_oauth_login: {
    params: {
      workspaceId: string;
      name: string;
      scopes?: string[] | null;
      timeoutSecs?: number | null;
    };
    result: { authorizationUrl: string };
  };
  send_user_message: {
    params: {
      workspaceId: string;
      threadId: string;
      text: string;
      model?: string | null;
      effort?: string | null;
      serviceTier?: ServiceTier | null;
      accessMode?: string | null;
      attachments?: ChatAttachment[] | null;
      images?: string[] | null;
      appMentions?: unknown[] | null;
      collaborationMode?: Record<string, unknown> | null;
    };
    result: Record<string, unknown>;
  };
  list_undo_checkpoints: {
    params: {
      workspaceId: string;
      threadId?: string | null;
      limit?: number | null;
    };
    result: { entries: UndoCheckpointSummary[] };
  };
  undo_checkpoint: {
    params: {
      workspaceId: string;
      checkpointId: string;
    };
    result: UndoCheckpointSummary;
  };
  turn_steer: {
    params: {
      workspaceId: string;
      threadId: string;
      turnId: string;
      text: string;
      attachments?: ChatAttachment[] | null;
      images?: string[] | null;
      appMentions?: unknown[] | null;
    };
    result: Record<string, unknown>;
  };
  turn_interrupt: {
    params: { workspaceId: string; threadId: string; turnId: string };
    result: Record<string, unknown>;
  };
  start_review: {
    params: {
      workspaceId: string;
      threadId: string;
      target: unknown;
      delivery?: "inline" | "detached" | string;
    };
    result: Record<string, unknown>;
  };
  respond_to_server_request: {
    params: {
      workspaceId: string;
      requestId: string | number;
      result: Record<string, unknown>;
    };
    result: { ok: true };
  };
  model_list: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  experimental_feature_list: {
    params: { workspaceId: string; cursor?: string | null; limit?: number | null };
    result: Record<string, unknown>;
  };
  collaboration_mode_list: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  account_rate_limits: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  account_read: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  codex_login: {
    params: { workspaceId: string };
    result: { loginId: string; authUrl: string; raw?: unknown };
  };
  codex_login_cancel: {
    params: { workspaceId: string };
    result: { canceled: boolean; status?: string; raw?: unknown };
  };
  skills_list: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  skills_remote_list: {
    params: { workspaceId: string; cursor?: string | null; limit?: number | null };
    result: Record<string, unknown>;
  };
  skills_remote_export: {
    params: { workspaceId: string; hazelnutId: string };
    result: Record<string, unknown>;
  };
  skills_set_enabled: {
    params: { workspaceId: string; path: string; enabled: boolean };
    result: Record<string, unknown>;
  };
  apps_list: {
    params: {
      workspaceId: string;
      cursor?: string | null;
      limit?: number | null;
      threadId?: string | null;
    };
    result: Record<string, unknown>;
  };
  remember_approval_rule: {
    params: { workspaceId: string; command: string[] };
    result: { ok: true; rulesPath: string };
  };
  get_git_status: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  get_git_diffs: {
    params: { workspaceId: string };
    result: Record<string, unknown>[];
  };
  get_git_log: {
    params: { workspaceId: string; limit?: number | null };
    result: Record<string, unknown>;
  };
  get_git_remote: {
    params: { workspaceId: string };
    result: string | null;
  };
  stage_git_file: {
    params: { workspaceId: string; path: string };
    result: { ok: true };
  };
  stage_git_all: {
    params: { workspaceId: string };
    result: { ok: true };
  };
  unstage_git_file: {
    params: { workspaceId: string; path: string };
    result: { ok: true };
  };
  revert_git_file: {
    params: { workspaceId: string; path: string };
    result: { ok: true };
  };
  revert_git_all: {
    params: { workspaceId: string };
    result: { ok: true };
  };
  commit_git: {
    params: { workspaceId: string; message: string };
    result: { ok: true };
  };
  push_git: {
    params: { workspaceId: string };
    result: { ok: true };
  };
  pull_git: {
    params: { workspaceId: string };
    result: { ok: true };
  };
  fetch_git: {
    params: { workspaceId: string };
    result: { ok: true };
  };
  sync_git: {
    params: { workspaceId: string };
    result: { ok: true };
  };
  list_git_branches: {
    params: { workspaceId: string };
    result: Record<string, unknown>;
  };
  checkout_git_branch: {
    params: { workspaceId: string; name: string };
    result: { ok: true };
  };
  create_git_branch: {
    params: { workspaceId: string; name: string };
    result: { ok: true };
  };
  local_usage_snapshot: {
    params: {
      days?: number | null;
      workspacePath?: string | null;
      countingMode?: LocalUsageCountingMode | null;
    };
    result: LocalUsageSnapshot;
  };
  local_usage_cost_snapshot: {
    params: {
      days?: number | null;
      workspacePath?: string | null;
      countingMode?: LocalUsageCountingMode | null;
    };
    result: LocalUsageCostSnapshot;
  };
  litellm_pricing_lookup: {
    params: { model: string };
    result: LiteLLMPricingLookup;
  };
  list_workspace_files: {
    params: { workspaceId: string };
    result: string[];
  };
  read_workspace_file: {
    params: { workspaceId: string; path: string };
    result: { content: string; truncated: boolean };
  };
  file_read: {
    params: {
      scope: "workspace" | "global";
      kind: "agents" | "config";
      workspaceId?: string;
    };
    result: TextFileResponse;
  };
  file_write: {
    params: {
      scope: "workspace" | "global";
      kind: "agents" | "config";
      workspaceId?: string;
      content: string;
    };
    result: { ok: true };
  };
  get_agents_settings: {
    params: Record<string, never>;
    result: AgentsSettings;
  };
  set_agents_core_settings: {
    params: { input: SetAgentsCoreInput };
    result: AgentsSettings;
  };
  create_agent: {
    params: { input: CreateAgentInput };
    result: AgentsSettings;
  };
  update_agent: {
    params: { input: UpdateAgentInput };
    result: AgentsSettings;
  };
  delete_agent: {
    params: { input: DeleteAgentInput };
    result: AgentsSettings;
  };
  read_agent_config_toml: {
    params: { agentName: string };
    result: string;
  };
  write_agent_config_toml: {
    params: { agentName: string; content: string };
    result: { ok: true };
  };
  get_config_model: {
    params: { workspaceId: string };
    result: { model: string | null };
  };
  prompts_list: {
    params: { workspaceId: string };
    result: PromptEntry[];
  };
  prompts_workspace_dir: {
    params: { workspaceId: string };
    result: string;
  };
  prompts_global_dir: {
    params: { workspaceId: string };
    result: string;
  };
  prompts_create: {
    params: {
      workspaceId: string;
      scope: PromptScope;
      name: string;
      description?: string | null;
      argumentHint?: string | null;
      content: string;
    };
    result: PromptEntry;
  };
  prompts_update: {
    params: {
      workspaceId: string;
      path: string;
      name: string;
      description?: string | null;
      argumentHint?: string | null;
      content: string;
    };
    result: PromptEntry;
  };
  prompts_delete: {
    params: { workspaceId: string; path: string };
    result: { ok: true };
  };
  prompts_move: {
    params: { workspaceId: string; path: string; scope: PromptScope };
    result: PromptEntry;
  };
  terminal_open: {
    params: { workspaceId: string; terminalId: string; cols: number; rows: number };
    result: { id: string; mode: "pty" | "pipe" };
  };
  terminal_write: {
    params: { workspaceId: string; terminalId: string; data: string };
    result: { ok: true };
  };
  terminal_resize: {
    params: { workspaceId: string; terminalId: string; cols: number; rows: number };
    result: { ok: true };
  };
  terminal_close: {
    params: { workspaceId: string; terminalId: string };
    result: { ok: true };
  };
  get_app_settings: {
    params: Record<string, never>;
    result: Record<string, unknown>;
  };
  update_app_settings: {
    params: { settings: Record<string, unknown> };
    result: Record<string, unknown>;
  };
};

export type RpcMethod = keyof RpcMethodMap;

export type SseEventMap = {
  "app-server-event": AppServerEvent;
  "terminal-output": TerminalOutputEvent;
  "terminal-exit": TerminalExitEvent;
  "dictation-event": DictationEvent;
  "dictation-download": DictationDownloadEvent;
  "server-heartbeat": { now: number };
};
