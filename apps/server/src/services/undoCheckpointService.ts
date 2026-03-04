import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceEntry } from "../types/domain.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_CHECKPOINTS_PER_WORKSPACE = 10;
const MAX_LINE_RANGES_PER_FILE = 64;

export type UndoCheckpointStatus = "created" | "ready" | "undone" | "failed";

export type UndoLineRange = {
  kind: "add" | "del";
  start: number;
  end: number;
};

export type UndoEditedFileSummary = {
  path: string;
  additions: number;
  deletions: number;
  lineRanges: UndoLineRange[];
};

type UndoPatch = {
  path: string;
  kind: string | null;
  diff: string;
};

type UndoFileState = {
  path: string;
  exists: boolean;
  sha256: string | null;
};

type UndoCheckpointRecord = {
  id: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  status: UndoCheckpointStatus;
  createdAt: number;
  completedAt: number | null;
  undoneAt: number | null;
  failedAt: number | null;
  failureMessage: string | null;
  undoable: boolean;
  files: UndoEditedFileSummary[];
  outOfBandFiles: string[];
  patches: UndoPatch[];
  fileStatesAfterCompletion: UndoFileState[];
};

export type UndoCheckpointSummary = {
  id: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  status: UndoCheckpointStatus;
  createdAt: number;
  completedAt: number | null;
  undoneAt: number | null;
  failedAt: number | null;
  failureMessage: string | null;
  undoable: boolean;
  files: UndoEditedFileSummary[];
  outOfBandFiles: string[];
};

class UndoServiceError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "UndoServiceError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

function normalizePath(rawPath: string): string {
  let normalized = rawPath.trim().replace(/\\/g, "/");
  normalized = normalized.replace(/^\.\/+/, "");
  normalized = normalized.replace(/\/+/g, "/");
  normalized = normalized.replace(/^a\//, "");
  normalized = normalized.replace(/^b\//, "");
  return normalized;
}

function extractPathFromDiff(diff: string): string | null {
  if (!diff.trim()) {
    return null;
  }

  const lines = diff.split("\n");
  for (const line of lines) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line.trim());
    if (match?.[2]) {
      return normalizePath(match[2]);
    }
  }

  for (const line of lines) {
    const match = /^\+\+\+ (?:b\/)?(.+)$/.exec(line.trim());
    if (!match?.[1]) {
      continue;
    }
    const normalized = normalizePath(match[1]);
    if (normalized && normalized !== "/dev/null") {
      return normalized;
    }
  }

  return null;
}

function resolvePathWithinWorkspace(workspacePath: string, filePath: string): string | null {
  const root = path.resolve(workspacePath);
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return null;
  }
  const candidate = path.resolve(root, normalized);
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    return candidate;
  }
  return null;
}

function toSummary(entry: UndoCheckpointRecord): UndoCheckpointSummary {
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    status: entry.status,
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
    undoneAt: entry.undoneAt,
    failedAt: entry.failedAt,
    failureMessage: entry.failureMessage,
    undoable: entry.undoable,
    files: entry.files,
    outOfBandFiles: entry.outOfBandFiles,
  };
}

function buildLineRanges(lines: number[], kind: "add" | "del"): UndoLineRange[] {
  if (lines.length === 0) {
    return [];
  }
  const unique = Array.from(new Set(lines.filter((line) => Number.isFinite(line) && line > 0)));
  unique.sort((left, right) => left - right);

  const ranges: UndoLineRange[] = [];
  let start = unique[0];
  let end = unique[0];
  for (let index = 1; index < unique.length; index += 1) {
    const current = unique[index];
    if (current === end + 1) {
      end = current;
      continue;
    }
    ranges.push({ kind, start, end });
    start = current;
    end = current;
  }
  ranges.push({ kind, start, end });
  return ranges.slice(0, MAX_LINE_RANGES_PER_FILE);
}

function parseDiffSummary(diff: string): {
  additions: number;
  deletions: number;
  lineRanges: UndoLineRange[];
} {
  let additions = 0;
  let deletions = 0;
  const addLines: number[] = [];
  const delLines: number[] = [];
  const lines = diff.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      addLines.push(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
      delLines.push(oldLine);
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
  }

  return {
    additions,
    deletions,
    lineRanges: [...buildLineRanges(addLines, "add"), ...buildLineRanges(delLines, "del")],
  };
}

function summarizePatches(rawPatches: UndoPatch[]): UndoEditedFileSummary[] {
  const byPath = new Map<string, UndoEditedFileSummary>();
  for (const patch of rawPatches) {
    const pathFromDiff = extractPathFromDiff(patch.diff);
    const normalizedPath = normalizePath(pathFromDiff ?? patch.path);
    if (!normalizedPath || !patch.diff.trim()) {
      continue;
    }
    const parsed = parseDiffSummary(patch.diff);
    const existing = byPath.get(normalizedPath);
    if (!existing) {
      byPath.set(normalizedPath, {
        path: normalizedPath,
        additions: parsed.additions,
        deletions: parsed.deletions,
        lineRanges: parsed.lineRanges.slice(0, MAX_LINE_RANGES_PER_FILE),
      });
      continue;
    }
    const mergedRanges = [...existing.lineRanges, ...parsed.lineRanges].slice(
      0,
      MAX_LINE_RANGES_PER_FILE,
    );
    byPath.set(normalizedPath, {
      path: normalizedPath,
      additions: existing.additions + parsed.additions,
      deletions: existing.deletions + parsed.deletions,
      lineRanges: mergedRanges,
    });
  }
  return Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
}

async function hashFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return null;
    }
    const content = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

async function buildFileState(workspacePath: string, filePath: string): Promise<UndoFileState> {
  const normalized = normalizePath(filePath);
  const absolutePath = resolvePathWithinWorkspace(workspacePath, normalized);
  if (!absolutePath) {
    return {
      path: normalized,
      exists: false,
      sha256: null,
    };
  }
  const sha256 = await hashFile(absolutePath);
  return {
    path: normalized,
    exists: sha256 !== null,
    sha256,
  };
}

async function runGitApply(
  workspacePath: string,
  patchPath: string,
  args: string[],
): Promise<void> {
  await execFileAsync("git", [...args, patchPath], {
    cwd: workspacePath,
    env: process.env,
    maxBuffer: MAX_BUFFER_BYTES,
  });
}

async function applyPatchReverse(workspacePath: string, diff: string): Promise<void> {
  const patchPath = path.join(
    os.tmpdir(),
    `codex-remote-undo-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`,
  );
  await fs.writeFile(patchPath, diff, "utf8");
  try {
    const attempts: Array<{ strip: "-p1" | "-p0"; error: unknown | null }> = [
      { strip: "-p1", error: null },
      { strip: "-p0", error: null },
    ];
    for (const attempt of attempts) {
      const checkArgs = ["apply", "--check", "--unsafe-paths", "-R", attempt.strip];
      const applyArgs = ["apply", "--unsafe-paths", "-R", attempt.strip];
      try {
        await runGitApply(workspacePath, patchPath, checkArgs);
        await runGitApply(workspacePath, patchPath, applyArgs);
        return;
      } catch (error) {
        attempt.error = error;
      }
    }
    const message = attempts
      .map((attempt) => {
        const detail =
          attempt.error instanceof Error ? attempt.error.message : String(attempt.error);
        return `${attempt.strip}: ${detail}`;
      })
      .join("\n");
    throw new UndoServiceError(`Failed to apply reverse patch:\n${message}`);
  } finally {
    await fs.unlink(patchPath).catch(() => undefined);
  }
}

async function copyFileForUndoSimulation(
  sourceWorkspacePath: string,
  simulationRoot: string,
  relativePath: string,
): Promise<void> {
  const sourcePath = resolvePathWithinWorkspace(sourceWorkspacePath, relativePath);
  const targetPath = resolvePathWithinWorkspace(simulationRoot, relativePath);
  if (!sourcePath || !targetPath) {
    return;
  }
  let stat;
  try {
    stat = await fs.stat(sourcePath);
  } catch {
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

type ReverseSimulationResult =
  | { ok: true }
  | { ok: false; failedPath: string | null };

async function simulateReversePatchSequence(
  workspacePath: string,
  patches: UndoPatch[],
): Promise<ReverseSimulationResult> {
  if (patches.length === 0) {
    return { ok: true };
  }

  const simulationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-remote-undo-sim-"));
  try {
    const trackedPaths = Array.from(
      new Set(
        patches
          .map((patch) => normalizePath(extractPathFromDiff(patch.diff) ?? patch.path))
          .filter(Boolean),
      ),
    );
    for (const trackedPath of trackedPaths) {
      await copyFileForUndoSimulation(workspacePath, simulationRoot, trackedPath);
    }

    const reversedPatches = [...patches].reverse();
    for (const patch of reversedPatches) {
      try {
        await applyPatchReverse(simulationRoot, patch.diff);
      } catch (error) {
        const failedPath = normalizePath(extractPathFromDiff(patch.diff) ?? patch.path) || null;
        return {
          ok: false,
          failedPath,
        };
      }
    }
    return { ok: true };
  } finally {
    await fs.rm(simulationRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalizeLimit(limit?: number | null): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return MAX_CHECKPOINTS_PER_WORKSPACE;
  }
  return Math.max(1, Math.min(200, Math.trunc(limit)));
}

export class UndoCheckpointService {
  private readonly storePath: string;

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, "undo-checkpoints.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.access(this.storePath).catch(async () => {
      await fs.writeFile(this.storePath, "[]\n", "utf8");
    });
  }

  async createCheckpoint(input: {
    workspaceId: string;
    threadId: string;
    turnId: string;
  }): Promise<UndoCheckpointSummary> {
    const records = await this.readRecords();
    const now = Date.now();
    const entry: UndoCheckpointRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      turnId: input.turnId,
      status: "created",
      createdAt: now,
      completedAt: null,
      undoneAt: null,
      failedAt: null,
      failureMessage: null,
      undoable: false,
      files: [],
      outOfBandFiles: [],
      patches: [],
      fileStatesAfterCompletion: [],
    };
    records.push(entry);
    await this.writeRecords(this.trimRecords(records));
    return toSummary(entry);
  }

  async finalizeCheckpointReady(input: {
    checkpointId: string;
    workspacePath: string;
    patches: UndoPatch[];
    additionalChangedFiles?: string[];
  }): Promise<UndoCheckpointSummary | null> {
    const records = await this.readRecords();
    const target = records.find((entry) => entry.id === input.checkpointId);
    if (!target) {
      return null;
    }

    const cleanedPatches = input.patches
      .map((patch) => ({
        path: normalizePath(patch.path),
        kind: patch.kind ?? null,
        diff: String(patch.diff ?? ""),
      }))
      .filter((patch) => patch.path && patch.diff.trim().length > 0);
    const files = summarizePatches(cleanedPatches);
    const filePathSet = new Set(files.map((file) => normalizePath(file.path)).filter(Boolean));
    const outOfBandFiles = Array.from(
      new Set(
        (input.additionalChangedFiles ?? [])
          .map((filePath) => normalizePath(String(filePath ?? "")))
          .filter((filePath) => filePath && !filePathSet.has(filePath)),
      ),
    ).sort((left, right) => left.localeCompare(right));
    const reverseSimulation = await simulateReversePatchSequence(input.workspacePath, cleanedPatches);
    const nonReversibleFiles =
      reverseSimulation.ok || !reverseSimulation.failedPath ? [] : [reverseSimulation.failedPath];
    const fileStatesAfterCompletion = await Promise.all(
      files.map((file) => buildFileState(input.workspacePath, file.path)),
    );
    const hasReversibleEdits = cleanedPatches.length > 0;
    const hasIndirectFileEdits = outOfBandFiles.length > 0;
    const hasPatchMismatch = !reverseSimulation.ok;
    const warningParts: string[] = [];
    if (hasPatchMismatch) {
      warningParts.push(
        nonReversibleFiles.length > 0
          ? `Undo blocked: detected indirect edits in patched files (${nonReversibleFiles.join(", ")}).`
          : "Undo blocked: detected indirect edits in patched files.",
      );
    }
    if (hasIndirectFileEdits) {
      warningParts.push(
        `Undo blocked: detected additional edited files outside checkpoint (${outOfBandFiles.join(", ")}).`,
      );
    }
    const warningMessage = warningParts.join(" ");

    target.status = "ready";
    target.completedAt = Date.now();
    target.failedAt = null;
    target.failureMessage = warningMessage || null;
    target.undoable = hasReversibleEdits && !hasIndirectFileEdits && !hasPatchMismatch;
    target.files = files;
    target.outOfBandFiles = outOfBandFiles;
    target.patches = cleanedPatches;
    target.fileStatesAfterCompletion = fileStatesAfterCompletion;

    await this.writeRecords(this.trimRecords(records));
    return toSummary(target);
  }

  async finalizeCheckpointFailed(
    checkpointId: string,
    failureMessage: string,
  ): Promise<UndoCheckpointSummary | null> {
    const records = await this.readRecords();
    const target = records.find((entry) => entry.id === checkpointId);
    if (!target) {
      return null;
    }
    target.status = "failed";
    target.failedAt = Date.now();
    target.failureMessage = failureMessage.trim() || "Turn failed";
    target.undoable = false;
    target.files = [];
    target.outOfBandFiles = [];
    target.patches = [];
    target.fileStatesAfterCompletion = [];
    await this.writeRecords(this.trimRecords(records));
    return toSummary(target);
  }

  async listCheckpoints(
    workspaceId: string,
    options?: { threadId?: string | null; limit?: number | null },
  ): Promise<{ entries: UndoCheckpointSummary[] }> {
    const threadId = options?.threadId?.trim();
    const limit = normalizeLimit(options?.limit);
    const records = await this.readRecords();
    const entries = records
      .filter((entry) => entry.workspaceId === workspaceId)
      .filter((entry) => !threadId || entry.threadId === threadId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((entry) => toSummary(entry));
    return { entries };
  }

  async undoCheckpoint(
    workspace: WorkspaceEntry,
    checkpointId: string,
  ): Promise<UndoCheckpointSummary> {
    const records = await this.readRecords();
    const target = records.find(
      (entry) => entry.id === checkpointId && entry.workspaceId === workspace.id,
    );
    if (!target) {
      throw new UndoServiceError("Undo checkpoint not found");
    }
    if (target.status !== "ready") {
      throw new UndoServiceError("Only completed checkpoints can be undone");
    }
    if (!target.undoable || target.patches.length === 0) {
      throw new UndoServiceError("This checkpoint has no reversible edits");
    }

    const conflicts = await this.detectConflicts(workspace.path, target.fileStatesAfterCompletion);
    if (conflicts.length > 0) {
      throw new UndoServiceError(
        `Undo blocked because files changed after checkpoint: ${conflicts.join(", ")}`,
        {
          code: "UNDO_CONFLICT",
          details: { conflicts },
        },
      );
    }

    const reversedPatches = [...target.patches].reverse();
    for (const patch of reversedPatches) {
      await applyPatchReverse(workspace.path, patch.diff);
    }

    target.status = "undone";
    target.undoneAt = Date.now();
    target.undoable = false;
    await this.writeRecords(this.trimRecords(records));
    return toSummary(target);
  }

  private async detectConflicts(
    workspacePath: string,
    expectedStates: UndoFileState[],
  ): Promise<string[]> {
    const conflicts: string[] = [];
    for (const expected of expectedStates) {
      const current = await buildFileState(workspacePath, expected.path);
      const mismatch =
        current.exists !== expected.exists ||
        (current.exists && current.sha256 !== expected.sha256);
      if (mismatch) {
        conflicts.push(expected.path);
      }
    }
    return conflicts.sort((left, right) => left.localeCompare(right));
  }

  private trimRecords(records: UndoCheckpointRecord[]): UndoCheckpointRecord[] {
    const byWorkspace = new Map<string, UndoCheckpointRecord[]>();
    for (const entry of records) {
      const list = byWorkspace.get(entry.workspaceId) ?? [];
      list.push(entry);
      byWorkspace.set(entry.workspaceId, list);
    }

    const trimmed: UndoCheckpointRecord[] = [];
    for (const list of byWorkspace.values()) {
      const sorted = [...list].sort((left, right) => right.createdAt - left.createdAt);
      trimmed.push(...sorted.slice(0, MAX_CHECKPOINTS_PER_WORKSPACE));
    }

    return trimmed.sort((left, right) => left.createdAt - right.createdAt);
  }

  private async readRecords(): Promise<UndoCheckpointRecord[]> {
    const raw = await fs.readFile(this.storePath, "utf8").catch(() => "[]");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => this.parseRecord(entry))
      .filter((entry): entry is UndoCheckpointRecord => entry !== null);
  }

  private async writeRecords(records: UndoCheckpointRecord[]): Promise<void> {
    await fs.writeFile(this.storePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  private parseRecord(value: unknown): UndoCheckpointRecord | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    const statusRaw = String(record.status ?? "").trim();
    const status: UndoCheckpointStatus =
      statusRaw === "created" ||
      statusRaw === "ready" ||
      statusRaw === "undone" ||
      statusRaw === "failed"
        ? statusRaw
        : "failed";
    const id = String(record.id ?? "").trim();
    const workspaceId = String(record.workspaceId ?? "").trim();
    const threadId = String(record.threadId ?? "").trim();
    const turnId = String(record.turnId ?? "").trim();
    if (!id || !workspaceId || !threadId || !turnId) {
      return null;
    }
    const filesRaw = Array.isArray(record.files) ? record.files : [];
    const files = filesRaw
      .map((file) => {
        if (!file || typeof file !== "object") {
          return null;
        }
        const fileRecord = file as Record<string, unknown>;
        const lineRangesRaw = Array.isArray(fileRecord.lineRanges) ? fileRecord.lineRanges : [];
        const lineRanges = lineRangesRaw
          .map((lineRange) => {
            if (!lineRange || typeof lineRange !== "object") {
              return null;
            }
            const lineRangeRecord = lineRange as Record<string, unknown>;
            const kindRaw = String(lineRangeRecord.kind ?? "").trim();
            const kind = kindRaw === "add" || kindRaw === "del" ? kindRaw : null;
            const start = Number(lineRangeRecord.start);
            const end = Number(lineRangeRecord.end);
            if (!kind || !Number.isFinite(start) || !Number.isFinite(end)) {
              return null;
            }
            return {
              kind,
              start: Math.max(1, Math.trunc(start)),
              end: Math.max(1, Math.trunc(end)),
            } satisfies UndoLineRange;
          })
          .filter((lineRange): lineRange is UndoLineRange => Boolean(lineRange));
        const pathValue = normalizePath(String(fileRecord.path ?? ""));
        if (!pathValue) {
          return null;
        }
        return {
          path: pathValue,
          additions: Math.max(0, Math.trunc(Number(fileRecord.additions) || 0)),
          deletions: Math.max(0, Math.trunc(Number(fileRecord.deletions) || 0)),
          lineRanges,
        } satisfies UndoEditedFileSummary;
      })
      .filter((file): file is UndoEditedFileSummary => Boolean(file));
    const outOfBandFilesRaw = Array.isArray(record.outOfBandFiles) ? record.outOfBandFiles : [];
    const outOfBandFiles = outOfBandFilesRaw
      .map((value) => normalizePath(String(value ?? "")))
      .filter((value): value is string => Boolean(value));
    const patchesRaw = Array.isArray(record.patches) ? record.patches : [];
    const patches = patchesRaw
      .map((patch) => {
        if (!patch || typeof patch !== "object") {
          return null;
        }
        const patchRecord = patch as Record<string, unknown>;
        const pathValue = normalizePath(String(patchRecord.path ?? ""));
        const diff = String(patchRecord.diff ?? "");
        if (!pathValue || !diff.trim()) {
          return null;
        }
        return {
          path: pathValue,
          kind:
            typeof patchRecord.kind === "string" && patchRecord.kind.trim()
              ? patchRecord.kind
              : null,
          diff,
        } satisfies UndoPatch;
      })
      .filter((patch): patch is UndoPatch => Boolean(patch));
    const statesRaw = Array.isArray(record.fileStatesAfterCompletion)
      ? record.fileStatesAfterCompletion
      : [];
    const fileStatesAfterCompletion = statesRaw
      .map((state) => {
        if (!state || typeof state !== "object") {
          return null;
        }
        const stateRecord = state as Record<string, unknown>;
        const filePath = normalizePath(String(stateRecord.path ?? ""));
        if (!filePath) {
          return null;
        }
        return {
          path: filePath,
          exists: Boolean(stateRecord.exists),
          sha256:
            typeof stateRecord.sha256 === "string" && stateRecord.sha256.trim()
              ? stateRecord.sha256
              : null,
        } satisfies UndoFileState;
      })
      .filter((state): state is UndoFileState => Boolean(state));

    const toNullableTimestamp = (rawValue: unknown): number | null => {
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value <= 0) {
        return null;
      }
      return Math.trunc(value);
    };

    const createdAt = toNullableTimestamp(record.createdAt) ?? Date.now();
    return {
      id,
      workspaceId,
      threadId,
      turnId,
      status,
      createdAt,
      completedAt: toNullableTimestamp(record.completedAt),
      undoneAt: toNullableTimestamp(record.undoneAt),
      failedAt: toNullableTimestamp(record.failedAt),
      failureMessage:
        typeof record.failureMessage === "string" && record.failureMessage.trim()
          ? record.failureMessage
          : null,
      undoable: Boolean(record.undoable),
      files,
      outOfBandFiles,
      patches,
      fileStatesAfterCompletion,
    };
  }
}
