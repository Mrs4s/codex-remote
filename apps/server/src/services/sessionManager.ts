import type { EventBus } from "../events/eventBus.js";
import type { WorkspaceEntry } from "../types/domain.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodexSession } from "./codexSession.js";
import type { UndoCheckpointService } from "./undoCheckpointService.js";

const execFileAsync = promisify(execFile);
const MAX_EXEC_BUFFER_BYTES = 10 * 1024 * 1024;

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

function extractTurnId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record.turnId ?? record.turn_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const turn = record.turn as Record<string, unknown> | undefined;
  if (turn && typeof turn.id === "string" && turn.id.trim()) {
    return turn.id;
  }
  const params = record.params as Record<string, unknown> | undefined;
  if (params) {
    return extractTurnId(params);
  }
  const result = record.result as Record<string, unknown> | undefined;
  if (result) {
    return extractTurnId(result);
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
  const fallbackMessage = params.message;
  if (typeof fallbackMessage === "string" && fallbackMessage.trim()) {
    return fallbackMessage;
  }
  if (rawError && typeof rawError === "object") {
    const nested = (rawError as Record<string, unknown>).message;
    if (typeof nested === "string" && nested.trim()) {
      return nested;
    }
  }
  return "Unknown error during background prompt";
}

function normalizeTrackedPath(rawPath: string): string {
  let normalized = rawPath.trim().replace(/\\/g, "/");
  normalized = normalized.replace(/^\.\/+/, "");
  normalized = normalized.replace(/^a\//, "");
  normalized = normalized.replace(/^b\//, "");
  normalized = normalized.replace(/\/+/g, "/");
  return normalized;
}

type TurnFilePatch = {
  path: string;
  kind: string | null;
  diff: string;
};

type TurnUndoTracker = {
  key: string;
  checkpointIdPromise: Promise<string>;
  workspaceId: string;
  workspacePath: string;
  threadId: string;
  turnId: string;
  patches: TurnFilePatch[];
  baselineGitDirtyFilesPromise: Promise<Set<string> | null>;
  unlisten: () => void;
};

export class SessionManager {
  private sessions = new Map<string, CodexSession>();
  private loginIds = new Map<string, string>();
  private turnUndoTrackers = new Map<string, TurnUndoTracker>();
  private turnTrackerKeysByThread = new Map<string, Set<string>>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly codexBin: string,
    private readonly undoCheckpointService?: UndoCheckpointService,
  ) {}

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
    void this.finalizeWorkspaceTrackersFailed(workspaceId, "Workspace disconnected");
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

    const response = await session.sendRequest(workspace.id, "turn/start", request);
    const turnId = extractTurnId(response);
    if (turnId) {
      this.startUndoTrackingTurn(session, workspace, params.threadId, turnId);
    }
    return response;
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
    const workspaceIds = Array.from(this.sessions.keys());
    for (const workspaceId of workspaceIds) {
      await this.finalizeWorkspaceTrackersFailed(workspaceId, "Workspace session closed");
    }
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    this.loginIds.clear();
  }

  private startUndoTrackingTurn(
    session: CodexSession,
    workspace: WorkspaceEntry,
    threadId: string,
    turnId: string,
  ): void {
    if (!this.undoCheckpointService || !threadId || !turnId) {
      return;
    }

    const trackerKey = this.buildTrackerKey(workspace.id, threadId, turnId);
    if (this.turnUndoTrackers.has(trackerKey)) {
      this.finalizeTrackerFailed(trackerKey, "Checkpoint tracking restarted").catch(() => undefined);
    }

    const baselineGitDirtyFilesPromise = this.captureGitDirtyFiles(workspace.path);
    const checkpointIdPromise = this.undoCheckpointService
      .createCheckpoint({
        workspaceId: workspace.id,
        threadId,
        turnId,
      })
      .then((checkpoint) => checkpoint.id);
    checkpointIdPromise.catch(() => undefined);
    const patches: TurnFilePatch[] = [];
    const unlisten = session.subscribeThreadEvents(threadId, (message) => {
      this.onUndoTrackerEvent(trackerKey, message);
    });
    const tracker: TurnUndoTracker = {
      key: trackerKey,
      checkpointIdPromise,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      threadId,
      turnId,
      patches,
      baselineGitDirtyFilesPromise,
      unlisten,
    };
    this.turnUndoTrackers.set(trackerKey, tracker);
    this.addTrackerKeyForThread(workspace.id, threadId, trackerKey);
  }

  private onUndoTrackerEvent(trackerKey: string, message: Record<string, unknown>): void {
    const tracker = this.turnUndoTrackers.get(trackerKey);
    if (!tracker) {
      return;
    }
    const method = typeof message.method === "string" ? message.method : "";
    if (!method) {
      return;
    }
    const params =
      message.params && typeof message.params === "object"
        ? (message.params as Record<string, unknown>)
        : {};
    const eventThreadId = extractThreadId(params) ?? extractThreadId(message);
    if (eventThreadId && eventThreadId !== tracker.threadId) {
      return;
    }
    const eventTurnId = extractTurnId(params) ?? extractTurnId(message);
    if (eventTurnId && eventTurnId !== tracker.turnId) {
      return;
    }

    if (method === "item/completed") {
      const item =
        params.item && typeof params.item === "object"
          ? (params.item as Record<string, unknown>)
          : null;
      if (!item || String(item.type ?? "") !== "fileChange") {
        return;
      }
      const changes = Array.isArray(item.changes) ? item.changes : [];
      for (const change of changes) {
        if (!change || typeof change !== "object") {
          continue;
        }
        const changeRecord = change as Record<string, unknown>;
        const pathRaw = String(changeRecord.path ?? "").trim();
        const diffRaw = String(changeRecord.diff ?? "");
        if (!pathRaw || !diffRaw.trim()) {
          continue;
        }
        const kindRaw = changeRecord.kind;
        const kind =
          typeof kindRaw === "string"
            ? kindRaw.trim() || null
            : kindRaw && typeof kindRaw === "object"
              ? String((kindRaw as Record<string, unknown>).type ?? "").trim() || null
              : null;
        tracker.patches.push({
          path: pathRaw,
          kind,
          diff: diffRaw,
        });
      }
      return;
    }

    if (method === "turn/completed") {
      this.finalizeTrackerReady(trackerKey).catch(() => undefined);
      return;
    }

    if (method === "turn/error" || method === "error") {
      const failureMessage = extractTurnErrorMessage(message);
      this.finalizeTrackerFailed(trackerKey, failureMessage).catch(() => undefined);
      return;
    }

    if (method === "thread/closed" || method === "thread/archived") {
      this.finalizeTrackerFailed(trackerKey, "Thread closed before turn completed").catch(
        () => undefined,
      );
    }
  }

  private addTrackerKeyForThread(workspaceId: string, threadId: string, trackerKey: string): void {
    const threadKey = this.buildThreadKey(workspaceId, threadId);
    const existing = this.turnTrackerKeysByThread.get(threadKey) ?? new Set<string>();
    existing.add(trackerKey);
    this.turnTrackerKeysByThread.set(threadKey, existing);
  }

  private removeTrackerKeyForThread(workspaceId: string, threadId: string, trackerKey: string): void {
    const threadKey = this.buildThreadKey(workspaceId, threadId);
    const existing = this.turnTrackerKeysByThread.get(threadKey);
    if (!existing) {
      return;
    }
    existing.delete(trackerKey);
    if (existing.size === 0) {
      this.turnTrackerKeysByThread.delete(threadKey);
    }
  }

  private takeTracker(trackerKey: string): TurnUndoTracker | null {
    const tracker = this.turnUndoTrackers.get(trackerKey);
    if (!tracker) {
      return null;
    }
    this.turnUndoTrackers.delete(trackerKey);
    this.removeTrackerKeyForThread(tracker.workspaceId, tracker.threadId, trackerKey);
    tracker.unlisten();
    return tracker;
  }

  private async finalizeTrackerReady(trackerKey: string): Promise<void> {
    const tracker = this.takeTracker(trackerKey);
    if (!tracker || !this.undoCheckpointService) {
      return;
    }
    let checkpointId: string;
    try {
      checkpointId = await tracker.checkpointIdPromise;
    } catch {
      return;
    }
    const additionalChangedFiles = await this.detectOutOfBandChangedFiles({
      workspacePath: tracker.workspacePath,
      baselineGitDirtyFilesPromise: tracker.baselineGitDirtyFilesPromise,
      patchPaths: tracker.patches.map((patch) => patch.path),
    });
    await this.undoCheckpointService
      .finalizeCheckpointReady({
        checkpointId,
        workspacePath: tracker.workspacePath,
        patches: tracker.patches,
        additionalChangedFiles,
      })
      .catch(() => undefined);
  }

  private async finalizeTrackerFailed(trackerKey: string, failureMessage: string): Promise<void> {
    const tracker = this.takeTracker(trackerKey);
    if (!tracker || !this.undoCheckpointService) {
      return;
    }
    let checkpointId: string;
    try {
      checkpointId = await tracker.checkpointIdPromise;
    } catch {
      return;
    }
    await this.undoCheckpointService
      .finalizeCheckpointFailed(checkpointId, failureMessage)
      .catch(() => undefined);
  }

  private async finalizeWorkspaceTrackersFailed(
    workspaceId: string,
    failureMessage: string,
  ): Promise<void> {
    const trackerKeys: string[] = [];
    for (const [trackerKey, tracker] of this.turnUndoTrackers.entries()) {
      if (tracker.workspaceId === workspaceId) {
        trackerKeys.push(trackerKey);
      }
    }
    await Promise.all(
      trackerKeys.map((trackerKey) =>
        this.finalizeTrackerFailed(trackerKey, failureMessage).catch(() => undefined),
      ),
    );
  }

  private buildTrackerKey(workspaceId: string, threadId: string, turnId: string): string {
    return `${workspaceId}:${threadId}:${turnId}`;
  }

  private buildThreadKey(workspaceId: string, threadId: string): string {
    return `${workspaceId}:${threadId}`;
  }

  private async captureGitDirtyFiles(workspacePath: string): Promise<Set<string> | null> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        {
          cwd: workspacePath,
          env: process.env,
          maxBuffer: MAX_EXEC_BUFFER_BYTES,
        },
      );
      return this.parseGitStatusPaths(stdout);
    } catch {
      return null;
    }
  }

  private parseGitStatusPaths(output: string): Set<string> {
    const paths = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) {
        continue;
      }
      let pathPart = line.slice(3).trim();
      if (!pathPart) {
        continue;
      }
      if (pathPart.includes(" -> ")) {
        pathPart = pathPart.split(" -> ").pop() ?? pathPart;
      }
      if (pathPart.startsWith('"') && pathPart.endsWith('"') && pathPart.length > 1) {
        pathPart = pathPart.slice(1, -1);
      }
      const normalized = normalizeTrackedPath(pathPart);
      if (normalized) {
        paths.add(normalized);
      }
    }
    return paths;
  }

  private async detectOutOfBandChangedFiles(input: {
    workspacePath: string;
    baselineGitDirtyFilesPromise: Promise<Set<string> | null>;
    patchPaths: string[];
  }): Promise<string[]> {
    const baseline = await input.baselineGitDirtyFilesPromise.catch(() => null);
    if (!baseline) {
      return [];
    }
    const after = await this.captureGitDirtyFiles(input.workspacePath);
    if (!after) {
      return [];
    }
    const patchPathSet = new Set(
      input.patchPaths
        .map((filePath) => normalizeTrackedPath(filePath))
        .filter(Boolean),
    );
    const outOfBand: string[] = [];
    for (const currentPath of after.values()) {
      if (baseline.has(currentPath)) {
        continue;
      }
      if (patchPathSet.has(currentPath)) {
        continue;
      }
      outOfBand.push(currentPath);
    }
    outOfBand.sort((left, right) => left.localeCompare(right));
    return outOfBand;
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
