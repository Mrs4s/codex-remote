import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const serverDir = path.join(rootDir, "apps", "server");

loadDotEnv({ path: path.join(rootDir, ".env"), override: false });
loadDotEnv({ path: path.join(serverDir, ".env"), override: true });

export const env = {
  host: process.env.CODEX_REMOTE_HOST || "127.0.0.1",
  port: Number(process.env.CODEX_REMOTE_PORT || 8787),
  token: process.env.CODEX_REMOTE_TOKEN || "change-me",
  corsOrigin: process.env.CODEX_REMOTE_CORS_ORIGIN || "http://localhost:5173",
  dataDir: process.env.CODEX_REMOTE_DATA_DIR || path.join(rootDir, "data"),
  codexBin: process.env.CODEX_REMOTE_CODEX_BIN || "codex",
};
