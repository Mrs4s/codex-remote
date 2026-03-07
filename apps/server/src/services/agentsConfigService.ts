import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentSummary,
  AgentsSettings,
  CreateAgentInput,
  DeleteAgentInput,
  SetAgentsCoreInput,
  UpdateAgentInput,
} from "@codex-remote/shared-types";
import type { WorkspaceEntry } from "../types/domain.js";

const DEFAULT_MAX_THREADS = 6;
const DEFAULT_MAX_DEPTH = 1;
const MIN_MAX_THREADS = 1;
const MAX_MAX_THREADS = 12;
const MIN_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 4;

type TomlScalar = string | number | boolean | null;

type ParsedAssignment = {
  fullPath: string[];
  lineStart: number;
  lineEnd: number;
  currentSection: string[];
  keyRaw: string;
  value: TomlScalar;
};

type ParsedSection = {
  path: string[];
  headerLine: number;
  endLine: number;
};

type ParsedTomlDocument = {
  lines: string[];
  assignments: ParsedAssignment[];
  sections: ParsedSection[];
};

type AgentFileTarget = {
  configFile: string;
  resolvedPath: string;
  managedByApp: boolean;
  fileExists: boolean;
};

function codexHomeDir(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".codex");
}

function globalConfigPath(): string {
  return path.join(codexHomeDir(), "config.toml");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
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

function ensureMaxThreads(value: number): number {
  if (!Number.isInteger(value) || value < MIN_MAX_THREADS || value > MAX_MAX_THREADS) {
    throw new Error(`maxThreads must be an integer between ${MIN_MAX_THREADS} and ${MAX_MAX_THREADS}`);
  }
  return value;
}

function ensureMaxDepth(value: number): number {
  if (!Number.isInteger(value) || value < MIN_MAX_DEPTH || value > MAX_MAX_DEPTH) {
    throw new Error(`maxDepth must be an integer between ${MIN_MAX_DEPTH} and ${MAX_MAX_DEPTH}`);
  }
  return value;
}

function stripMatchingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDottedPath(value: string): string[] {
  return value
    .split(".")
    .map((part) => stripMatchingQuotes(part.trim()))
    .filter((part) => part.length > 0);
}

function parseTableHeader(line: string): string[] | null {
  const withoutComment = line.includes("#") ? line.slice(0, line.indexOf("#")) : line;
  const trimmed = withoutComment.trim();
  if (!trimmed.startsWith("[") || trimmed.startsWith("[[")) {
    return null;
  }
  const match = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return parseDottedPath(match[1] ?? "");
}

function stripInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inSingle) {
      if (char === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inDouble = false;
      }
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (char === "\"") {
      inDouble = true;
      continue;
    }
    if (char === "#") {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
}

function readValueSpan(
  lines: string[],
  startLine: number,
  valueStartIndex: number,
): { rawValue: string; endLine: number } {
  const firstSegment = lines[startLine]?.slice(valueStartIndex) ?? "";
  const trimmed = firstSegment.trimStart();
  const delimiter = trimmed.startsWith("\"\"\"")
    ? "\"\"\""
    : trimmed.startsWith("'''")
      ? "'''"
      : null;

  if (!delimiter) {
    return {
      rawValue: firstSegment,
      endLine: startLine,
    };
  }

  if (trimmed.indexOf(delimiter, delimiter.length) >= 0) {
    return {
      rawValue: firstSegment,
      endLine: startLine,
    };
  }

  let endLine = startLine;
  let rawValue = firstSegment;
  while (endLine + 1 < lines.length) {
    endLine += 1;
    rawValue += `\n${lines[endLine]}`;
    if (lines[endLine]?.includes(delimiter)) {
      break;
    }
  }

  return { rawValue, endLine };
}

function parseDoubleQuotedString(value: string): string | null {
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      const literal = value.slice(0, index + 1);
      try {
        return JSON.parse(literal) as string;
      } catch {
        return literal.slice(1, -1);
      }
    }
  }
  return null;
}

function parseSingleQuotedString(value: string): string | null {
  const endIndex = value.indexOf("'", 1);
  if (endIndex < 0) {
    return null;
  }
  return value.slice(1, endIndex);
}

function parseMultilineString(value: string): string | null {
  const delimiter = value.startsWith("\"\"\"") ? "\"\"\"" : value.startsWith("'''") ? "'''" : null;
  if (!delimiter) {
    return null;
  }
  const endIndex = value.lastIndexOf(delimiter);
  if (endIndex < delimiter.length) {
    return null;
  }
  let content = value.slice(delimiter.length, endIndex);
  if (content.startsWith("\n")) {
    content = content.slice(1);
  }
  return content;
}

function parseTomlScalar(rawValue: string): TomlScalar {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("\"\"\"") || trimmed.startsWith("'''")) {
    return parseMultilineString(trimmed);
  }
  if (trimmed.startsWith("\"")) {
    return parseDoubleQuotedString(trimmed);
  }
  if (trimmed.startsWith("'")) {
    return parseSingleQuotedString(trimmed);
  }

  const withoutComment = stripInlineComment(trimmed).trim();
  if (withoutComment === "true") {
    return true;
  }
  if (withoutComment === "false") {
    return false;
  }
  if (/^[+-]?\d+$/.test(withoutComment)) {
    return Number.parseInt(withoutComment, 10);
  }
  return null;
}

function parseTomlDocument(rawText: string): ParsedTomlDocument {
  const normalized = normalizeNewlines(rawText);
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const assignments: ParsedAssignment[] = [];
  const sections: ParsedSection[] = [];
  let currentSection: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; ) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      lineIndex += 1;
      continue;
    }

    const sectionPath = parseTableHeader(line);
    if (sectionPath) {
      currentSection = sectionPath;
      sections.push({
        path: sectionPath,
        headerLine: lineIndex,
        endLine: lines.length - 1,
      });
      lineIndex += 1;
      continue;
    }

    const assignmentIndex = line.indexOf("=");
    if (assignmentIndex < 0) {
      lineIndex += 1;
      continue;
    }

    const keyRaw = line.slice(0, assignmentIndex).trim();
    if (!keyRaw) {
      lineIndex += 1;
      continue;
    }

    const keyPath = parseDottedPath(keyRaw);
    if (keyPath.length === 0) {
      lineIndex += 1;
      continue;
    }

    const valueSpan = readValueSpan(lines, lineIndex, assignmentIndex + 1);
    assignments.push({
      fullPath: [...currentSection, ...keyPath],
      lineStart: lineIndex,
      lineEnd: valueSpan.endLine,
      currentSection: [...currentSection],
      keyRaw,
      value: parseTomlScalar(valueSpan.rawValue),
    });
    lineIndex = valueSpan.endLine + 1;
  }

  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index];
    const next = sections[index + 1];
    current.endLine = next ? next.headerLine - 1 : lines.length - 1;
  }

  return {
    lines,
    assignments,
    sections,
  };
}

function pathsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function findSection(document: ParsedTomlDocument, fullPath: string[]): ParsedSection | null {
  return document.sections.find((section) => pathsEqual(section.path, fullPath)) ?? null;
}

function listCustomAgentNames(document: ParsedTomlDocument): string[] {
  const names = new Set<string>();

  for (const section of document.sections) {
    if (section.path.length === 2 && section.path[0] === "agents") {
      names.add(section.path[1] ?? "");
    }
  }

  for (const assignment of document.assignments) {
    if (assignment.fullPath.length >= 3 && assignment.fullPath[0] === "agents") {
      names.add(assignment.fullPath[1] ?? "");
    }
  }

  return Array.from(names)
    .filter((name) => name.length > 0 && name !== "max_threads" && name !== "max_depth")
    .sort((left, right) => left.localeCompare(right));
}

function getLastScalar(document: ParsedTomlDocument, fullPath: string[]): TomlScalar {
  const matches = document.assignments.filter((assignment) => pathsEqual(assignment.fullPath, fullPath));
  if (matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1]?.value ?? null;
}

function getLastString(document: ParsedTomlDocument, fullPath: string[]): string | null {
  const value = getLastScalar(document, fullPath);
  return typeof value === "string" ? value : null;
}

function serializeToml(lines: string[]): string {
  const compacted: string[] = [];
  let previousBlank = true;

  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank && previousBlank) {
      continue;
    }
    compacted.push(line);
    previousBlank = isBlank;
  }

  while (compacted[0]?.trim() === "") {
    compacted.shift();
  }
  while (compacted[compacted.length - 1]?.trim() === "") {
    compacted.pop();
  }

  return compacted.length > 0 ? `${compacted.join("\n")}\n` : "";
}

function replaceLineRange(
  lines: string[],
  startLine: number,
  endLine: number,
  nextLines: string[],
): string[] {
  return [
    ...lines.slice(0, startLine),
    ...nextLines,
    ...lines.slice(endLine + 1),
  ];
}

function renderTomlValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    return JSON.stringify(normalizeNewlines(value));
  }
  return String(value);
}

function upsertValue(
  rawText: string,
  fullPath: string[],
  value: string | number | boolean,
): string {
  const document = parseTomlDocument(rawText);
  const matches = document.assignments.filter((assignment) => pathsEqual(assignment.fullPath, fullPath));

  if (matches.length > 0) {
    let nextLines = [...document.lines];
    for (let index = matches.length - 1; index >= 1; index -= 1) {
      const match = matches[index];
      nextLines = replaceLineRange(nextLines, match.lineStart, match.lineEnd, []);
    }
    const primary = matches[0];
    nextLines = replaceLineRange(nextLines, primary.lineStart, primary.lineEnd, [
      `${primary.keyRaw} = ${renderTomlValue(value)}`,
    ]);
    return serializeToml(nextLines);
  }

  const tablePath = fullPath.slice(0, -1);
  const key = fullPath[fullPath.length - 1];
  if (!key) {
    return rawText;
  }

  if (tablePath.length === 0) {
    const nextLines = [...document.lines];
    if (nextLines.length > 0 && nextLines[nextLines.length - 1]?.trim()) {
      nextLines.push("");
    }
    nextLines.push(`${key} = ${renderTomlValue(value)}`);
    return serializeToml(nextLines);
  }

  const section = findSection(document, tablePath);
  if (section) {
    const nextLines = [...document.lines];
    nextLines.splice(section.endLine + 1, 0, `${key} = ${renderTomlValue(value)}`);
    return serializeToml(nextLines);
  }

  const nextLines = [...document.lines];
  if (nextLines.length > 0 && nextLines[nextLines.length - 1]?.trim()) {
    nextLines.push("");
  }
  nextLines.push(`[${tablePath.join(".")}]`);
  nextLines.push(`${key} = ${renderTomlValue(value)}`);
  return serializeToml(nextLines);
}

function removeValue(rawText: string, fullPath: string[]): string {
  const document = parseTomlDocument(rawText);
  const matches = document.assignments.filter((assignment) => pathsEqual(assignment.fullPath, fullPath));
  if (matches.length === 0) {
    return serializeToml(document.lines);
  }

  let nextLines = [...document.lines];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    nextLines = replaceLineRange(nextLines, match.lineStart, match.lineEnd, []);
  }
  return serializeToml(nextLines);
}

function renameSection(rawText: string, oldPath: string[], nextPath: string[]): string {
  const document = parseTomlDocument(rawText);
  const section = findSection(document, oldPath);
  if (!section) {
    return rawText;
  }

  const nextLines = [...document.lines];
  nextLines[section.headerLine] = `[${nextPath.join(".")}]`;
  return serializeToml(nextLines);
}

function removeSection(rawText: string, fullPath: string[]): string {
  const document = parseTomlDocument(rawText);
  const section = findSection(document, fullPath);
  if (!section) {
    return rawText;
  }

  let startLine = section.headerLine;
  if (startLine > 0 && document.lines[startLine - 1]?.trim() === "") {
    startLine -= 1;
  }

  const nextLines = replaceLineRange(document.lines, startLine, section.endLine, []);
  return serializeToml(nextLines);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeNewlines(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function expandHomeDir(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function managedAgentConfigRelativePath(agentName: string): string {
  return `agents/${normalizeAgentName(agentName)}.toml`;
}

function managedAgentConfigPath(agentName: string): string {
  return path.join(codexHomeDir(), "agents", `${normalizeAgentName(agentName)}.toml`);
}

function resolveConfigFilePath(configFile: string): string {
  const expanded = expandHomeDir(configFile.trim());
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.resolve(path.dirname(globalConfigPath()), expanded);
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isManagedAgentPath(filePath: string): boolean {
  return isPathWithin(path.join(codexHomeDir(), "agents"), filePath);
}

async function readUtf8IfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath).catch(() => null);
  return Boolean(stats?.isFile());
}

async function writeUtf8(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function buildAgentFileTarget(
  agentName: string,
  configFileValue: string | null,
): Promise<AgentFileTarget> {
  const fallback = managedAgentConfigRelativePath(agentName);
  const configFile = (configFileValue?.trim() || fallback).trim();
  const resolvedPath = resolveConfigFilePath(configFile);
  return {
    configFile,
    resolvedPath,
    managedByApp: isManagedAgentPath(resolvedPath),
    fileExists: await isFile(resolvedPath),
  };
}

async function readAgentDeveloperInstructions(filePath: string): Promise<string | null> {
  const raw = await readUtf8IfExists(filePath);
  if (!raw) {
    return null;
  }
  const document = parseTomlDocument(raw);
  return getLastString(document, ["developer_instructions"]);
}

async function readGlobalConfigDocument(): Promise<{ raw: string; document: ParsedTomlDocument }> {
  const raw = await readUtf8IfExists(globalConfigPath());
  return {
    raw,
    document: parseTomlDocument(raw),
  };
}

async function writeGlobalConfig(raw: string): Promise<void> {
  await writeUtf8(globalConfigPath(), raw);
}

function buildAgentConfigToml(input: {
  model?: string | null;
  reasoningEffort?: string | null;
  developerInstructions?: string | null;
}): string {
  const lines: string[] = [];
  const model = normalizeOptionalText(input.model);
  const reasoningEffort = normalizeOptionalText(input.reasoningEffort)?.toLowerCase() ?? null;
  const developerInstructions = normalizeOptionalText(input.developerInstructions);

  if (model) {
    lines.push(`model = ${renderTomlValue(model)}`);
  }
  if (reasoningEffort) {
    lines.push(`model_reasoning_effort = ${renderTomlValue(reasoningEffort)}`);
  }
  if (developerInstructions) {
    lines.push(`developer_instructions = ${renderTomlValue(developerInstructions)}`);
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

async function findAgentSummary(agentName: string): Promise<AgentSummary | null> {
  const settings = await getAgentsSettings();
  return settings.agents.find((agent) => agent.name === normalizeAgentName(agentName)) ?? null;
}

export async function getAgentsSettings(): Promise<AgentsSettings> {
  const { document } = await readGlobalConfigDocument();
  const multiAgentEnabled = getLastScalar(document, ["features", "multi_agent"]) === true;
  const maxThreads = ensureMaxThreads(
    (getLastScalar(document, ["agents", "max_threads"]) as number | null) ?? DEFAULT_MAX_THREADS,
  );
  const maxDepth = ensureMaxDepth(
    (getLastScalar(document, ["agents", "max_depth"]) as number | null) ?? DEFAULT_MAX_DEPTH,
  );

  const agents = await Promise.all(
    listCustomAgentNames(document).map(async (name) => {
      const target = await buildAgentFileTarget(
        name,
        getLastString(document, ["agents", name, "config_file"]),
      );
      const developerInstructions = target.fileExists
        ? await readAgentDeveloperInstructions(target.resolvedPath).catch(() => null)
        : null;
      return {
        name,
        description: getLastString(document, ["agents", name, "description"]),
        developerInstructions,
        configFile: target.configFile,
        resolvedPath: target.resolvedPath,
        managedByApp: target.managedByApp,
        fileExists: target.fileExists,
      } satisfies AgentSummary;
    }),
  );

  return {
    configPath: globalConfigPath(),
    multiAgentEnabled,
    maxThreads,
    maxDepth,
    agents,
  };
}

export async function setAgentsCoreSettings(input: SetAgentsCoreInput): Promise<AgentsSettings> {
  let rawConfig = (await readGlobalConfigDocument()).raw;
  rawConfig = upsertValue(rawConfig, ["features", "multi_agent"], Boolean(input.multiAgentEnabled));
  rawConfig = upsertValue(rawConfig, ["agents", "max_threads"], ensureMaxThreads(input.maxThreads));
  rawConfig = upsertValue(rawConfig, ["agents", "max_depth"], ensureMaxDepth(input.maxDepth));
  await writeGlobalConfig(rawConfig);
  return getAgentsSettings();
}

export async function createAgent(input: CreateAgentInput): Promise<AgentsSettings> {
  const name = normalizeAgentName(input.name);
  const settings = await getAgentsSettings();
  if (settings.agents.some((agent) => agent.name === name)) {
    throw new Error(`Agent already exists: ${name}`);
  }

  const managedPath = managedAgentConfigPath(name);
  if (await isFile(managedPath)) {
    throw new Error(`Agent config file already exists: ${managedPath}`);
  }

  const configFile = managedAgentConfigRelativePath(name);
  const configContent = buildAgentConfigToml({
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    developerInstructions: input.developerInstructions,
  });

  let rawConfig = (await readGlobalConfigDocument()).raw;
  rawConfig = upsertValue(rawConfig, ["agents", name, "config_file"], configFile);
  const description = normalizeOptionalText(input.description);
  rawConfig =
    description === null
      ? removeValue(rawConfig, ["agents", name, "description"])
      : upsertValue(rawConfig, ["agents", name, "description"], description);

  await writeUtf8(managedAgentConfigPath(name), configContent);
  await writeGlobalConfig(rawConfig);
  return getAgentsSettings();
}

export async function updateAgent(input: UpdateAgentInput): Promise<AgentsSettings> {
  const originalName = normalizeAgentName(input.originalName);
  const nextName = normalizeAgentName(input.name);
  const settings = await getAgentsSettings();
  const currentAgent = settings.agents.find((agent) => agent.name === originalName);
  if (!currentAgent) {
    throw new Error(`Agent not found: ${originalName}`);
  }
  if (nextName !== originalName && settings.agents.some((agent) => agent.name === nextName)) {
    throw new Error(`Agent already exists: ${nextName}`);
  }

  const renameManagedFile = input.renameManagedFile !== false;
  const currentTarget = await buildAgentFileTarget(originalName, currentAgent.configFile);
  let nextConfigFile = currentAgent.configFile;
  let nextResolvedPath = currentTarget.resolvedPath;

  if (nextName !== originalName && currentTarget.managedByApp && renameManagedFile) {
    nextConfigFile = managedAgentConfigRelativePath(nextName);
    nextResolvedPath = resolveConfigFilePath(nextConfigFile);
    if (
      currentTarget.resolvedPath !== nextResolvedPath &&
      await isFile(nextResolvedPath)
    ) {
      throw new Error(`Agent config file already exists: ${nextResolvedPath}`);
    }
    if (currentTarget.fileExists && currentTarget.resolvedPath !== nextResolvedPath) {
      await fs.mkdir(path.dirname(nextResolvedPath), { recursive: true });
      await fs.rename(currentTarget.resolvedPath, nextResolvedPath);
    }
  }

  let rawConfig = (await readGlobalConfigDocument()).raw;
  if (nextName !== originalName) {
    rawConfig = renameSection(rawConfig, ["agents", originalName], ["agents", nextName]);
  }

  const targetPath = ["agents", nextName];
  rawConfig = upsertValue(rawConfig, [...targetPath, "config_file"], nextConfigFile);
  const description = normalizeOptionalText(input.description);
  rawConfig =
    description === null
      ? removeValue(rawConfig, [...targetPath, "description"])
      : upsertValue(rawConfig, [...targetPath, "description"], description);

  if (nextName !== originalName) {
    rawConfig = removeValue(rawConfig, ["agents", originalName, "config_file"]);
    rawConfig = removeValue(rawConfig, ["agents", originalName, "description"]);
  }

  if ("developerInstructions" in input) {
    const nextInstructions = normalizeOptionalText(input.developerInstructions);
    const existingAgentConfig = await readUtf8IfExists(nextResolvedPath);
    const nextAgentConfig =
      nextInstructions === null
        ? removeValue(existingAgentConfig, ["developer_instructions"])
        : upsertValue(existingAgentConfig, ["developer_instructions"], nextInstructions);
    await writeUtf8(nextResolvedPath, nextAgentConfig);
  }

  await writeGlobalConfig(rawConfig);
  return getAgentsSettings();
}

export async function deleteAgent(input: DeleteAgentInput): Promise<AgentsSettings> {
  const name = normalizeAgentName(input.name);
  const settings = await getAgentsSettings();
  const currentAgent = settings.agents.find((agent) => agent.name === name);
  if (!currentAgent) {
    throw new Error(`Agent not found: ${name}`);
  }

  const target = await buildAgentFileTarget(name, currentAgent.configFile);
  let rawConfig = (await readGlobalConfigDocument()).raw;
  rawConfig = removeSection(rawConfig, ["agents", name]);
  rawConfig = removeValue(rawConfig, ["agents", name, "config_file"]);
  rawConfig = removeValue(rawConfig, ["agents", name, "description"]);
  await writeGlobalConfig(rawConfig);

  if (input.deleteManagedFile !== false && target.managedByApp && target.fileExists) {
    await fs.rm(target.resolvedPath, { force: true });
  }

  return getAgentsSettings();
}

export async function readAgentConfigToml(agentName: string): Promise<string> {
  const agent = await findAgentSummary(agentName);
  if (!agent) {
    throw new Error(`Agent not found: ${normalizeAgentName(agentName)}`);
  }
  if (!(await isFile(agent.resolvedPath))) {
    throw new Error(`Agent config file not found: ${agent.resolvedPath}`);
  }
  return fs.readFile(agent.resolvedPath, "utf8");
}

export async function getConfigModel(workspace?: WorkspaceEntry): Promise<string | null> {
  const candidatePaths = workspace
    ? [path.join(workspace.path, ".codex", "config.toml"), globalConfigPath()]
    : [globalConfigPath()];

  for (const candidatePath of candidatePaths) {
    const raw = await readUtf8IfExists(candidatePath);
    if (!raw) {
      continue;
    }
    const model = getLastString(parseTomlDocument(raw), ["model"]);
    if (model) {
      return model;
    }
  }

  return null;
}
