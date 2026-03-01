# codex-remote

Single-project web runtime for Codex Monitor style workflows.

## Structure

- `apps/web`: Browser UI (React + Vite)
- `apps/server`: Node.js backend (Fastify + SSE + codex app-server + terminal)
- `packages/shared-types`: shared contracts
- `packages/sdk`: typed client for RPC + SSE

## Quick start

```bash
cd /path/to/codex-remote
corepack enable
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev
```

Default ports:

- web: `http://localhost:5173`
- server: `http://127.0.0.1:8787`

## API

- RPC: `POST /api/v1/rpc/:method`
- SSE: `GET /api/v1/events?token=...`
- Health: `GET /health`

## Notes

- The backend expects the `codex` CLI to be installed and available in `PATH`.
- Current version is single-user token auth.
- Web runtime intentionally avoids any Tauri dependency.

## Web Runtime Config

`apps/web` now hosts the migrated CodexMonitor UI and talks to the Node backend over HTTP/SSE.

- `VITE_CODEX_REMOTE_BASE_URL`: backend base url (default: `http://127.0.0.1:8787`)
- `VITE_CODEX_REMOTE_TOKEN`: backend token (default: `change-me`)

Example:

```bash
VITE_CODEX_REMOTE_BASE_URL=http://127.0.0.1:8787 \
VITE_CODEX_REMOTE_TOKEN=change-me \
pnpm --filter @codex-remote/web dev
```
