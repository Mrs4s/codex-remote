import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceEntry } from "../types/domain.js";
import type { SessionManager } from "./sessionManager.js";
import type { JsonStore } from "../storage/jsonStore.js";

const execFileAsync = promisify(execFile);
const DEFAULT_COMMIT_MESSAGE_PROMPT =
  "Generate a concise git commit message for the following changes. " +
  "Follow conventional commit format (e.g., feat:, fix:, refactor:, docs:, etc.). " +
  "Keep the summary line under 72 characters. " +
  "Only output the commit message, nothing else.\n\n" +
  "Changes:\n{diff}";

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

function pickCommitMessagePrompt(settings: Record<string, unknown>): string {
  const value = settings.commitMessagePrompt;
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return DEFAULT_COMMIT_MESSAGE_PROMPT;
}

function pickCommitMessageModel(
  settings: Record<string, unknown>,
  commitMessageModelId?: string | null,
): string | null {
  const explicit = commitMessageModelId?.trim();
  if (explicit) {
    return explicit;
  }
  const fromSettings = settings.commitMessageModelId;
  if (typeof fromSettings === "string" && fromSettings.trim()) {
    return fromSettings.trim();
  }
  return null;
}

function buildCommitMessagePrompt(diff: string, template: string): string {
  const base = template.trim() ? template : DEFAULT_COMMIT_MESSAGE_PROMPT;
  if (base.includes("{diff}")) {
    return base.replace("{diff}", diff);
  }
  return `${base}\n\nChanges:\n${diff}`;
}

async function collectWorkspaceDiff(workspace: WorkspaceEntry): Promise<string> {
  const staged = await runGit(workspace, [
    "diff",
    "--cached",
    "--patch",
    "--no-color",
    "--find-renames",
  ]).catch(() => "");
  const unstaged = await runGit(workspace, [
    "diff",
    "--patch",
    "--no-color",
    "--find-renames",
  ]).catch(() => "");

  const parts = [staged.trim(), unstaged.trim()].filter((value) => value.length > 0);
  if (parts.length === 0) {
    throw new Error("No changes to generate commit message for");
  }
  return parts.join("\n\n");
}

export async function generateCommitMessage(
  workspace: WorkspaceEntry,
  sessionManager: SessionManager,
  store: JsonStore,
  commitMessageModelId?: string | null,
): Promise<string> {
  const settings = (await store.readSettings()) as Record<string, unknown>;
  const diff = await collectWorkspaceDiff(workspace);
  const promptTemplate = pickCommitMessagePrompt(settings);
  const prompt = buildCommitMessagePrompt(diff, promptTemplate);
  const model = pickCommitMessageModel(settings, commitMessageModelId);
  const response = await sessionManager.runBackgroundPrompt(workspace, prompt, {
    model,
    timeoutMs: 60_000,
  });
  return response.trim();
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
