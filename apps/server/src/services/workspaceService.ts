import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { v4 as uuidv4 } from "uuid";
import { toWorkspaceInfo, defaultWorkspaceSettings, type WorkspaceEntry } from "../types/domain.js";
import type { JsonStore } from "../storage/jsonStore.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return stdout;
}

async function runGitUnit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

function sanitizeFolderName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || `worktree-${Date.now()}`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return fs.stat(targetPath).then(() => true).catch(() => false);
}

async function uniquePath(
  baseDir: string,
  baseName: string,
  reserved: Set<string>,
): Promise<string> {
  let counter = 1;
  for (;;) {
    const name = counter === 1 ? baseName : `${baseName}-${counter}`;
    const candidate = path.resolve(path.join(baseDir, name));
    if (!reserved.has(candidate) && !(await pathExists(candidate))) {
      return candidate;
    }
    counter += 1;
  }
}

async function gitBranchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await runGitUnit(repoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function uniqueBranchName(
  repoPath: string,
  desired: string,
  currentBranch?: string,
): Promise<string> {
  if (desired === currentBranch) {
    return desired;
  }
  let candidate = desired;
  let suffix = 2;
  while (await gitBranchExists(repoPath, candidate)) {
    if (candidate === currentBranch) {
      break;
    }
    candidate = `${desired}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function copyAgentsFile(parentPath: string, childPath: string): Promise<void> {
  const source = path.join(parentPath, "AGENTS.md");
  const destination = path.join(childPath, "AGENTS.md");
  const exists = await pathExists(source);
  if (!exists) {
    return;
  }
  await fs.copyFile(source, destination).catch(() => undefined);
}

export class WorkspaceService {
  private cache: WorkspaceEntry[] = [];
  private worktreeSetupRan = new Set<string>();

  constructor(private readonly store: JsonStore) {}

  async load(): Promise<void> {
    this.cache = await this.store.readWorkspaces();
  }

  async list(connectedIds: Set<string>) {
    return this.cache.map((entry) => toWorkspaceInfo(entry, connectedIds.has(entry.id)));
  }

  findById(id: string): WorkspaceEntry | undefined {
    return this.cache.find((entry) => entry.id === id);
  }

  async addClone(
    sourceWorkspaceId: string,
    copiesFolder: string,
    copyName: string,
  ): Promise<WorkspaceEntry> {
    const source = this.findById(sourceWorkspaceId);
    if (!source) {
      throw new Error(`Workspace not found: ${sourceWorkspaceId}`);
    }
    const destinationRoot = path.resolve(copiesFolder.trim());
    const destinationRootStat = await fs.stat(destinationRoot).catch(() => null);
    if (!destinationRootStat?.isDirectory()) {
      throw new Error(`copiesFolder is not a directory: ${destinationRoot}`);
    }

    const displayName = copyName.trim();
    if (!displayName) {
      throw new Error("copyName is required");
    }

    const folderName = sanitizeFolderName(displayName);
    const targetPath = path.resolve(path.join(destinationRoot, folderName));
    if (await pathExists(targetPath)) {
      throw new Error(`Target folder already exists: ${targetPath}`);
    }

    await fs.cp(source.path, targetPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });

    const entry: WorkspaceEntry = {
      id: uuidv4(),
      name: displayName,
      path: targetPath,
      kind: "main",
      parentId: null,
      worktree: null,
      settings: {
        ...source.settings,
        cloneSourceWorkspaceId: source.id,
      },
    };

    this.cache.push(entry);
    await this.store.writeWorkspaces(this.cache);
    return entry;
  }

  async addWorktree(
    parentId: string,
    branch: string,
    name?: string | null,
    copyAgentsMd = true,
  ): Promise<WorkspaceEntry> {
    const parent = this.findById(parentId);
    if (!parent) {
      throw new Error(`Workspace not found: ${parentId}`);
    }

    const requestedBranch = branch.trim();
    if (!requestedBranch) {
      throw new Error("branch is required");
    }

    const displayName = name?.trim() || requestedBranch;
    const folderName = sanitizeFolderName(displayName);
    const reserved = new Set(this.cache.map((entry) => path.resolve(entry.path)));
    const targetPath = await uniquePath(path.dirname(parent.path), folderName, reserved);

    const hasBranch = await gitBranchExists(parent.path, requestedBranch);
    const args = ["worktree", "add"];
    if (!hasBranch) {
      args.push("-b", requestedBranch);
    }
    args.push(targetPath);
    if (hasBranch) {
      args.push(requestedBranch);
    }
    await runGitUnit(parent.path, args);

    if (copyAgentsMd) {
      await copyAgentsFile(parent.path, targetPath);
    }

    const entry: WorkspaceEntry = {
      id: uuidv4(),
      name: displayName,
      path: targetPath,
      kind: "worktree",
      parentId: parent.id,
      worktree: {
        branch: requestedBranch,
      },
      settings: {
        ...parent.settings,
      },
    };

    this.cache.push(entry);
    await this.store.writeWorkspaces(this.cache);
    return entry;
  }

  async worktreeSetupStatus(workspaceId: string): Promise<{ shouldRun: boolean; script: string | null }> {
    const workspace = this.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    if ((workspace.kind ?? "main") !== "worktree") {
      return { shouldRun: false, script: null };
    }

    const parent = workspace.parentId ? this.findById(workspace.parentId) : null;
    const rawScript =
      workspace.settings.worktreeSetupScript ??
      parent?.settings.worktreeSetupScript ??
      null;
    const script = rawScript && rawScript.trim() ? rawScript : null;
    return {
      shouldRun: Boolean(script) && !this.worktreeSetupRan.has(workspaceId),
      script,
    };
  }

  async worktreeSetupMarkRan(workspaceId: string): Promise<void> {
    const workspace = this.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    this.worktreeSetupRan.add(workspaceId);
  }

  async addWorkspace(rawPath: string) {
    const workspacePath = path.resolve(rawPath.trim());
    const stat = await fs.stat(workspacePath).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${workspacePath}`);
    }
    const existing = this.cache.find((entry) => path.resolve(entry.path) === workspacePath);
    if (existing) {
      return existing;
    }
    const entry: WorkspaceEntry = {
      id: uuidv4(),
      name: path.basename(workspacePath),
      path: workspacePath,
      kind: "main",
      parentId: null,
      worktree: null,
      settings: defaultWorkspaceSettings(),
    };
    this.cache.push(entry);
    await this.store.writeWorkspaces(this.cache);
    return entry;
  }

  async addWorkspaceFromGitUrl(
    url: string,
    destinationPath: string,
    targetFolderName?: string | null,
  ): Promise<WorkspaceEntry> {
    const destinationRoot = path.resolve(destinationPath.trim());
    const destinationStat = await fs.stat(destinationRoot).catch(() => null);
    if (!destinationStat?.isDirectory()) {
      throw new Error(`destinationPath is not a directory: ${destinationRoot}`);
    }

    const fallbackName = url
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.git$/i, "")
      ?.trim();
    const folderName = (targetFolderName?.trim() || fallbackName || `repo-${Date.now()}`).replace(
      /[^\w.-]/g,
      "-",
    );
    const repoPath = path.join(destinationRoot, folderName);

    const exists = await fs.stat(repoPath).then(() => true).catch(() => false);
    if (exists) {
      throw new Error(`Target folder already exists: ${repoPath}`);
    }

    await execFileAsync("git", ["clone", url, repoPath], {
      cwd: destinationRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });

    return this.addWorkspace(repoPath);
  }

  async isWorkspacePathDir(rawPath: string): Promise<boolean> {
    const candidate = path.resolve(rawPath.trim());
    if (!candidate) {
      return false;
    }
    const stat = await fs.stat(candidate).catch(() => null);
    return Boolean(stat?.isDirectory());
  }

  async removeWorkspace(id: string): Promise<void> {
    const next = this.cache.filter((entry) => entry.id !== id);
    if (next.length === this.cache.length) {
      throw new Error(`Workspace not found: ${id}`);
    }
    this.cache = next;
    await this.store.writeWorkspaces(this.cache);
  }

  async removeWorktree(id: string): Promise<void> {
    const workspace = this.findById(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }
    if ((workspace.kind ?? "main") !== "worktree") {
      throw new Error(`Workspace is not a worktree: ${id}`);
    }

    const parent = workspace.parentId ? this.findById(workspace.parentId) : null;
    const repoPath = parent?.path ?? workspace.path;
    try {
      await runGitUnit(repoPath, ["worktree", "remove", "--force", workspace.path]);
    } catch {
      await fs.rm(workspace.path, { recursive: true, force: true }).catch(() => undefined);
      await runGitUnit(repoPath, ["worktree", "prune"]).catch(() => undefined);
    }

    this.cache = this.cache.filter((entry) => entry.id !== id);
    this.worktreeSetupRan.delete(id);
    await this.store.writeWorkspaces(this.cache);
  }

  async renameWorktree(id: string, branch: string): Promise<WorkspaceEntry> {
    const index = this.cache.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error(`Workspace not found: ${id}`);
    }
    const workspace = this.cache[index];
    if ((workspace.kind ?? "main") !== "worktree") {
      throw new Error(`Workspace is not a worktree: ${id}`);
    }
    const parent = workspace.parentId ? this.findById(workspace.parentId) : null;
    if (!parent) {
      throw new Error(`Parent workspace not found for worktree: ${id}`);
    }

    const desiredBranch = branch.trim();
    if (!desiredBranch) {
      throw new Error("branch is required");
    }
    const oldBranch = workspace.worktree?.branch ?? workspace.name;
    const nextBranch = await uniqueBranchName(parent.path, desiredBranch, oldBranch);
    if (nextBranch !== oldBranch) {
      await runGitUnit(parent.path, ["branch", "-m", oldBranch, nextBranch]);
    }

    const currentPath = path.resolve(workspace.path);
    const reserved = new Set(
      this.cache
        .filter((entry) => entry.id !== id)
        .map((entry) => path.resolve(entry.path)),
    );
    const nextPathCandidate = await uniquePath(
      path.dirname(currentPath),
      sanitizeFolderName(nextBranch),
      reserved,
    );
    let nextPath = currentPath;
    if (nextPathCandidate !== currentPath) {
      try {
        await fs.rename(currentPath, nextPathCandidate);
        nextPath = nextPathCandidate;
      } catch {
        nextPath = currentPath;
      }
    }

    const updated: WorkspaceEntry = {
      ...workspace,
      name: nextBranch,
      path: nextPath,
      worktree: {
        branch: nextBranch,
      },
    };
    this.cache[index] = updated;
    await this.store.writeWorkspaces(this.cache);
    return updated;
  }

  async renameWorktreeUpstream(id: string, oldBranch: string, newBranch: string): Promise<void> {
    const workspace = this.findById(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }
    if ((workspace.kind ?? "main") !== "worktree") {
      throw new Error(`Workspace is not a worktree: ${id}`);
    }
    const parent = workspace.parentId ? this.findById(workspace.parentId) : null;
    const repoPath = parent?.path ?? workspace.path;
    const oldValue = oldBranch.trim() || workspace.worktree?.branch || workspace.name;
    const newValue = newBranch.trim();
    if (!newValue) {
      throw new Error("newBranch is required");
    }

    const remote =
      (await runGit(repoPath, ["config", "--get", `branch.${newValue}.remote`]).catch(() => ""))
        .trim() || "origin";

    await runGitUnit(repoPath, ["push", remote, `refs/heads/${newValue}:refs/heads/${newValue}`]);
    if (oldValue && oldValue !== newValue) {
      await runGitUnit(repoPath, ["push", remote, "--delete", oldValue]).catch(() => undefined);
    }
    await runGitUnit(repoPath, [
      "branch",
      "--set-upstream-to",
      `${remote}/${newValue}`,
      newValue,
    ]).catch(() => undefined);
  }

  async applyWorktreeChanges(workspaceId: string): Promise<void> {
    const workspace = this.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    if ((workspace.kind ?? "main") !== "worktree") {
      throw new Error("apply_worktree_changes is only valid for worktree workspaces");
    }
    const parent = workspace.parentId ? this.findById(workspace.parentId) : null;
    if (!parent) {
      throw new Error(`Parent workspace not found for worktree: ${workspaceId}`);
    }
    const branch = workspace.worktree?.branch ?? workspace.name;
    await runGitUnit(parent.path, ["merge", "--no-ff", "--no-edit", branch]);
  }

  async setRuntimeCodexArgs(
    workspaceId: string,
    codexArgs: string | null,
  ): Promise<{ appliedCodexArgs: string | null; respawned: boolean }> {
    const workspace = this.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    void workspace;
    return {
      appliedCodexArgs: codexArgs,
      respawned: false,
    };
  }

  async updateSettings(id: string, settings: WorkspaceEntry["settings"]) {
    const index = this.cache.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error(`Workspace not found: ${id}`);
    }
    const current = this.cache[index];
    const next: WorkspaceEntry = {
      ...current,
      settings: {
        ...current.settings,
        ...settings,
      },
    };
    this.cache[index] = next;
    await this.store.writeWorkspaces(this.cache);
    return next;
  }
}
