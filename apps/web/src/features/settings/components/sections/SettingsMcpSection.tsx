import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsMcpSectionProps } from "@settings/hooks/useSettingsMcpSection";

function serverSubtitle(server: SettingsMcpSectionProps["servers"][number]): string {
  const details = [
    `Transport: ${server.transport.type}`,
    server.transport.url ? `URL: ${server.transport.url}` : null,
    server.transport.command ? `Command: ${server.transport.command}` : null,
    `Auth: ${server.authStatus ?? "unknown"}`,
    server.enabled ? "Enabled" : "Disabled",
    server.disabledReason ? `Reason: ${server.disabledReason}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return details.join(" · ");
}

function renderDetail(detail: NonNullable<SettingsMcpSectionProps["detail"]>) {
  const lines: string[] = [];
  lines.push(`Transport: ${detail.transport.type}`);
  if (detail.transport.url) {
    lines.push(`URL: ${detail.transport.url}`);
  }
  if (detail.transport.bearerTokenEnvVar) {
    lines.push(`Bearer token env var: ${detail.transport.bearerTokenEnvVar}`);
  }
  if (detail.transport.command) {
    lines.push(`Command: ${detail.transport.command}`);
  }
  if (detail.transport.args && detail.transport.args.length > 0) {
    lines.push(`Args: ${detail.transport.args.join(" ")}`);
  }
  if (detail.transport.env && Object.keys(detail.transport.env).length > 0) {
    lines.push(`Env keys: ${Object.keys(detail.transport.env).sort().join(", ")}`);
  }
  if (detail.enabledTools && detail.enabledTools.length > 0) {
    lines.push(`Enabled tools: ${detail.enabledTools.join(", ")}`);
  }
  if (detail.disabledTools && detail.disabledTools.length > 0) {
    lines.push(`Disabled tools: ${detail.disabledTools.join(", ")}`);
  }
  if (detail.startupTimeoutSec !== null) {
    lines.push(`Startup timeout: ${detail.startupTimeoutSec}s`);
  }
  if (detail.toolTimeoutSec !== null) {
    lines.push(`Tool timeout: ${detail.toolTimeoutSec}s`);
  }
  lines.push(`Auth status: ${detail.authStatus ?? "unknown"}`);

  return lines.join("\n");
}

export function SettingsMcpSection({
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
  onRefreshServers,
  onSelectServer,
  onRemoveServer,
  onLogoutServer,
  onLoginServer,
  onAddServer,
  onDraftNameChange,
  onDraftTransportChange,
  onDraftUrlChange,
  onDraftBearerTokenEnvVarChange,
  onDraftCommandChange,
  onDraftArgsTextChange,
  onDraftEnvTextChange,
}: SettingsMcpSectionProps) {
  return (
    <SettingsSection
      title="MCP"
      subtitle="Manage global MCP servers configured in ~/.codex/config.toml."
    >
      <SettingsToggleRow
        title="Configured servers"
        subtitle="Refresh and manage globally configured MCP server entries."
      >
        <button
          type="button"
          className="ghost"
          onClick={onRefreshServers}
          disabled={serversLoading}
        >
          {serversLoading ? "Refreshing..." : "Refresh"}
        </button>
      </SettingsToggleRow>

      {!hasMcpWorkspace && (
        <div className="settings-help">
          Connect a workspace to enable MCP OAuth login flow.
        </div>
      )}
      {serversError && <div className="settings-help settings-help-error">{serversError}</div>}
      {actionError && <div className="settings-help settings-help-error">{actionError}</div>}
      {actionStatus && <div className="settings-help">{actionStatus}</div>}
      {!serversLoading && !serversError && servers.length === 0 && (
        <div className="settings-help">No MCP servers configured.</div>
      )}

      {servers.map((server) => (
        <SettingsToggleRow
          key={server.name}
          title={server.name}
          subtitle={serverSubtitle(server)}
        >
          <div className="settings-field-row">
            <button
              type="button"
              className="ghost"
              onClick={() => onSelectServer(server.name)}
            >
              {selectedServerName === server.name ? "Selected" : "Details"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => onLoginServer(server.name)}
              disabled={!hasMcpWorkspace || loggingInServerName === server.name}
            >
              {loggingInServerName === server.name ? "Opening..." : "Login"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => onLogoutServer(server.name)}
              disabled={loggingOutServerName === server.name}
            >
              {loggingOutServerName === server.name ? "Logging out..." : "Logout"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const confirmed = window.confirm(
                  `Remove MCP server "${server.name}" from global config?`,
                );
                if (!confirmed) {
                  return;
                }
                onRemoveServer(server.name);
              }}
              disabled={removingServerName === server.name}
            >
              {removingServerName === server.name ? "Removing..." : "Remove"}
            </button>
          </div>
        </SettingsToggleRow>
      ))}

      <SettingsSubsection
        title="Server details"
        subtitle="Inspect the selected MCP server entry."
      />
      {!selectedServerName && (
        <div className="settings-help">Select a server to view detailed configuration.</div>
      )}
      {selectedServerName && detailLoading && <div className="settings-help">Loading details...</div>}
      {selectedServerName && detailError && (
        <div className="settings-help settings-help-error">{detailError}</div>
      )}
      {selectedServerName && detail && (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="mcp-server-detail">
            {detail.name}
          </label>
          <textarea
            id="mcp-server-detail"
            className="settings-agents-textarea"
            value={renderDetail(detail)}
            readOnly
          />
        </div>
      )}

      <SettingsSubsection
        title="Add server"
        subtitle="Create a new global MCP server entry."
      />
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="mcp-add-name">
          Server name
        </label>
        <input
          id="mcp-add-name"
          className="settings-input"
          value={draftName}
          onChange={(event) => onDraftNameChange(event.target.value)}
          placeholder="sentry"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="mcp-add-transport">
          Transport
        </label>
        <select
          id="mcp-add-transport"
          className="settings-select"
          value={draftTransport}
          onChange={(event) =>
            onDraftTransportChange(event.target.value as "streamable_http" | "stdio")
          }
        >
          <option value="streamable_http">Streamable HTTP</option>
          <option value="stdio">stdio command</option>
        </select>
      </div>

      {draftTransport === "streamable_http" ? (
        <>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="mcp-add-url">
              Server URL
            </label>
            <input
              id="mcp-add-url"
              className="settings-input"
              value={draftUrl}
              onChange={(event) => onDraftUrlChange(event.target.value)}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="mcp-add-bearer-env">
              Bearer token env var
            </label>
            <input
              id="mcp-add-bearer-env"
              className="settings-input"
              value={draftBearerTokenEnvVar}
              onChange={(event) => onDraftBearerTokenEnvVarChange(event.target.value)}
              placeholder="SENTRY_AUTH_TOKEN"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </>
      ) : (
        <>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="mcp-add-command">
              Command
            </label>
            <input
              id="mcp-add-command"
              className="settings-input"
              value={draftCommand}
              onChange={(event) => onDraftCommandChange(event.target.value)}
              placeholder="npx"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="mcp-add-args">
              Args (one per line)
            </label>
            <textarea
              id="mcp-add-args"
              className="settings-agents-textarea"
              value={draftArgsText}
              onChange={(event) => onDraftArgsTextChange(event.target.value)}
              placeholder="@modelcontextprotocol/server-filesystem&#10;/path/to/root"
              spellCheck={false}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="mcp-add-env">
              Env (KEY=VALUE per line)
            </label>
            <textarea
              id="mcp-add-env"
              className="settings-agents-textarea"
              value={draftEnvText}
              onChange={(event) => onDraftEnvTextChange(event.target.value)}
              placeholder="API_KEY=..."
              spellCheck={false}
            />
          </div>
        </>
      )}

      {addError && <div className="settings-help settings-help-error">{addError}</div>}

      <div className="settings-field-actions">
        <button
          type="button"
          className="primary"
          onClick={onAddServer}
          disabled={addingServer}
        >
          {addingServer ? "Adding..." : "Add server"}
        </button>
      </div>
    </SettingsSection>
  );
}
