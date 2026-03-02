module.exports = {
  apps: [
    {
      name: "codex-remote-server",
      cwd: __dirname,
      script: "apps/server/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        CODEX_REMOTE_HOST: process.env.CODEX_REMOTE_HOST || "127.0.0.1",
        CODEX_REMOTE_PORT: process.env.CODEX_REMOTE_PORT || "8787",
        CODEX_REMOTE_TOKEN: process.env.CODEX_REMOTE_TOKEN || "rBgmMuQfa9c3",
        CODEX_REMOTE_CORS_ORIGIN:
          process.env.CODEX_REMOTE_CORS_ORIGIN || "http://localhost:5173",
        CODEX_REMOTE_DATA_DIR: process.env.CODEX_REMOTE_DATA_DIR || "./data",
        CODEX_REMOTE_CODEX_BIN: process.env.CODEX_REMOTE_CODEX_BIN || "codex",
        CODEX_REMOTE_WEB_DIST_DIR:
          process.env.CODEX_REMOTE_WEB_DIST_DIR || "./apps/web/dist",
      },
    },
  ],
};
