import { useEffect, useRef } from "react";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

type ThreadFolderPromptProps = {
  mode: "create" | "rename";
  workspaceName: string;
  currentName?: string | null;
  name: string;
  error?: string | null;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ThreadFolderPrompt({
  mode,
  workspaceName,
  currentName = null,
  name,
  error = null,
  onChange,
  onCancel,
  onConfirm,
}: ThreadFolderPromptProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const isRename = mode === "rename";

  return (
    <ModalShell
      className="worktree-modal"
      onBackdropClick={onCancel}
      ariaLabel={isRename ? "Rename thread folder" : "Create thread folder"}
    >
      <div className="ds-modal-title worktree-modal-title">
        {isRename ? "Rename thread folder" : "Create thread folder"}
      </div>
      <div className="ds-modal-subtitle worktree-modal-subtitle">
        Project: "{workspaceName}"
      </div>
      {isRename && currentName ? (
        <div className="ds-modal-subtitle worktree-modal-subtitle">
          Current name: "{currentName}"
        </div>
      ) : null}
      <label className="ds-modal-label worktree-modal-label" htmlFor="thread-folder-name">
        Folder name
      </label>
      <input
        id="thread-folder-name"
        ref={inputRef}
        className="ds-modal-input worktree-modal-input"
        value={name}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            onConfirm();
          }
        }}
      />
      {error ? <div className="ds-modal-error">{error}</div> : null}
      <div className="ds-modal-actions worktree-modal-actions">
        <button
          className="ghost ds-modal-button worktree-modal-button"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="primary ds-modal-button worktree-modal-button"
          onClick={onConfirm}
          type="button"
          disabled={name.trim().length === 0}
        >
          {isRename ? "Rename" : "Create"}
        </button>
      </div>
    </ModalShell>
  );
}
