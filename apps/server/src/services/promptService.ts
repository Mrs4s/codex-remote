import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceEntry } from "../types/domain.js";

export type PromptScope = "workspace" | "global";

export type PromptEntry = {
  path: string;
  scope: PromptScope;
  name: string;
  description: string | null;
  argumentHint: string | null;
  content: string;
};

type PromptMeta = {
  name: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
};

function normalizePromptName(name: string): string {
  return name.trim().replace(/[^\w.-]/g, "-");
}

function promptFrontmatter(meta: {
  name: string;
  description?: string | null;
  argumentHint?: string | null;
}): string {
  return [
    "---",
    `name: ${meta.name}`,
    `description: ${meta.description ?? ""}`,
    `argumentHint: ${meta.argumentHint ?? ""}`,
    "---",
  ].join("\n");
}

function parsePromptFile(input: string): PromptMeta {
  const raw = input.replace(/\r\n/g, "\n");
  if (!raw.startsWith("---\n")) {
    const trimmed = raw.trim();
    const guessedName = trimmed.split("\n")[0]?.trim().slice(0, 60) || "prompt";
    return {
      name: guessedName,
      description: null,
      argumentHint: null,
      body: raw,
    };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) {
    return {
      name: "prompt",
      description: null,
      argumentHint: null,
      body: raw,
    };
  }
  const metaBlock = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const map = new Map<string, string>();
  for (const line of metaBlock.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    map.set(key, value);
  }
  return {
    name: map.get("name") || "prompt",
    description: map.get("description") || null,
    argumentHint: map.get("argumentHint") || null,
    body,
  };
}

async function readPromptEntry(scope: PromptScope, absolutePath: string): Promise<PromptEntry> {
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = parsePromptFile(raw);
  return {
    path: absolutePath,
    scope,
    name: parsed.name,
    description: parsed.description,
    argumentHint: parsed.argumentHint,
    content: parsed.body,
  };
}

export class PromptService {
  constructor(private readonly dataDir: string) {}

  workspaceDir(workspace: WorkspaceEntry): string {
    return path.join(this.dataDir, "workspaces", workspace.id, "prompts");
  }

  globalDir(): string {
    return path.join(this.dataDir, "prompts");
  }

  resolveScopeDir(scope: PromptScope, workspace: WorkspaceEntry): string {
    return scope === "global" ? this.globalDir() : this.workspaceDir(workspace);
  }

  async list(workspace: WorkspaceEntry): Promise<PromptEntry[]> {
    const dirs: Array<{ scope: PromptScope; dir: string }> = [
      { scope: "workspace", dir: this.workspaceDir(workspace) },
      { scope: "global", dir: this.globalDir() },
    ];

    const output: PromptEntry[] = [];
    for (const item of dirs) {
      await fs.mkdir(item.dir, { recursive: true });
      const entries = await fs.readdir(item.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }
        const absolutePath = path.join(item.dir, entry.name);
        output.push(await readPromptEntry(item.scope, absolutePath));
      }
    }

    output.sort((a, b) => a.name.localeCompare(b.name));
    return output;
  }

  async create(
    workspace: WorkspaceEntry,
    input: {
      scope: PromptScope;
      name: string;
      description?: string | null;
      argumentHint?: string | null;
      content: string;
    },
  ): Promise<PromptEntry> {
    const dir = this.resolveScopeDir(input.scope, workspace);
    await fs.mkdir(dir, { recursive: true });
    const safeName = normalizePromptName(input.name);
    if (!safeName) {
      throw new Error("Prompt name is required");
    }
    const targetPath = path.join(dir, `${safeName}.md`);
    const exists = await fs.stat(targetPath).then(() => true).catch(() => false);
    if (exists) {
      throw new Error(`Prompt already exists: ${safeName}`);
    }
    const body = `${promptFrontmatter(input)}\n${input.content ?? ""}\n`;
    await fs.writeFile(targetPath, body, "utf8");
    return readPromptEntry(input.scope, targetPath);
  }

  async update(
    workspace: WorkspaceEntry,
    input: {
      path: string;
      name: string;
      description?: string | null;
      argumentHint?: string | null;
      content: string;
    },
  ): Promise<PromptEntry> {
    const absolutePath = path.resolve(input.path);
    const scope = this.scopeForPath(workspace, absolutePath);
    if (!scope) {
      throw new Error("Prompt path is outside allowed prompt directories");
    }
    const safeName = normalizePromptName(input.name);
    if (!safeName) {
      throw new Error("Prompt name is required");
    }
    const dir = path.dirname(absolutePath);
    const nextPath = path.join(dir, `${safeName}.md`);
    const body = `${promptFrontmatter(input)}\n${input.content ?? ""}\n`;
    await fs.writeFile(nextPath, body, "utf8");
    if (nextPath !== absolutePath) {
      await fs.unlink(absolutePath).catch(() => undefined);
    }
    return readPromptEntry(scope, nextPath);
  }

  async remove(workspace: WorkspaceEntry, promptPath: string): Promise<void> {
    const absolutePath = path.resolve(promptPath);
    const scope = this.scopeForPath(workspace, absolutePath);
    if (!scope) {
      throw new Error("Prompt path is outside allowed prompt directories");
    }
    await fs.unlink(absolutePath);
  }

  async move(
    workspace: WorkspaceEntry,
    promptPath: string,
    scope: PromptScope,
  ): Promise<PromptEntry> {
    const absolutePath = path.resolve(promptPath);
    const currentScope = this.scopeForPath(workspace, absolutePath);
    if (!currentScope) {
      throw new Error("Prompt path is outside allowed prompt directories");
    }
    if (currentScope === scope) {
      return readPromptEntry(scope, absolutePath);
    }
    const targetDir = this.resolveScopeDir(scope, workspace);
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(absolutePath));
    await fs.rename(absolutePath, targetPath);
    return readPromptEntry(scope, targetPath);
  }

  private scopeForPath(workspace: WorkspaceEntry, absolutePath: string): PromptScope | null {
    const workspaceRoot = path.resolve(this.workspaceDir(workspace));
    const globalRoot = path.resolve(this.globalDir());
    const resolved = path.resolve(absolutePath);
    if (resolved.startsWith(`${workspaceRoot}${path.sep}`) || resolved === workspaceRoot) {
      return "workspace";
    }
    if (resolved.startsWith(`${globalRoot}${path.sep}`) || resolved === globalRoot) {
      return "global";
    }
    return null;
  }
}

