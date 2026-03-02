import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const serverDir = path.join(rootDir, "apps", "server");
const DEFAULT_LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

loadDotEnv({ path: path.join(rootDir, ".env"), override: false });
loadDotEnv({ path: path.join(serverDir, ".env"), override: true });

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

export const env = {
  host: process.env.CODEX_REMOTE_HOST || "127.0.0.1",
  port: Number(process.env.CODEX_REMOTE_PORT || 8787),
  token: process.env.CODEX_REMOTE_TOKEN || "change-me",
  corsOrigin: process.env.CODEX_REMOTE_CORS_ORIGIN || "http://localhost:5173",
  dataDir: process.env.CODEX_REMOTE_DATA_DIR || path.join(rootDir, "data"),
  codexBin: process.env.CODEX_REMOTE_CODEX_BIN || "codex",
  webDistDir:
    process.env.CODEX_REMOTE_WEB_DIST_DIR || path.join(rootDir, "apps", "web", "dist"),
  litellmPricingUrl: process.env.CODEX_REMOTE_LITELLM_PRICING_URL || DEFAULT_LITELLM_PRICING_URL,
  litellmPricingTtlMs: readPositiveInteger(
    process.env.CODEX_REMOTE_LITELLM_PRICING_TTL_MS,
    5 * 60 * 1000,
  ),
  litellmPricingRefreshIntervalMs: readPositiveInteger(
    process.env.CODEX_REMOTE_LITELLM_PRICING_REFRESH_INTERVAL_MS,
    5 * 60 * 1000,
  ),
  litellmPricingRequestTimeoutMs: readPositiveInteger(
    process.env.CODEX_REMOTE_LITELLM_PRICING_REQUEST_TIMEOUT_MS,
    10 * 1000,
  ),
};
