import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const DEFAULT_LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 1000;

const DEFAULT_PROVIDER_PREFIXES = [
  "anthropic/",
  "claude-3-5-",
  "claude-3-",
  "claude-",
  "openai/",
  "azure/",
  "openrouter/openai/",
];

export const liteLLMModelPricingSchema = z
  .object({
    input_cost_per_token: z.number().finite().nonnegative().optional(),
    output_cost_per_token: z.number().finite().nonnegative().optional(),
    cache_creation_input_token_cost: z.number().finite().nonnegative().optional(),
    cache_read_input_token_cost: z.number().finite().nonnegative().optional(),
    max_tokens: z.number().finite().nonnegative().optional(),
    max_input_tokens: z.number().finite().nonnegative().optional(),
    max_output_tokens: z.number().finite().nonnegative().optional(),
    input_cost_per_token_above_200k_tokens: z.number().finite().nonnegative().optional(),
    output_cost_per_token_above_200k_tokens: z.number().finite().nonnegative().optional(),
    cache_creation_input_token_cost_above_200k_tokens: z.number().finite().nonnegative().optional(),
    cache_read_input_token_cost_above_200k_tokens: z.number().finite().nonnegative().optional(),
    input_cost_per_token_above_128k_tokens: z.number().finite().nonnegative().optional(),
    output_cost_per_token_above_128k_tokens: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const persistedPricingSchema = z.object({
  version: z.literal(1),
  sourceUrl: z.string().min(1),
  fetchedAt: z.number().int().nonnegative(),
  models: z.record(z.string(), liteLLMModelPricingSchema),
});

export type LiteLLMModelPricing = z.infer<typeof liteLLMModelPricingSchema>;
export type LiteLLMPricingSource = "empty" | "disk" | "remote";

export type LiteLLMPricingCacheState = {
  modelCount: number;
  fetchedAt: number | null;
  expiresAt: number | null;
  stale: boolean;
  source: LiteLLMPricingSource;
};

type LiteLLMPricingLogger = {
  debug: (message: string, details?: unknown) => void;
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

const NOOP_LOGGER: LiteLLMPricingLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export type LiteLLMPricingServiceOptions = {
  dataDir: string;
  url?: string;
  ttlMs?: number;
  refreshIntervalMs?: number;
  requestTimeoutMs?: number;
  providerPrefixes?: string[];
  logger?: Partial<LiteLLMPricingLogger>;
};

function normalizeMs(value: number | undefined, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(Math.trunc(value), min);
}

function asMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mergeLogger(logger?: Partial<LiteLLMPricingLogger>): LiteLLMPricingLogger {
  if (!logger) {
    return NOOP_LOGGER;
  }
  return {
    debug: logger.debug ?? NOOP_LOGGER.debug,
    info: logger.info ?? NOOP_LOGGER.info,
    warn: logger.warn ?? NOOP_LOGGER.warn,
    error: logger.error ?? NOOP_LOGGER.error,
  };
}

export class LiteLLMPricingService {
  private readonly cacheFilePath: string;
  private readonly url: string;
  private readonly ttlMs: number;
  private readonly refreshIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly providerPrefixes: string[];
  private readonly logger: LiteLLMPricingLogger;

  private models = new Map<string, LiteLLMModelPricing>();
  private fetchedAt: number | null = null;
  private source: LiteLLMPricingSource = "empty";
  private refreshInFlight: Promise<Map<string, LiteLLMModelPricing>> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(options: LiteLLMPricingServiceOptions) {
    this.cacheFilePath = path.join(options.dataDir, "cache", "litellm-pricing.json");
    this.url = options.url ?? DEFAULT_LITELLM_PRICING_URL;
    this.ttlMs = normalizeMs(options.ttlMs, DEFAULT_CACHE_TTL_MS, 1_000);
    this.refreshIntervalMs = normalizeMs(
      options.refreshIntervalMs,
      DEFAULT_REFRESH_INTERVAL_MS,
      10_000,
    );
    this.requestTimeoutMs = normalizeMs(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      1_000,
    );
    this.providerPrefixes = options.providerPrefixes ?? DEFAULT_PROVIDER_PREFIXES;
    this.logger = mergeLogger(options.logger);
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
    await this.loadPersistedCache();
    this.startRefreshLoop();

    if (this.models.size === 0 || this.isExpired(Date.now())) {
      void this.refresh().catch((error) => {
        this.logger.warn("LiteLLM pricing warmup failed", asMessage(error));
      });
    }
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshInFlight = null;
  }

  getState(now = Date.now()): LiteLLMPricingCacheState {
    const expiresAt = this.fetchedAt === null ? null : this.fetchedAt + this.ttlMs;
    const stale = expiresAt !== null && now >= expiresAt;
    return {
      modelCount: this.models.size,
      fetchedAt: this.fetchedAt,
      expiresAt,
      stale,
      source: this.source,
    };
  }

  async getPricingMap(options?: {
    forceRefresh?: boolean;
    allowStale?: boolean;
  }): Promise<Map<string, LiteLLMModelPricing>> {
    const forceRefresh = options?.forceRefresh === true;
    const allowStale = options?.allowStale !== false;

    if (!forceRefresh && this.models.size > 0 && !this.isExpired(Date.now())) {
      return this.models;
    }

    try {
      return await this.refresh();
    } catch (error) {
      if (allowStale && this.models.size > 0) {
        this.logger.warn(
          "LiteLLM pricing refresh failed; falling back to stale cache",
          asMessage(error),
        );
        return this.models;
      }
      throw error;
    }
  }

  async getModelPricing(
    rawModelName: string,
    options?: {
      forceRefresh?: boolean;
      allowStale?: boolean;
    },
  ): Promise<LiteLLMModelPricing | null> {
    const modelName = rawModelName.trim();
    if (!modelName) {
      return null;
    }

    const pricing = await this.getPricingMap(options);
    for (const candidate of this.createMatchingCandidates(modelName)) {
      const exact = pricing.get(candidate);
      if (exact) {
        return exact;
      }
    }

    const lower = modelName.toLowerCase();
    for (const [candidate, value] of pricing) {
      const lookup = candidate.toLowerCase();
      if (lookup.includes(lower) || lower.includes(lookup)) {
        return value;
      }
    }
    return null;
  }

  async refresh(): Promise<Map<string, LiteLLMModelPricing>> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshFromRemote()
      .then(async ({ models, fetchedAt }) => {
        this.models = models;
        this.fetchedAt = fetchedAt;
        this.source = "remote";
        await this.persistCache();
        this.logger.info("LiteLLM pricing cache refreshed", {
          modelCount: this.models.size,
          fetchedAt: this.fetchedAt,
        });
        return this.models;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  private async loadPersistedCache(): Promise<void> {
    const raw = await fs.readFile(this.cacheFilePath, "utf8").catch(() => null);
    if (!raw) {
      return;
    }

    try {
      const parsed = persistedPricingSchema.parse(JSON.parse(raw));
      this.models = new Map(Object.entries(parsed.models));
      this.fetchedAt = parsed.fetchedAt;
      this.source = "disk";
      this.logger.info("Loaded LiteLLM pricing cache from disk", {
        modelCount: this.models.size,
        fetchedAt: this.fetchedAt,
      });
    } catch (error) {
      this.logger.warn("Ignoring invalid LiteLLM pricing cache file", asMessage(error));
    }
  }

  private async persistCache(): Promise<void> {
    if (this.fetchedAt === null || this.models.size === 0) {
      return;
    }

    const payload = {
      version: 1,
      sourceUrl: this.url,
      fetchedAt: this.fetchedAt,
      models: Object.fromEntries(this.models),
    } satisfies z.infer<typeof persistedPricingSchema>;

    const tempPath = `${this.cacheFilePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.cacheFilePath);
  }

  private startRefreshLoop(): void {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((error) => {
        this.logger.warn("LiteLLM pricing periodic refresh failed", asMessage(error));
      });
    }, this.refreshIntervalMs);
    this.refreshTimer.unref();
  }

  private async refreshFromRemote(): Promise<{
    models: Map<string, LiteLLMModelPricing>;
    fetchedAt: number;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();

    try {
      const response = await fetch(this.url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch LiteLLM pricing: ${response.status} ${response.statusText}`,
        );
      }

      const raw = (await response.json()) as unknown;
      const models = this.parseRemoteDataset(raw);
      return { models, fetchedAt: Date.now() };
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseRemoteDataset(raw: unknown): Map<string, LiteLLMModelPricing> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Unexpected LiteLLM pricing payload");
    }

    const models = new Map<string, LiteLLMModelPricing>();
    for (const [modelName, modelData] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = liteLLMModelPricingSchema.safeParse(modelData);
      if (parsed.success) {
        models.set(modelName, parsed.data);
      }
    }

    if (models.size === 0) {
      throw new Error("LiteLLM pricing payload did not include valid model entries");
    }
    return models;
  }

  private createMatchingCandidates(modelName: string): string[] {
    const candidates = new Set<string>();
    candidates.add(modelName);
    for (const prefix of this.providerPrefixes) {
      candidates.add(`${prefix}${modelName}`);
    }
    return Array.from(candidates);
  }

  private isExpired(now: number): boolean {
    if (this.fetchedAt === null) {
      return true;
    }
    return now - this.fetchedAt >= this.ttlMs;
  }
}
