# codex-remote Architecture

- `apps/web`: Browser UI (React + Vite)
- `apps/server`: Node.js backend (Fastify + SSE + codex app-server process manager)
- `packages/shared-types`: Shared RPC/event contracts
- `packages/sdk`: Browser/client SDK for RPC + SSE

Frontend migration note:
- `apps/web/src` is copied from CodexMonitor and runs without Tauri runtime.
- Tauri module imports are routed to `apps/web/src/tauri-shim/*`.
- `@tauri-apps/api/core.invoke` compatibility path is implemented as HTTP RPC:
  `POST /api/v1/rpc/:method`.
- Event subscriptions use backend SSE:
  `GET /api/v1/events?token=...`.

Runtime model:
- Commands use `POST /api/v1/rpc/:method`
- Realtime events use `GET /api/v1/events` (SSE)
