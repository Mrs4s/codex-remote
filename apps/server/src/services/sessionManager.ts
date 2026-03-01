import type { EventBus } from "../events/eventBus.js";
import type { WorkspaceEntry } from "../types/domain.js";
import { CodexSession } from "./codexSession.js";

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

  async startThread(workspace: WorkspaceEntry): Promise<unknown> {
    const session = await this.ensureSession(workspace);
    return session.sendRequest(workspace.id, "thread/start", {
      cwd: workspace.path,
      approvalPolicy: "on-request",
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

    const request: Record<string, unknown> = {
      threadId: params.threadId,
      input,
      model: params.model ?? null,
      effort: params.effort ?? null,
      accessMode: params.accessMode ?? null,
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
