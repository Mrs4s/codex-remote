import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceEntry } from "../types/domain.js";

const execFileAsync = promisify(execFile);

function codexHomeDir(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".codex");
}

function normalizeAgentName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!normalized || !/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error(
      "agentName must start with a letter/number and only contain letters, numbers, '_' or '-'.",
    );
  }
  return normalized;
}

export async function writeAgentConfigToml(agentName: string, content: string): Promise<void> {
  const normalizedName = normalizeAgentName(agentName);
  const targetPath = path.join(codexHomeDir(), "agents", `${normalizedName}.toml`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateFeatureKey(value: string): string {
  const key = value.trim();
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("featureKey contains invalid characters");
  }
  return key;
}

export async function setCodexFeatureFlag(featureKey: string, enabled: boolean): Promise<void> {
  const key = validateFeatureKey(featureKey);
  const configPath = path.join(codexHomeDir(), "config.toml");
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const assignment = `${key} = ${enabled ? "true" : "false"}`;
  const sectionPattern = /^\s*\[(.+)\]\s*$/;
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);

  let featuresStart = -1;
  let featuresEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(sectionPattern);
    if (!match) {
      continue;
    }
    if (match[1]?.trim() === "features") {
      featuresStart = i;
      featuresEnd = lines.length;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (sectionPattern.test(lines[j])) {
          featuresEnd = j;
          break;
        }
      }
      break;
    }
  }

  if (featuresStart < 0) {
    if (lines.length > 0 && lines[lines.length - 1]?.trim()) {
      lines.push("");
    }
    lines.push("[features]");
    lines.push(assignment);
  } else {
    let replaced = false;
    for (let i = featuresStart + 1; i < featuresEnd; i += 1) {
      if (keyPattern.test(lines[i])) {
        lines[i] = assignment;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      lines.splice(featuresEnd, 0, assignment);
    }
  }

  const nextContent = `${lines.join("\n").replace(/\n*$/, "\n")}`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, nextContent, "utf8");
}

async function runGit(workspace: WorkspaceEntry, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspace.path,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function chooseCommitType(paths: string[]): string {
  if (paths.every((value) => value.endsWith(".md") || value.startsWith("docs/"))) {
    return "docs";
  }
  if (paths.some((value) => /(^|\/)(test|tests|__tests__)\//.test(value) || value.includes(".test."))) {
    return "test";
  }
  if (paths.some((value) => value.startsWith("src/"))) {
    return "feat";
  }
  return "chore";
}

function buildCommitSummary(paths: string[]): string {
  if (paths.length === 0) {
    return "update project files";
  }
  if (paths.length === 1) {
    return `update ${path.basename(paths[0])}`;
  }
  if (paths.length === 2) {
    return `update ${path.basename(paths[0])} and ${path.basename(paths[1])}`;
  }
  return `update ${paths.length} files`;
}

export async function generateCommitMessage(
  workspace: WorkspaceEntry,
  commitMessageModelId?: string | null,
): Promise<string> {
  void commitMessageModelId;
  const stagedRaw = await runGit(workspace, ["diff", "--cached", "--name-only"]).catch(() => "");
  const unstagedRaw = await runGit(workspace, ["diff", "--name-only"]).catch(() => "");
  const paths = [...stagedRaw.split("\n"), ...unstagedRaw.split("\n")]
    .map((value) => value.trim())
    .filter(Boolean);
  const uniquePaths = [...new Set(paths)];
  const type = chooseCommitType(uniquePaths);
  const summary = buildCommitSummary(uniquePaths);
  return `${type}: ${summary}`;
}

export type GeneratedAgentConfiguration = {
  description: string;
  developerInstructions: string;
};

export async function generateAgentDescription(
  workspace: WorkspaceEntry,
  seedDescription: string,
): Promise<GeneratedAgentConfiguration> {
  void workspace;
  const seed = seedDescription.trim().replace(/\s+/g, " ");
  const subject = seed.length > 0 ? seed.slice(0, 220) : "the current project";
  return {
    description:
      seed.length > 0
        ? `Specialized coding agent focused on ${subject}.`
        : "Specialized coding agent focused on the current project.",
    developerInstructions: [
      "Review relevant files before editing and preserve existing conventions.",
      "Prefer minimal, safe changes with clear reasoning.",
      "Validate with targeted checks (typecheck/tests) before finishing.",
      `Context seed: ${subject}`,
    ].join("\n"),
  };
}
