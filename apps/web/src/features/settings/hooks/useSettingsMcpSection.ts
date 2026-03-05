import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMcpServer,
  getMcpServer,
  listMcpServers,
  logoutMcpServer,
  mcpServerOauthLogin,
  removeMcpServer,
} from "@services/tauri";
import { subscribeAppServerEvents } from "@services/events";
import {
  getAppServerParams,
  isMcpServerOauthLoginCompletedEvent,
} from "@/utils/appServerEvents";
import { openUrl } from "@tauri-apps/plugin-opener";

type UseSettingsMcpSectionArgs = {
  mcpWorkspaceId: string | null;
};

type McpTransportType = "streamable_http" | "stdio";

type McpTransportConfig = {
  type: string;
  url: string | null;
  bearerTokenEnvVar: string | null;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  httpHeaders: Record<string, string> | null;
  envHttpHeaders: Record<string, string> | null;
};

export type ManagedMcpServer = {
  name: string;
  enabled: boolean;
  disabledReason: string | null;
  transport: McpTransportConfig;
  startupTimeoutSec: number | null;
  toolTimeoutSec: number | null;
  authStatus: string | null;
};

export type ManagedMcpServerDetail = ManagedMcpServer & {
  enabledTools: string[] | null;
  disabledTools: string[] | null;
};

export type SettingsMcpSectionProps = {
  hasMcpWorkspace: boolean;
  serversLoading: boolean;
  serversError: string | null;
  servers: ManagedMcpServer[];
  selectedServerName: string | null;
  detailLoading: boolean;
  detailError: string | null;
  detail: ManagedMcpServerDetail | null;
  actionError: string | null;
  actionStatus: string | null;
  addError: string | null;
  addingServer: boolean;
  removingServerName: string | null;
  loggingOutServerName: string | null;
  loggingInServerName: string | null;
  draftName: string;
  draftTransport: McpTransportType;
  draftUrl: string;
  draftBearerTokenEnvVar: string;
  draftCommand: string;
  draftArgsText: string;
  draftEnvText: string;
  onRefreshServers: () => void;
  onSelectServer: (name: string) => void;
  onRemoveServer: (name: string) => void;
  onLogoutServer: (name: string) => void;
  onLoginServer: (name: string) => void;
  onAddServer: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftTransportChange: (value: McpTransportType) => void;
  onDraftUrlChange: (value: string) => void;
  onDraftBearerTokenEnvVarChange: (value: string) => void;
  onDraftCommandChange: (value: string) => void;
  onDraftArgsTextChange: (value: string) => void;
  onDraftEnvTextChange: (value: string) => void;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RawRecord;
}

function pickResultRoot(response: unknown): RawRecord {
  const record = asRecord(response);
  const result = asRecord(record?.result);
  return result ?? record ?? {};
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const next = value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
  return next.length > 0 ? next : [];
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const next: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key || rawValue === undefined || rawValue === null) {
      continue;
    }
    next[key] = String(rawValue);
  }
  return next;
}

function normalizeTransport(value: unknown): McpTransportConfig {
  const record = asRecord(value) ?? {};
  return {
    type: normalizeString(record.type) ?? "unknown",
    url: normalizeString(record.url),
    bearerTokenEnvVar:
      normalizeString(record.bearerTokenEnvVar) ??
      normalizeString(record.bearer_token_env_var),
    command: normalizeString(record.command),
    args: normalizeStringArray(record.args),
    env: normalizeStringRecord(record.env),
    httpHeaders:
      normalizeStringRecord(record.httpHeaders) ??
      normalizeStringRecord(record.http_headers),
    envHttpHeaders:
      normalizeStringRecord(record.envHttpHeaders) ??
      normalizeStringRecord(record.env_http_headers),
  };
}

function normalizeServerSummary(value: unknown): ManagedMcpServer | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const name = normalizeString(record.name);
  if (!name) {
    return null;
  }
  return {
    name,
    enabled: record.enabled === true,
    disabledReason:
      normalizeString(record.disabledReason) ??
      normalizeString(record.disabled_reason),
    transport: normalizeTransport(record.transport),
    startupTimeoutSec:
      normalizeNumber(record.startupTimeoutSec) ??
      normalizeNumber(record.startup_timeout_sec),
    toolTimeoutSec:
      normalizeNumber(record.toolTimeoutSec) ??
      normalizeNumber(record.tool_timeout_sec),
    authStatus:
      normalizeString(record.authStatus) ??
      normalizeString(record.auth_status),
  };
}

function normalizeServerDetail(value: unknown): ManagedMcpServerDetail | null {
  const summary = normalizeServerSummary(value);
  if (!summary) {
    return null;
  }
  const record = asRecord(value) ?? {};
  return {
    ...summary,
    enabledTools:
      normalizeStringArray(record.enabledTools) ??
      normalizeStringArray(record.enabled_tools),
    disabledTools:
      normalizeStringArray(record.disabledTools) ??
      normalizeStringArray(record.disabled_tools),
  };
}

function parseServersListResponse(response: unknown): ManagedMcpServer[] {
  const root = pickResultRoot(response);
  const source = Array.isArray(root.data) ? root.data : [];
  return source
    .map((entry) => normalizeServerSummary(entry))
    .filter((entry): entry is ManagedMcpServer => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseServerDetailResponse(response: unknown): ManagedMcpServerDetail | null {
  const root = pickResultRoot(response);
  const dataRecord = asRecord(root.data);
  return normalizeServerDetail(dataRecord ?? root);
}

function parseArgsLines(value: string): string[] | null {
  const args = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return args.length > 0 ? args : null;
}

function parseEnvLines(value: string): Record<string, string> | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  const env: Record<string, string> = {};
  for (const line of lines) {
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`Invalid env entry: "${line}" (expected KEY=VALUE)`);
    }
    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1);
    if (!key) {
      throw new Error(`Invalid env entry: "${line}" (missing KEY)`);
    }
    env[key] = rawValue;
  }

  return env;
}

export function useSettingsMcpSection({
  mcpWorkspaceId,
}: UseSettingsMcpSectionArgs): SettingsMcpSectionProps {
  const [servers, setServers] = useState<ManagedMcpServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [serversError, setServersError] = useState<string | null>(null);
  const [selectedServerName, setSelectedServerName] = useState<string | null>(null);

  const [detail, setDetail] = useState<ManagedMcpServerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const [addingServer, setAddingServer] = useState(false);
  const [removingServerName, setRemovingServerName] = useState<string | null>(null);
  const [loggingOutServerName, setLoggingOutServerName] = useState<string | null>(null);
  const [loggingInServerName, setLoggingInServerName] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftTransport, setDraftTransport] = useState<McpTransportType>("streamable_http");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftBearerTokenEnvVar, setDraftBearerTokenEnvVar] = useState("");
  const [draftCommand, setDraftCommand] = useState("");
  const [draftArgsText, setDraftArgsText] = useState("");
  const [draftEnvText, setDraftEnvText] = useState("");

  const hasMcpWorkspace = useMemo(() => mcpWorkspaceId !== null, [mcpWorkspaceId]);

  const refreshServers = useCallback(async () => {
    setServersLoading(true);
    setServersError(null);
    try {
      const response = await listMcpServers();
      const parsed = parseServersListResponse(response);
      setServers(parsed);
      if (
        selectedServerName &&
        !parsed.some((server) => server.name === selectedServerName)
      ) {
        setSelectedServerName(null);
        setDetail(null);
        setDetailError(null);
      }
    } catch (error) {
      setServersError(error instanceof Error ? error.message : "Unable to load MCP servers.");
    } finally {
      setServersLoading(false);
    }
  }, [selectedServerName]);

  const loadServerDetail = useCallback(async (name: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await getMcpServer(name);
      const parsed = parseServerDetailResponse(response);
      if (!parsed) {
        throw new Error(`No details returned for MCP server "${name}".`);
      }
      setDetail(parsed);
    } catch (error) {
      setDetail(null);
      setDetailError(
        error instanceof Error ? error.message : "Unable to load MCP server details.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  useEffect(() => {
    if (!selectedServerName) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    void loadServerDetail(selectedServerName);
  }, [loadServerDetail, selectedServerName]);

  useEffect(() => {
    if (!mcpWorkspaceId) {
      return;
    }
    return subscribeAppServerEvents(
      (event) => {
        if (event.workspace_id !== mcpWorkspaceId) {
          return;
        }
        if (!isMcpServerOauthLoginCompletedEvent(event)) {
          return;
        }

        const params = getAppServerParams(event);
        const eventServerName = String(params.name ?? "").trim();
        const success = Boolean(params.success);
        const errorRaw = params.error;
        const error =
          typeof errorRaw === "string" && errorRaw.trim().length > 0
            ? errorRaw.trim()
            : null;

        if (!success) {
          setActionError(error ?? "MCP OAuth login failed.");
        } else {
          setActionStatus(
            eventServerName
              ? `MCP login completed for "${eventServerName}".`
              : "MCP login completed.",
          );
        }

        setLoggingInServerName((current) => {
          if (!current) {
            return null;
          }
          if (eventServerName && current !== eventServerName) {
            return current;
          }
          return null;
        });
        void refreshServers();
        if (selectedServerName) {
          void loadServerDetail(selectedServerName);
        }
      },
      {
        onError: () => {
          // Ignore bridge/listener failures in non-Tauri test and web shim environments.
        },
      },
    );
  }, [loadServerDetail, mcpWorkspaceId, refreshServers, selectedServerName]);

  const onAddServer = useCallback(() => {
    if (addingServer) {
      return;
    }
    void (async () => {
      const name = draftName.trim();
      if (!name) {
        setAddError("Server name is required.");
        return;
      }

      setAddingServer(true);
      setAddError(null);
      setActionError(null);
      setActionStatus(null);
      try {
        if (draftTransport === "streamable_http") {
          const url = draftUrl.trim();
          if (!url) {
            setAddError("Server URL is required for streamable HTTP servers.");
            return;
          }
          await addMcpServer({
            name,
            transport: "streamable_http",
            url,
            bearerTokenEnvVar: draftBearerTokenEnvVar.trim() || null,
          });
        } else {
          const command = draftCommand.trim();
          if (!command) {
            setAddError("Command is required for stdio servers.");
            return;
          }
          await addMcpServer({
            name,
            transport: "stdio",
            command,
            args: parseArgsLines(draftArgsText),
            env: parseEnvLines(draftEnvText),
          });
        }

        setActionStatus(`Added MCP server "${name}".`);
        setDraftName("");
        setDraftUrl("");
        setDraftBearerTokenEnvVar("");
        setDraftCommand("");
        setDraftArgsText("");
        setDraftEnvText("");
        await refreshServers();
        setSelectedServerName(name);
      } catch (error) {
        setAddError(error instanceof Error ? error.message : "Unable to add MCP server.");
      } finally {
        setAddingServer(false);
      }
    })();
  }, [
    addingServer,
    draftArgsText,
    draftBearerTokenEnvVar,
    draftCommand,
    draftEnvText,
    draftName,
    draftTransport,
    draftUrl,
    refreshServers,
  ]);

  const onRemoveServer = useCallback(
    (name: string) => {
      if (removingServerName) {
        return;
      }
      void (async () => {
        setRemovingServerName(name);
        setActionError(null);
        setActionStatus(null);
        try {
          await removeMcpServer(name);
          setActionStatus(`Removed MCP server "${name}".`);
          if (selectedServerName === name) {
            setSelectedServerName(null);
            setDetail(null);
          }
          await refreshServers();
        } catch (error) {
          setActionError(
            error instanceof Error ? error.message : "Unable to remove MCP server.",
          );
        } finally {
          setRemovingServerName(null);
        }
      })();
    },
    [refreshServers, removingServerName, selectedServerName],
  );

  const onLogoutServer = useCallback(
    (name: string) => {
      if (loggingOutServerName) {
        return;
      }
      void (async () => {
        setLoggingOutServerName(name);
        setActionError(null);
        setActionStatus(null);
        try {
          await logoutMcpServer(name);
          setActionStatus(`Logged out MCP server "${name}".`);
          await refreshServers();
          if (selectedServerName === name) {
            await loadServerDetail(name);
          }
        } catch (error) {
          setActionError(
            error instanceof Error ? error.message : "Unable to log out MCP server.",
          );
        } finally {
          setLoggingOutServerName(null);
        }
      })();
    },
    [loadServerDetail, loggingOutServerName, refreshServers, selectedServerName],
  );

  const onLoginServer = useCallback(
    (name: string) => {
      if (loggingInServerName) {
        return;
      }
      if (!mcpWorkspaceId) {
        setActionError("Connect a workspace before starting MCP OAuth login.");
        return;
      }
      void (async () => {
        setLoggingInServerName(name);
        setActionError(null);
        setActionStatus(null);
        try {
          const response = (await mcpServerOauthLogin(
            mcpWorkspaceId,
            name,
            null,
            null,
          )) as Record<string, unknown> | null;
          const authorizationUrlRaw =
            response?.authorizationUrl ?? response?.authorization_url;
          if (
            typeof authorizationUrlRaw !== "string" ||
            authorizationUrlRaw.trim().length === 0
          ) {
            throw new Error("Missing authorization URL for MCP login.");
          }
          await openUrl(authorizationUrlRaw);
          setActionStatus(`Opened MCP OAuth login for "${name}".`);
          setLoggingInServerName(null);
        } catch (error) {
          setLoggingInServerName(null);
          setActionError(
            error instanceof Error ? error.message : "Unable to start MCP OAuth login.",
          );
        }
      })();
    },
    [loggingInServerName, mcpWorkspaceId],
  );

  return {
    hasMcpWorkspace,
    serversLoading,
    serversError,
    servers,
    selectedServerName,
    detailLoading,
    detailError,
    detail,
    actionError,
    actionStatus,
    addError,
    addingServer,
    removingServerName,
    loggingOutServerName,
    loggingInServerName,
    draftName,
    draftTransport,
    draftUrl,
    draftBearerTokenEnvVar,
    draftCommand,
    draftArgsText,
    draftEnvText,
    onRefreshServers: () => {
      void refreshServers();
    },
    onSelectServer: (name: string) => {
      setSelectedServerName(name);
      setDetailError(null);
      setActionError(null);
    },
    onRemoveServer,
    onLogoutServer,
    onLoginServer,
    onAddServer,
    onDraftNameChange: (value: string) => {
      setDraftName(value);
      if (addError) {
        setAddError(null);
      }
    },
    onDraftTransportChange: (value: McpTransportType) => {
      setDraftTransport(value);
      if (addError) {
        setAddError(null);
      }
    },
    onDraftUrlChange: (value: string) => {
      setDraftUrl(value);
      if (addError) {
        setAddError(null);
      }
    },
    onDraftBearerTokenEnvVarChange: (value: string) => {
      setDraftBearerTokenEnvVar(value);
      if (addError) {
        setAddError(null);
      }
    },
    onDraftCommandChange: (value: string) => {
      setDraftCommand(value);
      if (addError) {
        setAddError(null);
      }
    },
    onDraftArgsTextChange: (value: string) => {
      setDraftArgsText(value);
      if (addError) {
        setAddError(null);
      }
    },
    onDraftEnvTextChange: (value: string) => {
      setDraftEnvText(value);
      if (addError) {
        setAddError(null);
      }
    },
  };
}
