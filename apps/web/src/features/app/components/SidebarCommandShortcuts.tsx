import Play from "lucide-react/dist/esm/icons/play";
import Plus from "lucide-react/dist/esm/icons/plus";
import type { WorkspaceLaunchScriptsState } from "../hooks/useWorkspaceLaunchScripts";
import { LaunchScriptIconPicker } from "./LaunchScriptIconPicker";
import {
  getLaunchScriptIcon,
  getLaunchScriptIconLabel,
} from "../utils/launchScriptIcons";

type SidebarCommandShortcutsProps = {
  launchScriptsState: WorkspaceLaunchScriptsState;
};

function getCommandLabel(label: string | null | undefined, iconId: string | null | undefined) {
  const trimmed = label?.trim();
  if (trimmed) {
    return trimmed;
  }
  return getLaunchScriptIconLabel(iconId);
}

function getCommandPreview(script: string) {
  const firstLine = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return "";
  }
  return firstLine.length > 68 ? `${firstLine.slice(0, 68)}...` : firstLine;
}

export function SidebarCommandShortcuts({
  launchScriptsState,
}: SidebarCommandShortcutsProps) {
  const toggleNewEditor = () => {
    if (launchScriptsState.newEditorOpen) {
      launchScriptsState.onCloseNew();
      return;
    }
    launchScriptsState.onCloseEditor();
    launchScriptsState.onOpenNew();
  };

  return (
    <section className="sidebar-shortcuts-section">
      <div className="workspace-group-header">
        <div className="workspace-group-label">Command shortcuts</div>
        <button
          type="button"
          className={`ghost sidebar-shortcuts-add${
            launchScriptsState.newEditorOpen ? " is-active" : ""
          }`}
          onClick={toggleNewEditor}
          data-tauri-drag-region="false"
          aria-label={
            launchScriptsState.newEditorOpen
              ? "Close command shortcut editor"
              : "Add command shortcut"
          }
          title={
            launchScriptsState.newEditorOpen
              ? "Close command shortcut editor"
              : "Add command shortcut"
          }
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {launchScriptsState.newEditorOpen && (
        <div className="sidebar-shortcuts-editor">
          <div className="sidebar-shortcuts-editor-title">New command shortcut</div>
          <LaunchScriptIconPicker
            value={launchScriptsState.newDraftIcon}
            onChange={launchScriptsState.onNewDraftIconChange}
          />
          <input
            className="launch-script-input sidebar-shortcuts-input"
            type="text"
            placeholder="Optional label"
            value={launchScriptsState.newDraftLabel}
            onChange={(event) => launchScriptsState.onNewDraftLabelChange(event.target.value)}
            data-tauri-drag-region="false"
          />
          <textarea
            className="launch-script-textarea sidebar-shortcuts-textarea"
            placeholder="e.g. npm run dev"
            value={launchScriptsState.newDraftScript}
            onChange={(event) => launchScriptsState.onNewDraftScriptChange(event.target.value)}
            rows={5}
            data-tauri-drag-region="false"
          />
          {launchScriptsState.newError && (
            <div className="launch-script-error">{launchScriptsState.newError}</div>
          )}
          <div className="sidebar-shortcuts-actions">
            <button
              type="button"
              className="ghost"
              onClick={launchScriptsState.onCloseNew}
              data-tauri-drag-region="false"
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                void launchScriptsState.onCreateNew();
              }}
              disabled={launchScriptsState.isSaving}
              data-tauri-drag-region="false"
            >
              {launchScriptsState.isSaving ? "Saving..." : "Create"}
            </button>
          </div>
        </div>
      )}
      {launchScriptsState.launchScripts.length > 0 ? (
        <div className="sidebar-shortcuts-list">
          {launchScriptsState.launchScripts.map((entry) => {
            const isEditing = launchScriptsState.editorOpenId === entry.id;
            const label = getCommandLabel(entry.label, entry.icon);
            const preview = getCommandPreview(entry.script);
            const Icon = getLaunchScriptIcon(entry.icon);
            return (
              <div key={entry.id} className="sidebar-shortcuts-entry">
                <div className="sidebar-shortcuts-row">
                  <button
                    type="button"
                    className="sidebar-shortcuts-run"
                    onClick={() => launchScriptsState.onRunScript(entry.id)}
                    data-tauri-drag-region="false"
                    aria-label={`Run command shortcut: ${label}`}
                    title={entry.script}
                  >
                    <span className="sidebar-shortcuts-run-icon" aria-hidden>
                      <Icon size={13} />
                    </span>
                    <span className="sidebar-shortcuts-run-text">
                      <span className="sidebar-shortcuts-run-label">{label}</span>
                      {preview ? (
                        <span className="sidebar-shortcuts-run-preview">{preview}</span>
                      ) : null}
                    </span>
                    <Play size={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="ghost sidebar-shortcuts-edit"
                    onClick={() => {
                      launchScriptsState.onCloseNew();
                      launchScriptsState.onOpenEditor(entry.id);
                    }}
                    data-tauri-drag-region="false"
                    aria-label={`Edit command shortcut: ${label}`}
                    title={`Edit ${label}`}
                  >
                    Edit
                  </button>
                </div>
                {isEditing && (
                  <div className="sidebar-shortcuts-editor">
                    <div className="sidebar-shortcuts-editor-title">
                      Edit command shortcut
                    </div>
                    <LaunchScriptIconPicker
                      value={launchScriptsState.draftIcon}
                      onChange={launchScriptsState.onDraftIconChange}
                    />
                    <input
                      className="launch-script-input sidebar-shortcuts-input"
                      type="text"
                      placeholder="Optional label"
                      value={launchScriptsState.draftLabel}
                      onChange={(event) =>
                        launchScriptsState.onDraftLabelChange(event.target.value)
                      }
                      data-tauri-drag-region="false"
                    />
                    <textarea
                      className="launch-script-textarea sidebar-shortcuts-textarea"
                      placeholder="e.g. npm run dev"
                      value={launchScriptsState.draftScript}
                      onChange={(event) =>
                        launchScriptsState.onDraftScriptChange(event.target.value)
                      }
                      rows={5}
                      data-tauri-drag-region="false"
                    />
                    {launchScriptsState.errorById[entry.id] && (
                      <div className="launch-script-error">
                        {launchScriptsState.errorById[entry.id]}
                      </div>
                    )}
                    <div className="sidebar-shortcuts-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={launchScriptsState.onCloseEditor}
                        data-tauri-drag-region="false"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="ghost launch-script-delete"
                        onClick={() => {
                          void launchScriptsState.onDeleteScript();
                        }}
                        data-tauri-drag-region="false"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          void launchScriptsState.onSaveScript();
                        }}
                        disabled={launchScriptsState.isSaving}
                        data-tauri-drag-region="false"
                      >
                        {launchScriptsState.isSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sidebar-shortcuts-empty">No command shortcuts yet.</div>
      )}
    </section>
  );
}
