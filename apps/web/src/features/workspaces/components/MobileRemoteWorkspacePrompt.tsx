import { useEffect, useRef } from "react";
import type { AccessMode } from "../../../types";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

type MobileRemoteWorkspacePromptProps = {
  value: string;
  accessMode: AccessMode;
  error: string | null;
  recentPaths: string[];
  onChange: (value: string) => void;
  onAccessModeChange: (value: AccessMode) => void;
  onRecentPathSelect: (path: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MobileRemoteWorkspacePrompt({
  value,
  accessMode,
  error,
  recentPaths,
  onChange,
  onAccessModeChange,
  onRecentPathSelect,
  onCancel,
  onConfirm,
}: MobileRemoteWorkspacePromptProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusTextareaAtEnd = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  useEffect(() => {
    focusTextareaAtEnd();
  }, []);

  return (
    <ModalShell
      ariaLabel="Add remote workspace paths"
      className="mobile-remote-workspace-modal"
      cardClassName="mobile-remote-workspace-modal-card"
      onBackdropClick={onCancel}
    >
      <div className="mobile-remote-workspace-modal-content">
        <div className="ds-modal-title">Add project directories</div>
        <div className="ds-modal-subtitle">
          Enter directories on the connected server.
        </div>
        <label className="ds-modal-label" htmlFor="mobile-remote-workspace-paths">
          Paths
        </label>
        <textarea
          id="mobile-remote-workspace-paths"
          ref={textareaRef}
          className="ds-modal-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={"/home/vlad/dev/project-one\n/home/vlad/dev/project-two"}
          rows={4}
          wrap="off"
        />
        <div className="mobile-remote-workspace-modal-hint">
          One path per line. Comma and semicolon separators also work. You can use `~/...`.
        </div>
        <label className="ds-modal-label" htmlFor="mobile-remote-workspace-access">
          Default access
        </label>
        <select
          id="mobile-remote-workspace-access"
          className="ds-modal-input"
          value={accessMode}
          onChange={(event) => onAccessModeChange(event.target.value as AccessMode)}
        >
          <option value="read-only">Read only</option>
          <option value="current">On-Request</option>
          <option value="full-access">Full access</option>
        </select>
        {recentPaths.length > 0 && (
          <div className="mobile-remote-workspace-modal-recent">
            <div className="mobile-remote-workspace-modal-recent-title">Recently added</div>
            <div className="mobile-remote-workspace-modal-recent-list">
              {recentPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="mobile-remote-workspace-modal-recent-item"
                  onClick={() => {
                    onRecentPathSelect(path);
                    requestAnimationFrame(() => {
                      focusTextareaAtEnd();
                    });
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <div className="ds-modal-error">{error}</div>}
        <div className="ds-modal-actions">
          <button className="ghost ds-modal-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary ds-modal-button" onClick={onConfirm} type="button">
            Add
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
