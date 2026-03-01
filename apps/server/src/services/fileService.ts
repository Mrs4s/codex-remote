import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceEntry } from "../types/domain.js";

const MAX_FILE_BYTES = 400_000;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "target", "release-artifacts"]);

export async function listWorkspaceFiles(workspace: WorkspaceEntry): Promise<string[]> {
  const root = path.resolve(workspace.path);
  const output: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (!rel) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(full);
        }
        continue;
      }
      if (entry.isFile()) {
        output.push(rel);
      }
    }
  }

  await walk(root);
  output.sort();
  return output.slice(0, 20000);
}

export async function readWorkspaceFile(
  workspace: WorkspaceEntry,
  relativePath: string,
): Promise<{ content: string; truncated: boolean }> {
  const root = await fs.realpath(workspace.path);
  const candidate = path.resolve(root, relativePath);
  const resolved = await fs.realpath(candidate);
  if (!resolved.startsWith(root)) {
    throw new Error("Invalid file path");
  }

  const fd = await fs.open(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    const truncated = bytesRead > MAX_FILE_BYTES;
    const content = buffer.subarray(0, truncated ? MAX_FILE_BYTES : bytesRead).toString("utf8");
    return { content, truncated };
  } finally {
    await fd.close();
  }
}
