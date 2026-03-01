import type { EventBus } from "../events/eventBus.js";
import type { WorkspaceEntry } from "../types/domain.js";
import { CodexSession } from "./codexSession.js";

type AccessMode = "read-only" | "current" | "full-access";
type ApprovalPolicy = "untrusted" | "on-request" | "never";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type SandboxPolicy =
  | { type: "readOnly" }
  | { type: "workspaceWrite" }
  | { type: "dangerFullAccess" };

function resolveAccessPolicies(accessMode: string | null | undefined): {
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxMode;
  sandboxPolicy: SandboxPolicy;
} {
  const normalized = accessMode as AccessMode | null | undefined;
  switch (normalized) {
    case "read-only":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly" },
      };
    case "full-access":
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
    case "current":
    default:
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: { type: "workspaceWrite" },
      };
  }
}

function buildTurnInputItems(
  text: string,
  images?: string[] | null,
  appMentions?: unknown[] | null,
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  const trimmed = text.trim();
  if (trimmed) {
    input.push({ type: "text", text: trimmed });
  }
  for (const image of images ?? []) {
    if (!image.trim()) {
      continue;
    }
    if (image.startsWith("data:") || image.startsWith("http://") || image.startsWith("https://")) {
      input.push({ type: "image", url: image });
    } else {
      input.push({ type: "localImage", path: image });
    }
  }
  if (appMentions && appMentions.length > 0) {
    input.push({
      type: "app_mentions",
      mentions: appMentions,
    });
  }
  return input;
}

function extractThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record.threadId ?? record.thread_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const thread = record.thread as Record<string, unknown> | undefined;
  if (thread && typeof thread.id === "string" && thread.id.trim()) {
    return thread.id;
  }
  const params = record.params as Record<string, unknown> | undefined;
  if (params) {
    return extractThreadId(params);
  }
  return null;
}

function extractTurnErrorMessage(message: Record<string, unknown>): string {
  const params =
    message.params && typeof message.params === "object"
      ? (message.params as Record<string, unknown>)
      : null;
  if (!params) {
    return "Unknown error during background prompt";
  }
  const rawError = params.error;
  if (typeof rawError === "string" && rawError.trim()) {
    return rawError;
  }
  if (rawError && typeof rawError === "object") {
    const nested = (rawError as Record<string, unknown>).message;
    if (typeof nested === "string" && nested.trim()) {
      return nested;
    }
  }
  return "Unknown error during background prompt";
}

export class SessionManager {
  private sessions = new Map<string, CodexSession>();
  private loginIds = new Map<string, string>();

  constructor(private readonly eventBus: EventBus, private readonly codexBin: string) {}

  connectedWorkspaceIds(): Set<string> {
    return new Set(this.sessions.keys());
  }

  async connect(workspace: WorkspaceEntry): Promise<void> {
    if (this.sessions.has(workspace.id)) {
      return;
    }
    const session = new CodexSession(workspace, this.codexBin, this.eventBus);
    await session.initialize();
    this.sessions.set(workspace.id, session);
  }

  disconnect(workspaceId: string): void {
    const session = this.sessions.get(workspaceId);
    if (session) {
      session.close();
      this.sessions.delete(workspaceId);
    }
    this.loginIds.delete(workspaceId);
  }

  async startThread(
    workspace: WorkspaceEntry,
    options?: { accessMode?: string | null },
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    const policies = resolveAccessPolicies(options?.accessMode);
    return session.sendRequest(workspace.id, "thread/start", {
      cwd: workspace.path,
      approvalPolicy: policies.approvalPolicy,
      sandbox: policies.sandbox,
    });
  }

  async listThreads(
    workspace: WorkspaceEntry,
    cursor?: string | null,
    limit?: number | null,
    sortKey?: string | null,
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/list", {
      cursor: cursor ?? null,
      limit: limit ?? null,
      sortKey: sortKey ?? null,
      sourceKinds: [
        "cli",
        "vscode",
        "appServer",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "unknown",
      ],
    });
  }

  async resumeThread(workspace: WorkspaceEntry, threadId: string): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/resume", { threadId });
  }

  async forkThread(workspace: WorkspaceEntry, threadId: string): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/fork", { threadId });
  }

  async compactThread(workspace: WorkspaceEntry, threadId: string): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/compact/start", { threadId });
  }

  async archiveThread(workspace: WorkspaceEntry, threadId: string): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/archive", { threadId });
  }

  async setThreadName(
    workspace: WorkspaceEntry,
    threadId: string,
    name: string,
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/name/set", { threadId, name });
  }

  async threadLiveSubscribe(workspace: WorkspaceEntry, threadId: string): Promise<unknown> {
    await this.ensureSession(workspace);
    this.eventBus.publish("app-server-event", {
      workspace_id: workspace.id,
      message: {
        method: "thread/live_attached",
        params: {
          workspaceId: workspace.id,
          threadId,
          subscriptionId: `${workspace.id}:${threadId}`,
        },
      },
    });
    return {
      subscriptionId: `${workspace.id}:${threadId}`,
      state: "live",
    };
  }

  async threadLiveUnsubscribe(workspace: WorkspaceEntry, threadId: string): Promise<unknown> {
    await this.ensureSession(workspace);
    this.eventBus.publish("app-server-event", {
      workspace_id: workspace.id,
      message: {
        method: "thread/live_detached",
        params: {
          workspaceId: workspace.id,
          threadId,
          reason: "manual",
        },
      },
    });
    return { ok: true };
  }

  async listMcpServerStatus(
    workspace: WorkspaceEntry,
    cursor?: string | null,
    limit?: number | null,
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "mcpServerStatus/list", {
      cursor: cursor ?? null,
      limit: limit ?? null,
    });
  }

  async sendUserMessage(
    workspace: WorkspaceEntry,
    params: {
      threadId: string;
      text: string;
      model?: string | null;
      effort?: string | null;
      accessMode?: string | null;
      images?: string[] | null;
      appMentions?: unknown[] | null;
      collaborationMode?: Record<string, unknown> | null;
    },
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    const input = buildTurnInputItems(params.text, params.images, params.appMentions);
    const policies = resolveAccessPolicies(params.accessMode);

    const request: Record<string, unknown> = {
      threadId: params.threadId,
      input,
      model: params.model ?? null,
      effort: params.effort ?? null,
      approvalPolicy: policies.approvalPolicy,
      sandboxPolicy: policies.sandboxPolicy,
      includePlanTool: true,
      includeApplyPatchTool: true,
      includeViewImageTool: true,
    };
    if (params.collaborationMode) {
      request.collaborationMode = params.collaborationMode;
    }

    return session.sendRequest(workspace.id, "turn/start", request);
  }

  async steerTurn(
    workspace: WorkspaceEntry,
    params: {
      threadId: string;
      turnId: string;
      text: string;
      images?: string[] | null;
      appMentions?: unknown[] | null;
    },
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    const input = buildTurnInputItems(params.text, params.images, params.appMentions);
    return session.sendRequest(workspace.id, "turn/steer", {
      threadId: params.threadId,
      turnId: params.turnId,
      input,
    });
  }

  async interruptTurn(
    workspace: WorkspaceEntry,
    params: { threadId: string; turnId: string },
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "turn/interrupt", {
      threadId: params.threadId,
      turnId: params.turnId,
    });
  }

  async respondToServerRequest(
    workspace: WorkspaceEntry,
    requestId: string | number,
    result: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.ensureSession(workspace);
    await session.sendResponse(requestId, result);
  }

  async startReview(
    workspace: WorkspaceEntry,
    threadId: string,
    target: unknown,
    delivery?: string | null,
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "review/start", {
      threadId,
      target,
      delivery: delivery ?? "inline",
    });
  }

  async codexLogin(workspace: WorkspaceEntry): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    const raw = await session.sendRequest(workspace.id, "account/login/start", {
      type: "chatgpt",
    });
    const payload = (raw ?? {}) as Record<string, unknown>;
    const loginId =
      typeof payload.loginId === "string"
        ? payload.loginId
        : typeof payload.login_id === "string"
          ? payload.login_id
          : "";
    const authUrl =
      typeof payload.authUrl === "string"
        ? payload.authUrl
        : typeof payload.auth_url === "string"
          ? payload.auth_url
          : "";

    if (!loginId || !authUrl) {
      throw new Error("missing loginId/authUrl in account/login/start response");
    }
    this.loginIds.set(workspace.id, loginId);

    return {
      loginId,
      authUrl,
      raw,
    };
  }

  async codexLoginCancel(workspace: WorkspaceEntry): Promise<unknown> {
    const loginId = this.loginIds.get(workspace.id);
    if (!loginId) {
      return { canceled: false };
    }
    const session = await this.ensureSession(workspace);
    const raw = await session.sendRequest(workspace.id, "account/login/cancel", { loginId });
    const payload = (raw ?? {}) as Record<string, unknown>;
    const status =
      typeof payload.status === "string" && payload.status.trim() ? payload.status : undefined;
    const canceled =
      typeof payload.canceled === "boolean"
        ? payload.canceled
        : (status ?? "").toLowerCase() === "canceled";
    this.loginIds.delete(workspace.id);

    return {
      canceled,
      status,
      raw,
    };
  }

  async callSessionMethod(
    workspace: WorkspaceEntry,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, method, params);
  }

  async runBackgroundPrompt(
    workspace: WorkspaceEntry,
    prompt: string,
    options?: { model?: string | null; timeoutMs?: number },
  ): Promise<string> {
    const session = await this.ensureSession(workspace);
    const threadStart = await session.sendRequest(workspace.id, "thread/start", {
      cwd: workspace.path,
      approvalPolicy: "never",
    });
    const threadId = extractThreadId(threadStart);
    if (!threadId) {
      throw new Error("Failed to get threadId from thread/start response");
    }

    const responseChunks: string[] = [];
    let resolveDone: (() => void) | null = null;
    let rejectDone: ((error: Error) => void) | null = null;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const unlisten = session.subscribeThreadEvents(threadId, (message) => {
      const method = typeof message.method === "string" ? message.method : "";
      if (method === "item/agentMessage/delta") {
        const params =
          message.params && typeof message.params === "object"
            ? (message.params as Record<string, unknown>)
            : null;
        const delta = params?.delta;
        if (typeof delta === "string" && delta.length > 0) {
          responseChunks.push(delta);
        }
        return;
      }
      if (method === "turn/error") {
        rejectDone?.(new Error(extractTurnErrorMessage(message)));
        return;
      }
      if (method === "turn/completed") {
        resolveDone?.();
      }
    });

    try {
      const turnParams: Record<string, unknown> = {
        threadId,
        input: [{ type: "text", text: prompt }],
        cwd: workspace.path,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
      };
      const model = options?.model?.trim();
      if (model) {
        turnParams.model = model;
      }
      await session.sendRequest(workspace.id, "turn/start", turnParams);

      const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 60_000);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Timeout waiting for commit message generation"));
        }, timeoutMs);
        done
          .then(() => {
            clearTimeout(timer);
            resolve();
          })
          .catch((error) => {
            clearTimeout(timer);
            reject(error);
          });
      });
    } finally {
      unlisten();
      await session
        .sendRequest(workspace.id, "thread/archive", { threadId })
        .catch(() => undefined);
    }

    const response = responseChunks.join("").trim();
    if (!response) {
      throw new Error("No response was generated");
    }
    return response;
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    this.loginIds.clear();
  }

  private async ensureSession(workspace: WorkspaceEntry): Promise<CodexSession> {
    let session = this.sessions.get(workspace.id);
    if (!session) {
      await this.connect(workspace);
      session = this.sessions.get(workspace.id);
    }
    if (!session) {
      throw new Error(`Failed to connect workspace session: ${workspace.id}`);
    }
    return session;
  }
}
