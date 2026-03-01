import os from "node:os";
import pty from "node-pty";
import type { EventBus } from "../events/eventBus.js";
import type { WorkspaceEntry } from "../types/domain.js";

type SessionRecord = {
  workspaceId: string;
  terminalId: string;
  pty: pty.IPty;
};

function key(workspaceId: string, terminalId: string): string {
  return `${workspaceId}:${terminalId}`;
}

function shellExecutable(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

function shellArgs(): string[] {
  if (process.platform === "win32") {
    return [];
  }
  return ["-i"];
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

    const term = pty.spawn(shellExecutable(), shellArgs(), {
      name: "xterm-256color",
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd: workspace.path,
      env: {
        ...process.env,
        LANG: process.env.LANG || "en_US.UTF-8",
        LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      },
    });

    term.onData((data) => {
      this.eventBus.publish("terminal-output", {
        workspaceId: workspace.id,
        terminalId,
        data,
      });
    });

    term.onExit(() => {
      this.sessions.delete(sessionKey);
      this.eventBus.publish("terminal-exit", {
        workspaceId: workspace.id,
        terminalId,
      });
    });

    this.sessions.set(sessionKey, {
      workspaceId: workspace.id,
      terminalId,
      pty: term,
    });

    return { id: terminalId };
  }

  write(workspaceId: string, terminalId: string, data: string): void {
    const session = this.mustGet(workspaceId, terminalId);
    session.pty.write(data);
  }

  resize(workspaceId: string, terminalId: string, cols: number, rows: number): void {
    const session = this.mustGet(workspaceId, terminalId);
    session.pty.resize(Math.max(2, cols), Math.max(2, rows));
  }

  close(workspaceId: string, terminalId: string): void {
    const sessionKey = key(workspaceId, terminalId);
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionKey);
    session.pty.kill();
    this.eventBus.publish("terminal-exit", {
      workspaceId,
      terminalId,
    });
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill();
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
}
