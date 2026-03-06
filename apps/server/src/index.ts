import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "./config/env.js";
import { JsonStore } from "./storage/jsonStore.js";
import { EventBus } from "./events/eventBus.js";
import { WorkspaceService } from "./services/workspaceService.js";
import { SessionManager } from "./services/sessionManager.js";
import { TerminalService } from "./services/terminalService.js";
import { PromptService } from "./services/promptService.js";
import { DictationService } from "./services/dictationService.js";
import { LiteLLMPricingService } from "./services/litellmPricingService.js";
import { UndoCheckpointService } from "./services/undoCheckpointService.js";
import { McpManagerService } from "./services/mcpManagerService.js";
import { CodexCliConfigService } from "./services/codexCliConfigService.js";
import { dispatchRpc } from "./rpc/dispatcher.js";

const app = Fastify({ logger: true });

const store = new JsonStore(env.dataDir);
const eventBus = new EventBus();
const workspaceService = new WorkspaceService(store);
const undoCheckpointService = new UndoCheckpointService(env.dataDir);
const codexCliConfigService = new CodexCliConfigService(store, env.codexBin);
const sessionManager = new SessionManager(eventBus, codexCliConfigService, undoCheckpointService);
const terminalService = new TerminalService(eventBus);
const promptService = new PromptService(env.dataDir);
const dictationService = new DictationService(eventBus);
const mcpManagerService = new McpManagerService(() => codexCliConfigService.getCodexBin());
const litellmPricingService = new LiteLLMPricingService({
  dataDir: env.dataDir,
  url: env.litellmPricingUrl,
  ttlMs: env.litellmPricingTtlMs,
  refreshIntervalMs: env.litellmPricingRefreshIntervalMs,
  requestTimeoutMs: env.litellmPricingRequestTimeoutMs,
  logger: {
    debug: (message, details) => app.log.debug({ details }, message),
    info: (message, details) => app.log.info({ details }, message),
    warn: (message, details) => app.log.warn({ details }, message),
    error: (message, details) => app.log.error({ details }, message),
  },
});
const webDistDir = path.resolve(env.webDistDir);
const webIndexPath = path.join(webDistDir, "index.html");
const hasWebDist = fs.existsSync(webIndexPath);

await app.register(cors, {
  origin: env.corsOrigin.split(",").map((value) => value.trim()),
  credentials: false,
});

await store.init();
await workspaceService.load();
await litellmPricingService.init();
await undoCheckpointService.init();

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health" || !request.url.startsWith("/api/v1/")) {
    return;
  }
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "")?.trim();
  const queryToken = (request.query as { token?: string } | undefined)?.token?.trim();
  const token = bearer || queryToken;
  if (token !== env.token) {
    reply.code(401).send({ error: { message: "unauthorized" } });
  }
});

app.get("/health", async () => ({
  ok: true,
  now: Date.now(),
  litellmPricing: litellmPricingService.getState(),
}));

app.get("/api/v1/events", async (request, reply) => {
  eventBus.attach(request, reply);
  return reply;
});

app.post("/api/v1/rpc/:method", async (request, reply) => {
  const method = String((request.params as { method?: string }).method ?? "");
  const params = (request.body ?? {}) as Record<string, unknown>;

  try {
    const result = await dispatchRpc(
      {
        workspaceService,
        sessionManager,
        terminalService,
        promptService,
        dictationService,
        mcpManagerService,
        litellmPricingService,
        undoCheckpointService,
        store,
      },
      method,
      params,
    );
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    const details =
      error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
    reply.code(400);
    return {
      error: {
        message,
        ...(code ? { code } : {}),
        ...(details !== undefined ? { details } : {}),
      },
    };
  }
});

const getContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".map":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
};

const sendFile = async (reply: FastifyReply, filePath: string) => {
  const content = await readFile(filePath);
  reply.type(getContentType(filePath)).send(content);
};

if (hasWebDist) {
  app.log.info({ webDistDir }, "serving frontend from web dist");

  app.get("/", async (_request, reply) => {
    await sendFile(reply, webIndexPath);
  });

  app.get("/*", async (request, reply) => {
    const rawPath = String((request.params as { "*": string })["*"] ?? "");
    if (rawPath.startsWith("api/") || rawPath === "health") {
      reply.code(404).send({ error: { message: "not found" } });
      return;
    }

    const candidatePath = path.resolve(webDistDir, rawPath);
    const withinDist =
      candidatePath === webDistDir || candidatePath.startsWith(`${webDistDir}${path.sep}`);
    if (!withinDist) {
      await sendFile(reply, webIndexPath);
      return;
    }

    try {
      const fileStat = await stat(candidatePath);
      if (fileStat.isFile()) {
        await sendFile(reply, candidatePath);
        return;
      }
    } catch {
      // Fall through to SPA fallback.
    }

    await sendFile(reply, webIndexPath);
  });
} else {
  app.log.info({ webDistDir }, "web dist not found, static hosting disabled");
}

const shutdown = async () => {
  litellmPricingService.dispose();
  terminalService.closeAll();
  await sessionManager.closeAll();
  await app.close();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

await app.listen({ host: env.host, port: env.port });
