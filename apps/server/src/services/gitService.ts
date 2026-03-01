import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceEntry } from "../types/domain.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_SCAN_RESULTS = 200;

async function runGit(workspace: WorkspaceEntry, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspace.path,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function runGitUnit(workspace: WorkspaceEntry, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd: workspace.path,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runGitByPath(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function runGitUnitByPath(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parseDiffChunks(patch: string): Record<string, unknown>[] {
  const lines = patch.split("\n");
  const chunks: Array<{ path: string; status: string; lines: string[] }> = [];
  let current: { path: string; status: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    chunks.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const filePath = (match?.[2] || match?.[1] || "unknown").trim();
      current = {
        path: filePath,
        status: "modified",
        lines: [line],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("new file mode ")) {
      current.status = "added";
    } else if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
    } else if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      current.status = "renamed";
    }
    current.lines.push(line);
  }
  flush();

  if (chunks.length === 0 && patch.trim()) {
    return [
      {
        path: "changes.patch",
        status: "modified",
        diff: patch,
      },
    ];
  }

  return chunks.map((chunk) => ({
    path: chunk.path,
    status: chunk.status,
    diff: chunk.lines.join("\n"),
  }));
}

function normalizeGitHubUser(value: unknown): { login: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const login = (value as Record<string, unknown>).login;
  if (typeof login !== "string" || !login.trim()) {
    return null;
  }
  return { login };
}

async function runGh(workspace: WorkspaceEntry, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: workspace.path,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function ensureGhInstalled(workspace: WorkspaceEntry): Promise<void> {
  try {
    await runGh(workspace, ["--version"]);
  } catch {
    throw new Error("GitHub CLI (gh) is required for this action");
  }
}

export async function getGitStatus(workspace: WorkspaceEntry): Promise<Record<string, unknown>> {
  const branchRaw = await runGit(workspace, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "unknown");
  const statusRaw = await runGit(workspace, ["status", "--porcelain=v1"]).catch(() => "");
  const lines = statusRaw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const files = lines.map((line) => {
    const status = line.slice(0, 2);
    const filePath = line.slice(3);
    return {
      path: filePath,
      status,
      additions: 0,
      deletions: 0,
    };
  });

  return {
    branchName: branchRaw.trim(),
    files,
    stagedFiles: files.filter((f) => String((f as { status: string }).status)[0] !== " "),
    unstagedFiles: files.filter((f) => String((f as { status: string }).status)[1] !== " "),
    totalAdditions: 0,
    totalDeletions: 0,
  };
}

export async function getGitDiffs(workspace: WorkspaceEntry): Promise<Record<string, unknown>[]> {
  const namesRaw = await runGit(workspace, ["diff", "--name-only"]).catch(() => "");
  const names = namesRaw.split("\n").map((value) => value.trim()).filter(Boolean);

  const diffs: Record<string, unknown>[] = [];
  for (const filePath of names) {
    const diff = await runGit(workspace, ["diff", "--", filePath]).catch(() => "");
    diffs.push({ path: filePath, diff, isBinary: false, isImage: false });
  }
  return diffs;
}

export async function getGitRemote(workspace: WorkspaceEntry): Promise<string | null> {
  const remote = await runGit(workspace, ["remote", "get-url", "origin"]).catch(() => "");
  const trimmed = remote.trim();
  return trimmed ? trimmed : null;
}

export async function getGitLog(
  workspace: WorkspaceEntry,
  limit?: number | null,
): Promise<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit ?? 40, 200));
  const raw = await runGit(workspace, [
    "log",
    `--max-count=${safeLimit}`,
    "--pretty=format:%H%x1f%s%x1f%an%x1f%ct",
  ]).catch(() => "");
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, summary, author, ts] = line.split("\u001f");
      return {
        sha,
        summary,
        author,
        timestamp: Number(ts || "0"),
      };
    });
  return {
    total: entries.length,
    entries,
    ahead: 0,
    behind: 0,
    aheadEntries: [],
    behindEntries: [],
    upstream: null,
  };
}

export async function stageGitFile(workspace: WorkspaceEntry, filePath: string): Promise<void> {
  await runGitUnit(workspace, ["add", "--", filePath]);
}

export async function stageGitAll(workspace: WorkspaceEntry): Promise<void> {
  await runGitUnit(workspace, ["add", "-A"]);
}

export async function unstageGitFile(workspace: WorkspaceEntry, filePath: string): Promise<void> {
  await runGitUnit(workspace, ["restore", "--staged", "--", filePath]);
}

export async function revertGitFile(workspace: WorkspaceEntry, filePath: string): Promise<void> {
  await runGitUnit(workspace, ["restore", "--", filePath]);
}

export async function revertGitAll(workspace: WorkspaceEntry): Promise<void> {
  await runGitUnit(workspace, ["restore", "."]);
}

export async function commitGit(workspace: WorkspaceEntry, message: string): Promise<void> {
  await runGit(workspace, ["commit", "-m", message]);
}

export async function pushGit(workspace: WorkspaceEntry): Promise<void> {
  await runGitUnit(workspace, ["push"]);
}

export async function pullGit(workspace: WorkspaceEntry): Promise<void> {
  await runGitUnit(workspace, ["pull"]);
}

export async function fetchGit(workspace: WorkspaceEntry): Promise<void> {
  await runGitUnit(workspace, ["fetch"]);
}

export async function syncGit(workspace: WorkspaceEntry): Promise<void> {
  await fetchGit(workspace);
  await pullGit(workspace);
}

export async function listGitBranches(workspace: WorkspaceEntry): Promise<Record<string, unknown>> {
  const raw = await runGit(workspace, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%x1f%(committerdate:unix)", "refs/heads"]);
  const branches = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, ts] = line.split("\u001f");
      return {
        name,
        lastCommit: Number(ts || "0"),
      };
    });
  return {
    branches,
  };
}

export async function checkoutGitBranch(workspace: WorkspaceEntry, name: string): Promise<void> {
  await runGitUnit(workspace, ["checkout", name]);
}

export async function createGitBranch(workspace: WorkspaceEntry, name: string): Promise<void> {
  await runGitUnit(workspace, ["checkout", "-b", name]);
}

export async function initGitRepo(
  workspace: WorkspaceEntry,
  branch: string,
  force = false,
): Promise<Record<string, unknown>> {
  const gitPath = path.join(workspace.path, ".git");
  const alreadyInitialized = await fs
    .stat(gitPath)
    .then(() => true)
    .catch(() => false);
  if (alreadyInitialized) {
    return { status: "already_initialized" };
  }

  if (!force) {
    const entries = await fs.readdir(workspace.path).catch(() => []);
    const entryCount = entries.filter((value) => value !== ".DS_Store").length;
    if (entryCount > 0) {
      return { status: "needs_confirmation", entryCount };
    }
  }

  const trimmedBranch = branch.trim() || "main";
  try {
    await runGitUnit(workspace, ["init", "-b", trimmedBranch]);
  } catch {
    await runGitUnit(workspace, ["init"]);
    await runGitUnit(workspace, ["checkout", "-b", trimmedBranch]).catch(() => undefined);
  }
  await runGitUnit(workspace, ["add", "-A"]);

  let commitError: string | null = null;
  try {
    await runGitUnit(workspace, ["commit", "--allow-empty", "-m", "Initial commit"]);
  } catch (error) {
    commitError = error instanceof Error ? error.message : String(error);
  }

  return {
    status: "initialized",
    ...(commitError ? { commitError } : {}),
  };
}

export async function createGitHubRepo(
  workspace: WorkspaceEntry,
  repo: string,
  visibility: "private" | "public",
  branch?: string | null,
): Promise<Record<string, unknown>> {
  const repoName = repo.trim();
  if (!repoName) {
    throw new Error("repo is required");
  }
  await ensureGhInstalled(workspace);

  await runGh(workspace, [
    "repo",
    "create",
    repoName,
    visibility === "public" ? "--public" : "--private",
    "--source",
    ".",
    "--remote",
    "origin",
    "--confirm",
  ]);

  const resolvedBranch =
    branch?.trim() ||
    (await runGit(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])
      .then((value) => value.trim())
      .catch(() => "main"));
  const remoteUrl = await getGitRemote(workspace);

  let pushError: string | null = null;
  let defaultBranchError: string | null = null;
  try {
    await runGitUnit(workspace, ["push", "-u", "origin", resolvedBranch]);
  } catch (error) {
    pushError = error instanceof Error ? error.message : String(error);
  }
  try {
    await runGh(workspace, ["repo", "edit", repoName, "--default-branch", resolvedBranch]);
  } catch (error) {
    defaultBranchError = error instanceof Error ? error.message : String(error);
  }

  if (pushError || defaultBranchError) {
    return {
      status: "partial",
      repo: repoName,
      remoteUrl,
      pushError,
      defaultBranchError,
    };
  }

  return {
    status: "ok",
    repo: repoName,
    remoteUrl,
  };
}

export async function listGitRoots(
  workspace: WorkspaceEntry,
  depth?: number | null,
): Promise<string[]> {
  const maxDepth = Math.min(6, Math.max(1, Math.trunc(depth ?? 2)));
  const roots: string[] = [];
  const seen = new Set<string>();

  const walk = async (dir: string, level: number): Promise<void> => {
    if (roots.length >= MAX_GIT_SCAN_RESULTS) {
      return;
    }
    const resolvedDir = path.resolve(dir);
    if (seen.has(resolvedDir)) {
      return;
    }
    seen.add(resolvedDir);

    const gitEntry = path.join(resolvedDir, ".git");
    if (await fs.stat(gitEntry).then(() => true).catch(() => false)) {
      roots.push(resolvedDir);
      return;
    }
    if (level >= maxDepth) {
      return;
    }

    const entries = await fs.readdir(resolvedDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      await walk(path.join(resolvedDir, entry.name), level + 1);
      if (roots.length >= MAX_GIT_SCAN_RESULTS) {
        return;
      }
    }
  };

  await walk(workspace.path, 0);
  return roots;
}

export async function getGitCommitDiff(
  workspace: WorkspaceEntry,
  sha: string,
): Promise<Record<string, unknown>[]> {
  const patch = await runGit(workspace, [
    "show",
    "--no-color",
    "--format=",
    "--find-renames",
    "--patch",
    sha,
  ]).catch(() => "");
  return parseDiffChunks(patch);
}

export async function getGitHubIssues(
  workspace: WorkspaceEntry,
): Promise<Record<string, unknown>> {
  await ensureGhInstalled(workspace);
  const raw = await runGh(workspace, [
    "issue",
    "list",
    "--limit",
    "50",
    "--json",
    "number,title,url,updatedAt",
  ]);
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
  const issues = parsed.map((item) => ({
    number: Number(item.number ?? 0),
    title: String(item.title ?? ""),
    url: String(item.url ?? ""),
    updatedAt: String(item.updatedAt ?? ""),
  }));
  return {
    total: issues.length,
    issues,
  };
}

export async function getGitHubPullRequests(
  workspace: WorkspaceEntry,
): Promise<Record<string, unknown>> {
  await ensureGhInstalled(workspace);
  const raw = await runGh(workspace, [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "50",
    "--json",
    "number,title,url,updatedAt,createdAt,body,headRefName,baseRefName,isDraft,author",
  ]);
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
  const pullRequests = parsed.map((item) => ({
    number: Number(item.number ?? 0),
    title: String(item.title ?? ""),
    url: String(item.url ?? ""),
    updatedAt: String(item.updatedAt ?? ""),
    createdAt: String(item.createdAt ?? ""),
    body: String(item.body ?? ""),
    headRefName: String(item.headRefName ?? ""),
    baseRefName: String(item.baseRefName ?? ""),
    isDraft: Boolean(item.isDraft),
    author: normalizeGitHubUser(item.author),
  }));
  return {
    total: pullRequests.length,
    pullRequests,
  };
}

export async function getGitHubPullRequestDiff(
  workspace: WorkspaceEntry,
  prNumber: number,
): Promise<Record<string, unknown>[]> {
  await ensureGhInstalled(workspace);
  const raw = await runGh(workspace, ["pr", "diff", String(prNumber)]);
  return parseDiffChunks(raw);
}

export async function getGitHubPullRequestComments(
  workspace: WorkspaceEntry,
  prNumber: number,
): Promise<Record<string, unknown>[]> {
  await ensureGhInstalled(workspace);
  const raw = await runGh(workspace, ["pr", "view", String(prNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: Array<Record<string, unknown>> };
  const comments = parsed.comments ?? [];
  return comments.map((item) => ({
    id: Number(item.id ?? 0),
    body: String(item.body ?? ""),
    createdAt: String(item.createdAt ?? ""),
    url: String(item.url ?? ""),
    author: normalizeGitHubUser(item.author),
  }));
}

export async function checkoutGitHubPullRequest(
  workspace: WorkspaceEntry,
  prNumber: number,
): Promise<void> {
  await ensureGhInstalled(workspace);
  await runGh(workspace, ["pr", "checkout", String(prNumber)]);
}
