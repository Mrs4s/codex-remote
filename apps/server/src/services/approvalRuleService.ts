import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RULES_DIR = "rules";
const DEFAULT_RULES_FILE = "default.rules";

function codexHomeDir(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".codex");
}

function defaultRulesPath(): string {
  return path.join(codexHomeDir(), RULES_DIR, DEFAULT_RULES_FILE);
}

function escapeString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function formatPatternList(pattern: string[]): string {
  return pattern.map((item) => `"${escapeString(item)}"`).join(", ");
}

function formatPrefixRule(pattern: string[]): string {
  const items = formatPatternList(pattern);
  return `prefix_rule(\n    pattern = [${items}],\n    decision = "allow",\n)\n`;
}

function normalizeRuleValue(value: string): string {
  return value.replace(/\s+/g, "");
}

function ruleAlreadyPresent(contents: string, pattern: string[]): boolean {
  const targetPattern = normalizeRuleValue(`[${formatPatternList(pattern)}]`);
  const lines = contents.split("\n");
  let inRule = false;
  let patternMatches = false;
  let decisionAllows = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("prefix_rule(")) {
      inRule = true;
      patternMatches = false;
      decisionAllows = false;
      continue;
    }
    if (!inRule) {
      continue;
    }
    if (trimmed.startsWith("pattern")) {
      const index = trimmed.indexOf("=");
      if (index >= 0) {
        const candidate = trimmed.slice(index + 1).trim().replace(/,$/, "");
        if (normalizeRuleValue(candidate) === targetPattern) {
          patternMatches = true;
        }
      }
      continue;
    }
    if (trimmed.startsWith("decision")) {
      const index = trimmed.indexOf("=");
      if (index >= 0) {
        const candidate = trimmed.slice(index + 1).trim().replace(/,$/, "");
        if (candidate.includes('"allow"') || candidate.includes("'allow'")) {
          decisionAllows = true;
        }
      }
      continue;
    }
    if (trimmed.startsWith(")")) {
      if (patternMatches && decisionAllows) {
        return true;
      }
      inRule = false;
    }
  }

  return false;
}

export async function rememberApprovalRule(
  command: string[],
): Promise<{ ok: true; rulesPath: string }> {
  const pattern = command
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (pattern.length === 0) {
    throw new Error("empty command");
  }

  const rulesPath = defaultRulesPath();
  await fs.mkdir(path.dirname(rulesPath), { recursive: true });

  const existing = await fs.readFile(rulesPath, "utf8").catch(() => "");
  if (ruleAlreadyPresent(existing, pattern)) {
    return {
      ok: true,
      rulesPath,
    };
  }

  let updated = existing;
  if (updated && !updated.endsWith("\n")) {
    updated += "\n";
  }
  if (updated) {
    updated += "\n";
  }
  updated += formatPrefixRule(pattern);
  if (!updated.endsWith("\n")) {
    updated += "\n";
  }
  await fs.writeFile(rulesPath, updated, "utf8");

  return {
    ok: true,
    rulesPath,
  };
}
