import { useEffect, useRef } from "react";
import type { AccessMode } from "../../../types";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

type WorkspaceFromUrlPromptProps = {
  url: string;
  destinationPath: string;
  targetFolderName: string;
  accessMode: AccessMode;
  error: string | null;
  isBusy: boolean;
  canSubmit: boolean;
  onUrlChange: (value: string) => void;
  onTargetFolderNameChange: (value: string) => void;
  onAccessModeChange: (value: AccessMode) => void;
  onChooseDestinationPath: () => void;
  onClearDestinationPath: () => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkspaceFromUrlPrompt({
  url,
  destinationPath,
  targetFolderName,
  accessMode,
  error,
  isBusy,
  canSubmit,
  onUrlChange,
  onTargetFolderNameChange,
  onAccessModeChange,
  onChooseDestinationPath,
  onClearDestinationPath,
  onCancel,
  onConfirm,
}: WorkspaceFromUrlPromptProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <ModalShell
      ariaLabel="Add workspace from URL"
      className="workspace-from-url-modal"
      cardClassName="workspace-from-url-modal-card"
      onBackdropClick={() => {
        if (!isBusy) {
          onCancel();
        }
      }}
    >
      <div className="workspace-from-url-modal-content">
        <div className="ds-modal-title">Add workspace from URL</div>
        <label className="ds-modal-label" htmlFor="workspace-url-input">
          Remote Git URL
        </label>
        <input
          id="workspace-url-input"
          ref={inputRef}
          className="ds-modal-input"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://github.com/org/repo.git"
        />
        <label className="ds-modal-label" htmlFor="workspace-url-target-name">
          Target folder name (optional)
        </label>
        <input
          id="workspace-url-target-name"
          className="ds-modal-input"
          value={targetFolderName}
          onChange={(event) => onTargetFolderNameChange(event.target.value)}
          placeholder="Defaults to repo name"
        />
        <label className="ds-modal-label" htmlFor="workspace-url-access-mode">
          Default access
        </label>
        <select
          id="workspace-url-access-mode"
          className="ds-modal-input"
          value={accessMode}
          onChange={(event) => onAccessModeChange(event.target.value as AccessMode)}
        >
          <option value="read-only">Read only</option>
          <option value="current">On-Request</option>
          <option value="full-access">Full access</option>
        </select>
        <label className="ds-modal-label" htmlFor="workspace-url-destination">
          Destination parent folder
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            id="workspace-url-destination"
            className="ds-modal-input"
            value={destinationPath}
            placeholder="Not set"
            readOnly
            rows={1}
            wrap="off"
          />
          <button type="button" className="ghost ds-modal-button" onClick={onChooseDestinationPath}>
            Choose…
          </button>
          <button
            type="button"
            className="ghost ds-modal-button"
            onClick={onClearDestinationPath}
            disabled={destinationPath.trim().length === 0 || isBusy}
          >
            Clear
          </button>
        </div>
        {error && <div className="ds-modal-error">{error}</div>}
        <div className="ds-modal-actions">
          <button className="ghost ds-modal-button" onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
          <button
            className="primary ds-modal-button"
            onClick={onConfirm}
            disabled={isBusy || !canSubmit}
          >
            {isBusy ? "Cloning…" : "Clone and Add"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
