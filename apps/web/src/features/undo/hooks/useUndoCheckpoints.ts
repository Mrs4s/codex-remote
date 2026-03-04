import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAppServerEvents } from "@/features/app/hooks/useAppServerEvents";
import type { UndoCheckpointSummary } from "@/types";
import { listUndoCheckpoints, undoCheckpoint } from "@services/tauri";

type UseUndoCheckpointsOptions = {
  workspaceId: string | null;
  threadId: string | null;
  limit?: number;
};

type RefreshOptions = {
  silent?: boolean;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const text = String(error ?? "").trim();
  return text || "Operation failed.";
}

function buildUndoConfirmMessage(checkpoint: UndoCheckpointSummary | null): string {
  if (!checkpoint) {
    return "Undo this checkpoint?\n\nThis will revert files edited in the selected turn.";
  }

  const filePaths = checkpoint.files.map((file) => file.path).filter(Boolean);
  if (filePaths.length === 0) {
    return "Undo this checkpoint?\n\nNo file edits were captured for this checkpoint.";
  }

  const previewLimit = 6;
  const preview = filePaths.slice(0, previewLimit).join("\n");
  const extraCount = filePaths.length - previewLimit;
  const extraLine =
    extraCount > 0 ? `\n... and ${extraCount} more file${extraCount === 1 ? "" : "s"}` : "";
  return `Undo this checkpoint?\n\nThe following files will be reverted:\n${preview}${extraLine}`;
}

export function useUndoCheckpoints({
  workspaceId,
  threadId,
  limit = 10,
}: UseUndoCheckpointsOptions) {
  const [checkpoints, setCheckpoints] = useState<UndoCheckpointSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoingCheckpointId, setUndoingCheckpointId] = useState<string | null>(null);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      if (!workspaceId || !threadId) {
        setCheckpoints([]);
        setError(null);
        setIsLoading(false);
        return;
      }
      const silent = options?.silent ?? false;
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const result = await listUndoCheckpoints(workspaceId, {
          threadId,
          limit,
        });
        setCheckpoints(Array.isArray(result.entries) ? result.entries : []);
        setError(null);
      } catch (refreshError) {
        setError(toErrorMessage(refreshError));
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [limit, threadId, workspaceId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAppServerEvents({
    onTurnCompleted: (eventWorkspaceId, eventThreadId) => {
      if (!workspaceId || eventWorkspaceId !== workspaceId) {
        return;
      }
      if (!threadId || eventThreadId !== threadId) {
        return;
      }
      void refresh({ silent: true });
    },
    onTurnError: (eventWorkspaceId, eventThreadId) => {
      if (!workspaceId || eventWorkspaceId !== workspaceId) {
        return;
      }
      if (!threadId || eventThreadId !== threadId) {
        return;
      }
      void refresh({ silent: true });
    },
  });

  const runUndo = useCallback(
    async (checkpointId: string) => {
      if (!workspaceId || !checkpointId.trim()) {
        return;
      }
      const checkpoint = checkpoints.find((entry) => entry.id === checkpointId) ?? null;
      const confirmed = await ask(buildUndoConfirmMessage(checkpoint), {
        title: "Undo checkpoint",
        kind: "warning",
        okLabel: "Undo",
        cancelLabel: "Cancel",
      });
      if (!confirmed) {
        return;
      }
      setUndoingCheckpointId(checkpointId);
      let succeeded = false;
      try {
        await undoCheckpoint(workspaceId, checkpointId);
        setError(null);
        succeeded = true;
      } catch (undoError) {
        setError(toErrorMessage(undoError));
      } finally {
        setUndoingCheckpointId(null);
      }
      if (succeeded) {
        await refresh();
      }
    },
    [checkpoints, refresh, workspaceId],
  );

  return {
    checkpoints,
    isLoading,
    error,
    undoingCheckpointId,
    refresh,
    runUndo,
    clearError: () => setError(null),
  };
}
