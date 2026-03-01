import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import pty from "node-pty";
import type { EventBus } from "../events/eventBus.js";
import type { WorkspaceEntry } from "../types/domain.js";

type TerminalTransport = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (handler: (data: string) => void) => void;
  onExit: (handler: () => void) => void;
};

type SessionRecord = {
  workspaceId: string;
  terminalId: string;
  transport: TerminalTransport;
  closed: boolean;
};

function key(workspaceId: string, terminalId: string): string {
  return `${workspaceId}:${terminalId}`;
}

function shellCandidates(): string[] {
  if (process.platform === "win32") {
    return [process.env.COMSPEC || "powershell.exe", "cmd.exe", "powershell.exe"];
  }

  const defaults = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of defaults) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    candidates.push(trimmed);
  }
  return candidates;
}

function shellArgs(): string[] {
  if (process.platform === "win32") {
    return [];
  }
  return ["-i"];
}

function shellEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
  };
}

function createPtyTransport(
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
): TerminalTransport {
  const term = pty.spawn(shell, shellArgs(), {
    name: "xterm-256color",
    cols: Math.max(2, cols),
    rows: Math.max(2, rows),
    cwd,
    env: shellEnv(),
  });

  return {
    write: (data) => term.write(data),
    resize: (nextCols, nextRows) => term.resize(Math.max(2, nextCols), Math.max(2, nextRows)),
    kill: () => term.kill(),
    onData: (handler) => {
      term.onData(handler);
    },
    onExit: (handler) => {
      term.onExit(() => {
        handler();
      });
    },
  };
}

function createPipeTransport(
  shell: string,
  cwd: string,
): TerminalTransport {
  const child: ChildProcessWithoutNullStreams = spawn(shell, shellArgs(), {
    cwd,
    env: shellEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!child.pid) {
    throw new Error("spawn returned no pid");
  }

  return {
    write: (data) => {
      const normalized = data.replaceAll("\r", "\n");
      child.stdin.write(normalized);
    },
    resize: () => {
      // No-op: plain stdio mode has no PTY resize support.
    },
    kill: () => {
      if (child.killed) {
        return;
      }
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 200).unref();
    },
    onData: (handler) => {
      child.stdout.on("data", (chunk) => {
        handler(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        handler(String(chunk));
      });
    },
    onExit: (handler) => {
      child.once("exit", () => {
        handler();
      });
      child.once("error", () => {
        handler();
      });
    },
  };
}

export class TerminalService {
  private sessions = new Map<string, SessionRecord>();

  constructor(private readonly eventBus: EventBus) {}

  open(workspace: WorkspaceEntry, terminalId: string, cols: number, rows: number): { id: string } {
    const sessionKey = key(workspace.id, terminalId);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return { id: existing.terminalId };
    }

    if (!fs.existsSync(workspace.path)) {
      throw new Error(`Workspace path does not exist: ${workspace.path}`);
    }

    const transport = this.createTransport(workspace, cols, rows);
    const record: SessionRecord = {
      workspaceId: workspace.id,
      terminalId,
      transport,
      closed: false,
    };

    transport.onData((data) => {
      this.eventBus.publish("terminal-output", {
        workspaceId: workspace.id,
        terminalId,
        data,
      });
    });

    transport.onExit(() => {
      this.finalizeSession(sessionKey);
    });

    this.sessions.set(sessionKey, record);
    return { id: terminalId };
  }

  write(workspaceId: string, terminalId: string, data: string): void {
    const session = this.mustGet(workspaceId, terminalId);
    session.transport.write(data);
  }

  resize(workspaceId: string, terminalId: string, cols: number, rows: number): void {
    const session = this.mustGet(workspaceId, terminalId);
    session.transport.resize(cols, rows);
  }

  close(workspaceId: string, terminalId: string): void {
    const sessionKey = key(workspaceId, terminalId);
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }
    session.closed = true;
    this.sessions.delete(sessionKey);
    try {
      session.transport.kill();
    } finally {
      this.eventBus.publish("terminal-exit", {
        workspaceId,
        terminalId,
      });
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.closed = true;
      session.transport.kill();
    }
    this.sessions.clear();
  }

  private mustGet(workspaceId: string, terminalId: string): SessionRecord {
    const session = this.sessions.get(key(workspaceId, terminalId));
    if (!session) {
      throw new Error("Terminal session not found");
    }
    return session;
  }

  private finalizeSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (!session || session.closed) {
      return;
    }
    session.closed = true;
    this.sessions.delete(sessionKey);
    this.eventBus.publish("terminal-exit", {
      workspaceId: session.workspaceId,
      terminalId: session.terminalId,
    });
  }

  private createTransport(
    workspace: WorkspaceEntry,
    cols: number,
    rows: number,
  ): TerminalTransport {
    const candidates = shellCandidates();
    const ptyErrors: string[] = [];

    for (const shell of candidates) {
      try {
        return createPtyTransport(shell, workspace.path, cols, rows);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ptyErrors.push(`${shell}: ${message}`);
      }
    }

    const pipeErrors: string[] = [];
    for (const shell of candidates) {
      try {
        return createPipeTransport(shell, workspace.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pipeErrors.push(`${shell}: ${message}`);
      }
    }

    const details = [
      `Unable to start terminal in ${workspace.path}`,
      `PTY errors: ${ptyErrors.join(" | ") || "none"}`,
      `Pipe errors: ${pipeErrors.join(" | ") || "none"}`,
    ].join("; ");

    throw new Error(details);
  }
}
