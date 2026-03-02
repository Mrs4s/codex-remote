# 使用 PM2 部署 codex-remote

本文给出一套可直接落地的 PM2 部署流程

## 1. 前置条件

- Node.js 18+（建议 20+）
- `pnpm`（已启用 `corepack`）
- 全局安装 PM2：`npm i -g pm2`
- 服务端机器 `PATH` 中可执行 `codex`

项目根目录假设为：

```bash
/path/to/codex-remote
```

## 2. 安装依赖与构建

```bash
cd /path/to/codex-remote
corepack enable
pnpm install
pnpm build
```

构建后：
- 后端入口：`apps/server/dist/index.js`
- 前端静态文件：`apps/web/dist`

## 3. 配置服务端参数（host/port/token）

服务端实际读取的变量（见 `apps/server/src/config/env.ts`）：

- `CODEX_REMOTE_HOST`（默认 `127.0.0.1`）
- `CODEX_REMOTE_PORT`（默认 `8787`）
- `CODEX_REMOTE_TOKEN`（默认 `change-me`，生产务必修改）
- `CODEX_REMOTE_CORS_ORIGIN`（逗号分隔，例：`https://your-web.example.com`）
- `CODEX_REMOTE_DATA_DIR`（数据目录）
- `CODEX_REMOTE_CODEX_BIN`（默认 `codex`）
- `CODEX_REMOTE_WEB_DIST_DIR`（默认 `./apps/web/dist`）

你可以二选一配置：

1. 编辑 `apps/server/.env`（推荐）
2. 编辑根目录 `ecosystem.config.cjs` 的 `env` 字段

示例（`apps/server/.env`）：

```bash
CODEX_REMOTE_HOST=0.0.0.0
CODEX_REMOTE_PORT=8787
CODEX_REMOTE_TOKEN=replace-with-a-strong-token
CODEX_REMOTE_CORS_ORIGIN=https://codex.example.com
CODEX_REMOTE_DATA_DIR=/path/to/codex-remote/data
CODEX_REMOTE_CODEX_BIN=codex
CODEX_REMOTE_WEB_DIST_DIR=/path/to/codex-remote/apps/web/dist
```

## 4. endpoint 与 token 如何修改

### 4.1 后端 endpoint（服务监听地址）

后端 endpoint 由 `CODEX_REMOTE_HOST` + `CODEX_REMOTE_PORT` 决定，例如：

- `CODEX_REMOTE_HOST=0.0.0.0`
- `CODEX_REMOTE_PORT=8787`

则服务可由 `http://<server-ip>:8787` 访问。

后端 API 真实路径：

- RPC：`POST /api/v1/rpc/:method`
- SSE：`GET /api/v1/events?token=...`
- Health：`GET /health`

### 4.2 鉴权 token

后端通过 `CODEX_REMOTE_TOKEN` 校验：

- RPC 使用请求头：`Authorization: Bearer <token>`
- SSE 使用查询参数：`?token=<token>`

前端 token 来源优先级：

1. `VITE_CODEX_REMOTE_TOKEN`（构建时注入）
2. 浏览器 localStorage（键：`codex-remote.token`）
3. 默认值 `change-me`

建议生产环境统一维护一份强随机 token，并确保前后端一致。

### 4.3 前端 endpoint（连接哪个后端）

前端使用 `VITE_CODEX_REMOTE_BASE_URL` 作为后端地址（例如 `https://api.example.com` 或 `http://127.0.0.1:8787`）。

如果你是“前后端分离部署”（前端在 Nginx/CDN，后端在另一域名）：
- 需要在 `pnpm build` 前设置：
  - `VITE_CODEX_REMOTE_BASE_URL`
  - `VITE_CODEX_REMOTE_TOKEN`（可选，通常不建议写死，建议让用户在设置页输入）

示例：

```bash
VITE_CODEX_REMOTE_BASE_URL=https://api.example.com \
VITE_CODEX_REMOTE_TOKEN=replace-with-a-strong-token \
pnpm --filter @codex-remote/web build
```

## 5. 使用 PM2 启动

项目已提供根目录 `ecosystem.config.cjs`，先确认其中 `env` 配置符合你的部署参数。

启动：

```bash
cd /path/to/codex-remote
pm2 start ecosystem.config.cjs
```

常用命令：

```bash
pm2 status
pm2 logs codex-remote-server
pm2 restart codex-remote-server
pm2 stop codex-remote-server
pm2 delete codex-remote-server
```

## 6. 开机自启

```bash
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的命令后，再执行一次 `pm2 save`。

## 7. 反向代理（可选）

若使用 Nginx 暴露 `https://codex.example.com`，请确保：

- `proxy_set_header Authorization $http_authorization;`
- SSE 路径 `/api/v1/events` 不被缓存，且开启长连接支持

## 8. 部署后检查

1. 健康检查：

```bash
curl http://127.0.0.1:8787/health
```

2. 打开页面后确认：
- 能正常加载工作区列表
- 能发起 RPC 请求
- SSE 事件可持续推送（无频繁断线）

3. 若出现 401：
- 检查 `CODEX_REMOTE_TOKEN` 与前端实际使用 token 是否一致
- 检查前端是否连到了正确 `VITE_CODEX_REMOTE_BASE_URL`
