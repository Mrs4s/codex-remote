import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { WorkspaceEntry } from "../types/domain.js";

export type FileScope = "workspace" | "global";
export type FileKind = "agents" | "config";

export type TextFileResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
};

const MAX_TEXT_FILE_BYTES = 400_000;

function codexHomeDir(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".codex");
}

function resolveFilePath(
  scope: FileScope,
  kind: FileKind,
  workspace?: WorkspaceEntry,
): string {
  if (scope === "workspace") {
    if (!workspace) {
      throw new Error("workspaceId is required for workspace file scope");
    }
    if (kind === "agents") {
      return path.join(workspace.path, "AGENTS.md");
    }
    return path.join(workspace.path, ".codex", "config.toml");
  }

  if (kind === "agents") {
    return path.join(codexHomeDir(), "AGENTS.md");
  }
  return path.join(codexHomeDir(), "config.toml");
}

export async function fileRead(
  scope: FileScope,
  kind: FileKind,
  workspace?: WorkspaceEntry,
): Promise<TextFileResponse> {
  const target = resolveFilePath(scope, kind, workspace);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) {
    return {
      exists: false,
      content: "",
      truncated: false,
    };
  }

  const fd = await fs.open(target, "r");
  try {
    const buffer = Buffer.alloc(MAX_TEXT_FILE_BYTES + 1);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    const truncated = bytesRead > MAX_TEXT_FILE_BYTES;
    return {
      exists: true,
      content: buffer.subarray(0, truncated ? MAX_TEXT_FILE_BYTES : bytesRead).toString("utf8"),
      truncated,
    };
  } finally {
    await fd.close();
  }
}

export async function fileWrite(
  scope: FileScope,
  kind: FileKind,
  content: string,
  workspace?: WorkspaceEntry,
): Promise<void> {
  const target = resolveFilePath(scope, kind, workspace);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

