import type { ServiceTier } from "@/types";

function normalizeModelId(model: string | null | undefined): string | null {
  if (typeof model !== "string") {
    return null;
  }
  const normalized = model.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function modelSupportsServiceTier(model: string | null | undefined): boolean {
  const normalized = normalizeModelId(model);
  return normalized === "gpt-5.4" || normalized?.startsWith("gpt-5.4-") === true;
}

export function resolveServiceTierForModel(
  model: string | null | undefined,
  serviceTier: ServiceTier | null | undefined,
): ServiceTier | null {
  if (!modelSupportsServiceTier(model)) {
    return null;
  }
  return serviceTier === "fast" || serviceTier === "flex" ? serviceTier : null;
}
