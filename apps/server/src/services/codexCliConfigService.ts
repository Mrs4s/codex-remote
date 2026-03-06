import {
  normalizeCodexArgsInput,
  sanitizeRuntimeCodexArgs,
  tokenizeCodexArgs,
} from "@codex-remote/shared-types";
import type { JsonStore } from "../storage/jsonStore.js";

type RawSettings = {
  codexBin?: unknown;
  codexArgs?: unknown;
};

export type CodexLaunchConfig = {
  codexBin: string;
  codexArgs: string | null;
  codexArgsTokens: string[];
  fingerprint: string;
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildFingerprint(codexBin: string, codexArgs: string | null): string {
  return JSON.stringify({
    codexBin,
    codexArgs: codexArgs ?? null,
  });
}

export class CodexCliConfigService {
  private readonly runtimeCodexArgsByWorkspace = new Map<string, string | null>();

  constructor(
    private readonly store: JsonStore,
    private readonly defaultCodexBin: string,
  ) {}

  async getCodexBin(): Promise<string> {
    const settings = (await this.store.readSettings()) as RawSettings;
    return normalizeOptionalString(settings.codexBin) ?? this.defaultCodexBin;
  }

  getWorkspaceRuntimeCodexArgs(workspaceId: string): string | null {
    return this.runtimeCodexArgsByWorkspace.get(workspaceId) ?? null;
  }

  setWorkspaceRuntimeCodexArgs(workspaceId: string, codexArgs: string | null): string | null {
    const normalized = sanitizeRuntimeCodexArgs(normalizeCodexArgsInput(codexArgs));
    this.runtimeCodexArgsByWorkspace.set(workspaceId, normalized ?? null);
    return normalized ?? null;
  }

  clearWorkspaceRuntimeCodexArgs(workspaceId: string): void {
    this.runtimeCodexArgsByWorkspace.delete(workspaceId);
  }

  async resolveLaunchConfig(workspaceId: string): Promise<CodexLaunchConfig> {
    const settings = (await this.store.readSettings()) as RawSettings;
    const codexBin = normalizeOptionalString(settings.codexBin) ?? this.defaultCodexBin;
    const defaultCodexArgs = sanitizeRuntimeCodexArgs(
      normalizeCodexArgsInput(normalizeOptionalString(settings.codexArgs)),
    );
    const runtimeCodexArgs = this.runtimeCodexArgsByWorkspace.get(workspaceId);
    const codexArgs = runtimeCodexArgs ?? defaultCodexArgs ?? null;

    return {
      codexBin,
      codexArgs,
      codexArgsTokens: codexArgs ? tokenizeCodexArgs(codexArgs) : [],
      fingerprint: buildFingerprint(codexBin, codexArgs),
    };
  }
}
