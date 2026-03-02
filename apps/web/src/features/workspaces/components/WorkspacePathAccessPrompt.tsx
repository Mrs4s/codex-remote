import type { AccessMode } from "../../../types";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

type WorkspacePathAccessPromptProps = {
  pathCount: number;
  accessMode: AccessMode;
  onAccessModeChange: (value: AccessMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkspacePathAccessPrompt({
  pathCount,
  accessMode,
  onAccessModeChange,
  onCancel,
  onConfirm,
}: WorkspacePathAccessPromptProps) {
  const targetLabel = pathCount === 1 ? "project" : `${pathCount} projects`;

  return (
    <ModalShell
      ariaLabel="Choose default access for new projects"
      className="workspace-path-access-modal"
      cardClassName="workspace-path-access-modal-card"
      onBackdropClick={onCancel}
    >
      <div className="workspace-path-access-modal-content">
        <div className="ds-modal-title">Set default access</div>
        <div className="ds-modal-subtitle">
          Choose access mode for the newly added {targetLabel}.
        </div>
        <label className="ds-modal-label" htmlFor="workspace-path-access-mode">
          Default access
        </label>
        <select
          id="workspace-path-access-mode"
          className="ds-modal-input"
          value={accessMode}
          onChange={(event) => onAccessModeChange(event.target.value as AccessMode)}
        >
          <option value="read-only">Read only</option>
          <option value="current">On-Request</option>
          <option value="full-access">Full access</option>
        </select>
        <div className="ds-modal-actions">
          <button className="ghost ds-modal-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary ds-modal-button" type="button" onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
