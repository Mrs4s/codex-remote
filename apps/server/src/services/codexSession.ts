import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { EventBus } from "../events/eventBus.js";
import type { WorkspaceEntry } from "../types/domain.js";

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

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
  const result = record.result as Record<string, unknown> | undefined;
  if (result) {
    return extractThreadId(result);
  }
  return null;
}

export class CodexSession {
  private process: ChildProcessWithoutNullStreams;

  private nextId = 1;
  private pending = new Map<number, PendingResolver>();
  private requestWorkspace = new Map<number, string>();
  private threadWorkspace = new Map<string, string>();
  private threadListeners = new Map<string, Set<(message: Record<string, unknown>) => void>>();

  constructor(
    private readonly workspace: WorkspaceEntry,
    private readonly codexBin: string,
    private readonly eventBus: EventBus,
  ) {
    this.process = spawn(this.codexBin, ["app-server"], {
      cwd: this.workspace.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.bindProcess();
  }

  async initialize(): Promise<void> {
    await this.sendRequest(this.workspace.id, "initialize", {
      clientInfo: {
        name: "codex-remote",
        title: "Codex Remote",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.sendNotification("initialized", undefined);
    this.eventBus.publish("app-server-event", {
      workspace_id: this.workspace.id,
      message: {
        method: "codex/connected",
        params: { workspaceId: this.workspace.id },
      },
    });
  }

  async sendRequest(workspaceId: string, method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = { id, method, params };
    const threadId = extractThreadId(params);
    if (threadId) {
      this.threadWorkspace.set(threadId, workspaceId);
    }

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.requestWorkspace.set(id, workspaceId);
    });

    this.writeLine(payload);
    return promise;
  }

  async sendNotification(method: string, params: unknown): Promise<void> {
    const payload = params === undefined ? { method } : { method, params };
    this.writeLine(payload);
  }

  async sendResponse(id: string | number, result: unknown): Promise<void> {
    this.writeLine({ id, result });
  }

  subscribeThreadEvents(
    threadId: string,
    listener: (message: Record<string, unknown>) => void,
  ): () => void {
    const current = this.threadListeners.get(threadId) ?? new Set();
    current.add(listener);
    this.threadListeners.set(threadId, current);

    return () => {
      const existing = this.threadListeners.get(threadId);
      if (!existing) {
        return;
      }
      existing.delete(listener);
      if (existing.size === 0) {
        this.threadListeners.delete(threadId);
      }
    };
  }

  close(): void {
    this.process.kill();
    for (const entry of this.pending.values()) {
      entry.reject(new Error("session closed"));
    }
    this.pending.clear();
    this.threadListeners.clear();
  }

  private writeLine(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    this.process.stdin.write(`${serialized}\n`);
  }

  private bindProcess(): void {
    const stdout = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });
    stdout.on("line", (line) => this.handleLine(line));

    const stderr = readline.createInterface({
      input: this.process.stderr,
      crlfDelay: Infinity,
    });
    stderr.on("line", (line) => {
      if (!line.trim()) {
        return;
      }
      this.eventBus.publish("app-server-event", {
        workspace_id: this.workspace.id,
        message: {
          method: "codex/stderr",
          params: { message: line },
        },
      });
    });

    this.process.on("exit", (code, signal) => {
      const message = `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
      for (const entry of this.pending.values()) {
        entry.reject(new Error(message));
      }
      this.pending.clear();
      this.eventBus.publish("app-server-event", {
        workspace_id: this.workspace.id,
        message: {
          method: "error",
          params: {
            threadId: "",
            turnId: "",
            message,
            willRetry: false,
          },
        },
      });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (error) {
      this.eventBus.publish("app-server-event", {
        workspace_id: this.workspace.id,
        message: {
          method: "codex/parseError",
          params: { raw: line, error: error instanceof Error ? error.message : String(error) },
        },
      });
      return;
    }

    const id = typeof parsed.id === "number" ? parsed.id : null;
    if (id !== null && this.pending.has(id)) {
      const resolver = this.pending.get(id);
      this.pending.delete(id);
      const workspaceId = this.requestWorkspace.get(id) ?? this.workspace.id;
      this.requestWorkspace.delete(id);

      const threadId = extractThreadId(parsed);
      if (threadId) {
        this.threadWorkspace.set(threadId, workspaceId);
      }

      if (parsed.error) {
        const message =
          (parsed.error as Record<string, unknown>).message as string | undefined;
        resolver?.reject(new Error(message || "codex request failed"));
        return;
      }
      resolver?.resolve(parsed.result ?? parsed);
      return;
    }

    const method = parsed.method;
    if (typeof method === "string" && method.trim()) {
      const threadId = extractThreadId(parsed.params ?? parsed);
      const routedWorkspace =
        (threadId ? this.threadWorkspace.get(threadId) : null) ?? this.workspace.id;

      if (threadId) {
        this.threadWorkspace.set(threadId, routedWorkspace);
        const listeners = this.threadListeners.get(threadId);
        if (listeners && listeners.size > 0) {
          for (const listener of listeners) {
            try {
              listener(parsed);
            } catch {
              // Ignore listener failures to avoid breaking event routing.
            }
          }
        }
      }

      this.eventBus.publish("app-server-event", {
        workspace_id: routedWorkspace,
        message: parsed,
      });
    }
  }
}
