import fs from "node:fs/promises";
import { createReadStream, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type {
  LiteLLMModelPricing,
  LiteLLMPricingService,
} from "./litellmPricingService.js";

type LocalUsageDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  agentTimeMs: number;
  agentRuns: number;
};

type LocalUsageTotals = {
  last7DaysTokens: number;
  last30DaysTokens: number;
  averageDailyTokens: number;
  cacheHitRatePercent: number;
  peakDay: string | null;
  peakDayTokens: number;
};

type LocalUsageModel = {
  model: string;
  tokens: number;
  sharePercent: number;
};

export type LocalUsageSnapshot = {
  updatedAt: number;
  days: LocalUsageDay[];
  totals: LocalUsageTotals;
  topModels: LocalUsageModel[];
};

export type LocalUsageCostDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  cachedInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

export type LocalUsageCostSnapshot = {
  updatedAt: number;
  days: LocalUsageCostDay[];
  pricingFetchedAt: number | null;
  pricingSource: "empty" | "disk" | "remote";
  missingPricingModels: string[];
};

type DailyTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  agentTimeMs: number;
  agentRuns: number;
};

type UsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type ScanUsageResult = {
  updatedAt: number;
  dayKeys: string[];
  daily: Map<string, DailyTotals>;
  modelTotals: Map<string, number>;
  dailyModelTotals: Map<string, Map<string, UsageTotals>> | null;
};

const CODEX_MODEL_ALIASES_MAP = new Map<string, string>([
  ["gpt-5-codex", "gpt-5"],
  ["gpt-5.3-codex", "gpt-5.2-codex"],
]);

const MAX_ACTIVITY_GAP_MS = 2 * 60 * 1000;
const MAX_LINE_CHARS = 512_000;

function defaultDailyTotals(): DailyTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    agentTimeMs: 0,
    agentRuns: 0,
  };
}

function defaultUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
}

function isOpenRouterFreeModel(rawModel: string): boolean {
  const model = rawModel.trim().toLowerCase();
  if (model === "openrouter/free") {
    return true;
  }
  return model.startsWith("openrouter/") && model.endsWith(":free");
}

function hasNonZeroTokenPricing(pricing: LiteLLMModelPricing | null): boolean {
  if (!pricing) {
    return false;
  }
  return (
    (pricing.input_cost_per_token ?? 0) > 0 ||
    (pricing.output_cost_per_token ?? 0) > 0 ||
    (pricing.cache_read_input_token_cost ?? 0) > 0
  );
}

function addUsageTotals(target: UsageTotals, delta: UsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
}

function normalizeWorkspacePath(workspacePath?: string | null): string | null {
  const value = workspacePath?.trim();
  if (!value) {
    return null;
  }
  return path.resolve(value);
}

function resolveDefaultCodexHome(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".codex");
}

function resolveSessionsRoots(workspacePath: string | null): string[] {
  void workspacePath;
  return [path.join(resolveDefaultCodexHome(), "sessions")];
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeDayKeys(days: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    keys.push(formatDayKey(day));
  }
  return keys;
}

function dayKeyForTimestampMs(timestampMs: number): string | null {
  const value = new Date(timestampMs);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return formatDayKey(value);
}

function dayDirForKey(root: string, dayKey: string): string {
  const [year = "1970", month = "01", day = "01"] = dayKey.split("-");
  return path.join(root, year, month, day);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readI64(map: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const raw = map[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.trunc(raw);
    }
  }
  return 0;
}

function readTimestampMs(value: Record<string, unknown>): number | null {
  const raw = value.timestamp;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  const numeric = Math.trunc(raw);
  if (numeric > 0 && numeric < 1_000_000_000_000) {
    return numeric * 1000;
  }
  return numeric;
}

function extractCwd(value: Record<string, unknown>): string | null {
  const payload = asRecord(value.payload);
  const cwd = payload?.cwd;
  return typeof cwd === "string" ? cwd : null;
}

function extractModelFromTurnContext(value: Record<string, unknown>): string | null {
  const payload = asRecord(value.payload);
  if (!payload) {
    return null;
  }
  if (typeof payload.model === "string") {
    return payload.model;
  }
  const info = asRecord(payload.info);
  return typeof info?.model === "string" ? info.model : null;
}

function extractModelFromTokenCount(value: Record<string, unknown>): string | null {
  const payload = asRecord(value.payload);
  const info = asRecord(payload?.info);
  const model =
    (typeof info?.model === "string" ? info.model : null) ??
    (typeof info?.model_name === "string" ? info.model_name : null) ??
    (typeof payload?.model === "string" ? payload.model : null) ??
    (typeof value.model === "string" ? value.model : null);
  return model;
}

function findUsageMap(
  info: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!info) {
    return null;
  }
  for (const key of keys) {
    const candidate = asRecord(info[key]);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function pathMatchesWorkspace(cwd: string, workspacePath: string): boolean {
  const cwdPath = path.resolve(cwd);
  const workspace = path.resolve(workspacePath);
  if (cwdPath === workspace) {
    return true;
  }
  const relative = path.relative(workspace, cwdPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function trackActivity(
  daily: Map<string, DailyTotals>,
  lastActivityMs: { value: number | null },
  timestampMs: number,
): void {
  const previous = lastActivityMs.value;
  if (previous !== null) {
    const delta = timestampMs - previous;
    if (delta > 0 && delta <= MAX_ACTIVITY_GAP_MS) {
      const dayKey = dayKeyForTimestampMs(timestampMs);
      if (dayKey) {
        const entry = daily.get(dayKey);
        if (entry) {
          entry.agentTimeMs += delta;
        }
      }
    }
  }
  lastActivityMs.value = timestampMs;
}

function bumpAgentRuns(
  daily: Map<string, DailyTotals>,
  seenRuns: Set<number>,
  timestampMs: number,
): void {
  if (seenRuns.has(timestampMs)) {
    return;
  }
  seenRuns.add(timestampMs);
  const dayKey = dayKeyForTimestampMs(timestampMs);
  if (!dayKey) {
    return;
  }
  const entry = daily.get(dayKey);
  if (entry) {
    entry.agentRuns += 1;
  }
}

async function scanFile(
  filePath: string,
  daily: Map<string, DailyTotals>,
  modelTotals: Map<string, number>,
  workspacePath: string | null,
  dailyModelTotals: Map<string, Map<string, UsageTotals>> | null,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let previousTotals: UsageTotals | null = null;
  let currentModel: string | null = null;
  const lastActivityMs = { value: null as number | null };
  const seenRuns = new Set<number>();
  let matchKnown = workspacePath === null;
  let matchesWorkspace = workspacePath === null;

  try {
    for await (const line of reader) {
      if (line.length > MAX_LINE_CHARS) {
        continue;
      }

      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(line) as unknown;
      } catch {
        continue;
      }

      const value = asRecord(parsedValue);
      if (!value) {
        continue;
      }

      const entryType = typeof value.type === "string" ? value.type : "";

      if (entryType === "session_meta" || entryType === "turn_context") {
        const cwd = extractCwd(value);
        if (cwd && workspacePath) {
          matchesWorkspace = pathMatchesWorkspace(cwd, workspacePath);
          matchKnown = true;
          if (!matchesWorkspace) {
            break;
          }
        }
      }

      if (entryType === "turn_context") {
        const model = extractModelFromTurnContext(value);
        if (model) {
          currentModel = model;
        }
        continue;
      }

      if (entryType === "session_meta") {
        continue;
      }

      if (!matchesWorkspace) {
        if (matchKnown) {
          break;
        }
        continue;
      }

      if (!matchKnown) {
        continue;
      }

      if (entryType === "event_msg" || entryType === "") {
        const payload = asRecord(value.payload);
        const payloadType = typeof payload?.type === "string" ? payload.type : null;

        if (payloadType === "agent_message") {
          const timestampMs = readTimestampMs(value);
          if (timestampMs !== null) {
            bumpAgentRuns(daily, seenRuns, timestampMs);
            trackActivity(daily, lastActivityMs, timestampMs);
          }
          continue;
        }

        if (payloadType === "agent_reasoning") {
          const timestampMs = readTimestampMs(value);
          if (timestampMs !== null) {
            trackActivity(daily, lastActivityMs, timestampMs);
          }
          continue;
        }

        if (payloadType !== "token_count") {
          continue;
        }

        const info = asRecord(payload?.info);
        let usageMap = findUsageMap(info, ["total_token_usage", "totalTokenUsage"]);
        const usedTotal = Boolean(usageMap);
        if (!usageMap) {
          usageMap = findUsageMap(info, ["last_token_usage", "lastTokenUsage"]);
        }
        if (!usageMap) {
          continue;
        }

        const inputTokens = readI64(usageMap, ["input_tokens", "inputTokens"]);
        const cachedInputTokens = readI64(usageMap, [
          "cached_input_tokens",
          "cache_read_input_tokens",
          "cachedInputTokens",
          "cacheReadInputTokens",
        ]);
        const outputTokens = readI64(usageMap, ["output_tokens", "outputTokens"]);

        let delta: UsageTotals = {
          inputTokens,
          cachedInputTokens,
          outputTokens,
        };

        if (usedTotal) {
          const previous = previousTotals ?? defaultUsageTotals();
          delta = {
            inputTokens: Math.max(inputTokens - previous.inputTokens, 0),
            cachedInputTokens: Math.max(cachedInputTokens - previous.cachedInputTokens, 0),
            outputTokens: Math.max(outputTokens - previous.outputTokens, 0),
          };
          previousTotals = {
            inputTokens,
            cachedInputTokens,
            outputTokens,
          };
        } else {
          const next: UsageTotals = previousTotals ?? defaultUsageTotals();
          next.inputTokens += delta.inputTokens;
          next.cachedInputTokens += delta.cachedInputTokens;
          next.outputTokens += delta.outputTokens;
          previousTotals = next;
        }

        if (
          delta.inputTokens === 0 &&
          delta.cachedInputTokens === 0 &&
          delta.outputTokens === 0
        ) {
          continue;
        }

        const timestampMs = readTimestampMs(value);
        if (timestampMs !== null) {
          const dayKey = dayKeyForTimestampMs(timestampMs);
          if (dayKey) {
            const day = daily.get(dayKey);
            if (day) {
              const cached = Math.min(delta.cachedInputTokens, delta.inputTokens);
              const model = currentModel ?? extractModelFromTokenCount(value) ?? "unknown";
              day.inputTokens += delta.inputTokens;
              day.cachedInputTokens += cached;
              day.outputTokens += delta.outputTokens;

              modelTotals.set(
                model,
                (modelTotals.get(model) ?? 0) + delta.inputTokens + delta.outputTokens,
              );

              if (dailyModelTotals) {
                const dayModels =
                  dailyModelTotals.get(dayKey) ?? new Map<string, UsageTotals>();
                const modelUsage = dayModels.get(model) ?? defaultUsageTotals();
                addUsageTotals(modelUsage, {
                  inputTokens: delta.inputTokens,
                  cachedInputTokens: cached,
                  outputTokens: delta.outputTokens,
                });
                dayModels.set(model, modelUsage);
                dailyModelTotals.set(dayKey, dayModels);
              }
            }
          }
          trackActivity(daily, lastActivityMs, timestampMs);
        }

        continue;
      }

      if (entryType === "response_item") {
        const payload = asRecord(value.payload);
        const payloadType = typeof payload?.type === "string" ? payload.type : null;
        const role = typeof payload?.role === "string" ? payload.role : "";

        if (role === "assistant") {
          const timestampMs = readTimestampMs(value);
          if (timestampMs !== null) {
            bumpAgentRuns(daily, seenRuns, timestampMs);
            trackActivity(daily, lastActivityMs, timestampMs);
          }
        } else if (payloadType !== "message") {
          const timestampMs = readTimestampMs(value);
          if (timestampMs !== null) {
            trackActivity(daily, lastActivityMs, timestampMs);
          }
        }
      }
    }
  } finally {
    reader.close();
    stream.close();
  }
}

function buildSnapshot(
  updatedAt: number,
  dayKeys: string[],
  daily: Map<string, DailyTotals>,
  modelTotals: Map<string, number>,
): LocalUsageSnapshot {
  const days: LocalUsageDay[] = [];
  let totalTokens = 0;

  for (const dayKey of dayKeys) {
    const totals = daily.get(dayKey) ?? defaultDailyTotals();
    const total = totals.inputTokens + totals.outputTokens;
    totalTokens += total;
    days.push({
      day: dayKey,
      inputTokens: totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: total,
      agentTimeMs: totals.agentTimeMs,
      agentRuns: totals.agentRuns,
    });
  }

  const last7 = days.slice(-7);
  const last7DaysTokens = last7.reduce((sum, day) => sum + day.totalTokens, 0);
  const last7InputTokens = last7.reduce((sum, day) => sum + day.inputTokens, 0);
  const last7CachedTokens = last7.reduce((sum, day) => sum + day.cachedInputTokens, 0);
  const averageDailyTokens = last7.length > 0 ? Math.round(last7DaysTokens / last7.length) : 0;
  const cacheHitRatePercent =
    last7InputTokens > 0 ? Math.round((last7CachedTokens / last7InputTokens) * 1000) / 10 : 0;

  let peakDay: string | null = null;
  let peakDayTokens = 0;
  for (const day of days) {
    if (day.totalTokens > peakDayTokens) {
      peakDay = day.day;
      peakDayTokens = day.totalTokens;
    }
  }
  if (peakDayTokens <= 0) {
    peakDay = null;
    peakDayTokens = 0;
  }

  const topModels = [...modelTotals.entries()]
    .filter(([model, tokens]) => model !== "unknown" && tokens > 0)
    .map(([model, tokens]) => ({
      model,
      tokens,
      sharePercent: totalTokens > 0 ? Math.round((tokens / totalTokens) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4);

  return {
    updatedAt,
    days,
    totals: {
      last7DaysTokens,
      last30DaysTokens: totalTokens,
      averageDailyTokens,
      cacheHitRatePercent,
      peakDay,
      peakDayTokens,
    },
    topModels,
  };
}

async function scanUsage(
  days: number,
  workspacePath: string | null,
  options?: { includeDailyModelTotals?: boolean },
): Promise<ScanUsageResult> {
  const updatedAt = Date.now();
  const dayKeys = makeDayKeys(days);
  const daily = new Map<string, DailyTotals>(
    dayKeys.map((dayKey) => [dayKey, defaultDailyTotals()]),
  );
  const modelTotals = new Map<string, number>();
  const dailyModelTotals = options?.includeDailyModelTotals
    ? new Map<string, Map<string, UsageTotals>>()
    : null;
  const sessionsRoots = resolveSessionsRoots(workspacePath);

  for (const root of sessionsRoots) {
    for (const dayKey of dayKeys) {
      const dayDir = dayDirForKey(root, dayKey);
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dayDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name) !== ".jsonl") {
          continue;
        }
        await scanFile(
          path.join(dayDir, entry.name),
          daily,
          modelTotals,
          workspacePath,
          dailyModelTotals,
        );
      }
    }
  }

  return {
    updatedAt,
    dayKeys,
    daily,
    modelTotals,
    dailyModelTotals,
  };
}

type ResolvedModelPricing = {
  inputCostPerToken: number;
  cachedInputCostPerToken: number;
  outputCostPerToken: number;
  found: boolean;
};

async function resolveModelPricing(
  model: string,
  pricingService: LiteLLMPricingService,
): Promise<ResolvedModelPricing> {
  if (isOpenRouterFreeModel(model)) {
    return {
      inputCostPerToken: 0,
      cachedInputCostPerToken: 0,
      outputCostPerToken: 0,
      found: true,
    };
  }

  let pricing: LiteLLMModelPricing | null = null;
  try {
    pricing = await pricingService.getModelPricing(model, { allowStale: true });
    const alias = CODEX_MODEL_ALIASES_MAP.get(model);
    if (alias && !hasNonZeroTokenPricing(pricing)) {
      const aliasPricing = await pricingService.getModelPricing(alias, {
        allowStale: true,
      });
      if (hasNonZeroTokenPricing(aliasPricing)) {
        pricing = aliasPricing;
      }
    }
  } catch {
    pricing = null;
  }

  if (!pricing) {
    return {
      inputCostPerToken: 0,
      cachedInputCostPerToken: 0,
      outputCostPerToken: 0,
      found: false,
    };
  }

  const input = pricing.input_cost_per_token ?? 0;
  const cached = pricing.cache_read_input_token_cost ?? input;
  const output = pricing.output_cost_per_token ?? 0;
  return {
    inputCostPerToken: input,
    cachedInputCostPerToken: cached,
    outputCostPerToken: output,
    found: true,
  };
}

function roundUsd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

export async function localUsageSnapshot(
  days?: number | null,
  workspacePath?: string | null,
): Promise<LocalUsageSnapshot> {
  const safeDays = Math.min(Math.max(Math.trunc(days ?? 30), 1), 90);
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  const scanned = await scanUsage(safeDays, normalizedWorkspacePath);
  return buildSnapshot(
    scanned.updatedAt,
    scanned.dayKeys,
    scanned.daily,
    scanned.modelTotals,
  );
}

export async function localUsageCostSnapshot(
  pricingService: LiteLLMPricingService,
  days?: number | null,
  workspacePath?: string | null,
): Promise<LocalUsageCostSnapshot> {
  const safeDays = Math.min(Math.max(Math.trunc(days ?? 365), 1), 365);
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  const scanned = await scanUsage(safeDays, normalizedWorkspacePath, {
    includeDailyModelTotals: true,
  });
  const dailyModelTotals = scanned.dailyModelTotals ?? new Map<string, Map<string, UsageTotals>>();
  const uniqueModels = new Set<string>();
  for (const modelMap of dailyModelTotals.values()) {
    for (const model of modelMap.keys()) {
      if (model && model !== "unknown") {
        uniqueModels.add(model);
      }
    }
  }

  const pricingByModel = new Map<string, ResolvedModelPricing>();
  await Promise.all(
    [...uniqueModels].map(async (model) => {
      pricingByModel.set(model, await resolveModelPricing(model, pricingService));
    }),
  );

  const missingModelSet = new Set<string>();
  const daysRows: LocalUsageCostDay[] = scanned.dayKeys.map((dayKey) => {
    const totals = scanned.daily.get(dayKey) ?? defaultDailyTotals();
    const dayModels = dailyModelTotals.get(dayKey) ?? new Map<string, UsageTotals>();

    let inputCostUsd = 0;
    let cachedInputCostUsd = 0;
    let outputCostUsd = 0;

    for (const [model, usage] of dayModels.entries()) {
      if (!model || model === "unknown") {
        continue;
      }
      const pricing = pricingByModel.get(model);
      if (!pricing) {
        missingModelSet.add(model);
        continue;
      }
      if (!pricing.found) {
        missingModelSet.add(model);
      }

      const cachedInputTokens = Math.min(
        Math.max(usage.cachedInputTokens, 0),
        Math.max(usage.inputTokens, 0),
      );
      const nonCachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
      const outputTokens = Math.max(usage.outputTokens, 0);

      inputCostUsd += nonCachedInputTokens * pricing.inputCostPerToken;
      cachedInputCostUsd += cachedInputTokens * pricing.cachedInputCostPerToken;
      outputCostUsd += outputTokens * pricing.outputCostPerToken;
    }

    return {
      day: dayKey,
      inputTokens: totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.inputTokens + totals.outputTokens,
      inputCostUsd: roundUsd(inputCostUsd),
      cachedInputCostUsd: roundUsd(cachedInputCostUsd),
      outputCostUsd: roundUsd(outputCostUsd),
      totalCostUsd: roundUsd(inputCostUsd + cachedInputCostUsd + outputCostUsd),
    };
  });

  const pricingState = pricingService.getState();
  return {
    updatedAt: scanned.updatedAt,
    days: daysRows,
    pricingFetchedAt: pricingState.fetchedAt,
    pricingSource: pricingState.source,
    missingPricingModels: [...missingModelSet].sort().slice(0, 50),
  };
}
