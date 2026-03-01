import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { JsonStore } from "./storage/jsonStore.js";
import { EventBus } from "./events/eventBus.js";
import { WorkspaceService } from "./services/workspaceService.js";
import { SessionManager } from "./services/sessionManager.js";
import { TerminalService } from "./services/terminalService.js";
import { PromptService } from "./services/promptService.js";
import { DictationService } from "./services/dictationService.js";
import { dispatchRpc } from "./rpc/dispatcher.js";

const store = new JsonStore(env.dataDir);
const eventBus = new EventBus();
const workspaceService = new WorkspaceService(store);
const sessionManager = new SessionManager(eventBus, env.codexBin);
const terminalService = new TerminalService(eventBus);
const promptService = new PromptService(env.dataDir);
const dictationService = new DictationService(eventBus);

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.corsOrigin.split(",").map((value) => value.trim()),
  credentials: false,
});

await store.init();
await workspaceService.load();

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") {
    return;
  }
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "")?.trim();
  const queryToken = (request.query as { token?: string } | undefined)?.token?.trim();
  const token = bearer || queryToken;
  if (token !== env.token) {
    reply.code(401).send({ error: { message: "unauthorized" } });
  }
});

app.get("/health", async () => ({ ok: true, now: Date.now() }));

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
        store,
      },
      method,
      params,
    );
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply.code(400);
    return { error: { message } };
  }
});

const shutdown = async () => {
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
