import type { FastifyReply, FastifyRequest } from "fastify";
import type { SseEventMap } from "@codex-remote/shared-types";

type Client = {
  id: string;
  reply: FastifyReply;
};

export class EventBus {
  private clients = new Map<string, Client>();

  constructor() {
    setInterval(() => {
      this.publish("server-heartbeat", { now: Date.now() });
    }, 15000).unref();
  }

  attach(request: FastifyRequest, reply: FastifyReply): void {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    reply.raw.setHeader("content-type", "text/event-stream");
    reply.raw.setHeader("cache-control", "no-cache");
    reply.raw.setHeader("connection", "keep-alive");
    reply.raw.setHeader("x-accel-buffering", "no");
    reply.raw.flushHeaders?.();
    reply.raw.write(`event: server-heartbeat\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);

    this.clients.set(id, { id, reply });

    request.raw.on("close", () => {
      this.clients.delete(id);
    });
  }

  publish<K extends keyof SseEventMap>(event: K, payload: SseEventMap[K]): void {
    const body = `event: ${String(event)}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const [id, client] of this.clients.entries()) {
      try {
        client.reply.raw.write(body);
      } catch {
        this.clients.delete(id);
      }
    }
  }
}
