import type { ServiceTier } from "@/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEffort(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "default" || normalized === "unknown") {
    return null;
  }
  return normalized;
}

function normalizeServiceTier(value: string | null): ServiceTier | null {
  if (value === "fast" || value === "flex") {
    return value;
  }
  return null;
}

function pickString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

const MODEL_KEYS = [
  "modelId",
  "model_id",
  "model",
  "modelName",
  "model_name",
] as const;

const EFFORT_KEYS = [
  "effort",
  "reasoningEffort",
  "reasoning_effort",
  "modelReasoningEffort",
  "model_reasoning_effort",
] as const;

const SERVICE_TIER_KEYS = [
  "serviceTier",
  "service_tier",
  "modelServiceTier",
  "model_service_tier",
] as const;

function extractFromRecord(record: Record<string, unknown>): {
  modelId: string | null;
  effort: string | null;
  serviceTier: ServiceTier | null;
} {
  const payload = asRecord(record.payload);
  const containers = [
    record,
    payload,
    asRecord(payload?.info),
    asRecord(record.info),
    asRecord(record.metadata),
    asRecord(record.context),
    asRecord(record.turnContext),
    asRecord(record.turn_context),
    asRecord(record.params),
    asRecord(record.settings),
    asRecord(record.config),
  ].filter((value): value is Record<string, unknown> => value !== null);

  let modelId: string | null = null;
  let effort: string | null = null;
  let serviceTier: ServiceTier | null = null;

  for (const container of containers) {
    if (!modelId) {
      modelId = pickString(container, MODEL_KEYS);
    }
    if (!effort) {
      effort = normalizeEffort(pickString(container, EFFORT_KEYS));
    }
    if (!serviceTier) {
      serviceTier = normalizeServiceTier(pickString(container, SERVICE_TIER_KEYS));
    }
    if (modelId && effort && serviceTier) {
      break;
    }
  }

  return { modelId, effort, serviceTier };
}

function extractFromTurn(turn: Record<string, unknown>): {
  modelId: string | null;
  effort: string | null;
  serviceTier: ServiceTier | null;
} {
  let modelId: string | null = null;
  let effort: string | null = null;
  let serviceTier: ServiceTier | null = null;

  const turnLevel = extractFromRecord(turn);
  modelId = turnLevel.modelId;
  effort = turnLevel.effort;
  serviceTier = turnLevel.serviceTier;

  const items = Array.isArray(turn.items)
    ? (turn.items as unknown[])
    : [];

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = asRecord(items[index]);
    if (!item) {
      continue;
    }
    const extracted = extractFromRecord(item);
    if (!modelId && extracted.modelId) {
      modelId = extracted.modelId;
    }
    if (!effort && extracted.effort) {
      effort = extracted.effort;
    }
    if (!serviceTier && extracted.serviceTier) {
      serviceTier = extracted.serviceTier;
    }
    if (modelId && effort && serviceTier) {
      break;
    }
  }

  return { modelId, effort, serviceTier };
}

export function extractThreadCodexMetadata(thread: Record<string, unknown>): {
  modelId: string | null;
  effort: string | null;
  serviceTier: ServiceTier | null;
} {
  let modelId: string | null = null;
  let effort: string | null = null;
  let serviceTier: ServiceTier | null = null;

  const turns = Array.isArray(thread.turns)
    ? (thread.turns as unknown[])
    : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index]);
    if (!turn) {
      continue;
    }
    const extracted = extractFromTurn(turn);
    if (!modelId && extracted.modelId) {
      modelId = extracted.modelId;
    }
    if (!effort && extracted.effort) {
      effort = extracted.effort;
    }
    if (!serviceTier && extracted.serviceTier) {
      serviceTier = extracted.serviceTier;
    }
    if (modelId && effort && serviceTier) {
      break;
    }
  }

  if (!modelId || !effort || !serviceTier) {
    const threadLevel = extractFromRecord(thread);
    if (!modelId) {
      modelId = threadLevel.modelId;
    }
    if (!effort) {
      effort = threadLevel.effort;
    }
    if (!serviceTier) {
      serviceTier = threadLevel.serviceTier;
    }
  }

  return { modelId, effort, serviceTier };
}
