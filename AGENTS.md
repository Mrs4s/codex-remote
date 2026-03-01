# AGENTS.md

## 项目简介
`codex-remote` 是一个面向 Codex Monitor 工作流的单项目 Web 运行时。
它由前端 Web UI 与后端 Node.js 服务组成，通过 HTTP RPC + SSE 进行通信，支持会话、终端与工作区相关能力。

## 技术栈
- 前端：React 19 + Vite + TypeScript
- 后端：Fastify + TypeScript + SSE
- 工作区：pnpm workspace（monorepo）

## 目录速览
- `apps/web`：前端应用
- `apps/server`：后端服务
- `packages/shared-types`：前后端共享类型
- `packages/sdk`：RPC/SSE typed client
- `docs/architecture.md`：架构说明

## 快速启动
```bash
corepack enable
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev
```

默认地址：
- Web: `http://localhost:5173`
- Server: `http://127.0.0.1:8787`

## 常用命令
- 启动全部：`pnpm dev`
- 仅启动后端：`pnpm dev:server`
- 仅启动前端：`pnpm dev:web`
- 构建：`pnpm build`
- 类型检查：`pnpm typecheck`
- 测试：`pnpm test`

## Agent 协作建议
1. 先读 `README.md` 与 `docs/architecture.md`，再动代码。
2. 涉及接口变更时，优先同步 `packages/shared-types`，再更新 `packages/sdk` 与调用方。
3. 前端改动尽量配套补充/更新测试（若对应模块已有测试）。
4. 后端改动优先保证 `pnpm typecheck` 通过，并验证 `/health` 与关键 RPC/SSE 流程。
5. 保持小步提交与清晰提交信息，便于回溯。

## 运行依赖提醒
- 后端要求本机 `PATH` 中可用 `codex` CLI。
- 当前鉴权模型为单用户 token（开发时请确认 `.env` 配置）。
