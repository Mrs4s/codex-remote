import { useCallback, useState } from "react";
import type { ThreadFolder } from "@/types";

export type ThreadFolderPromptState = {
  mode: "create" | "rename";
  workspaceId: string;
  workspaceName: string;
  folderId: string | null;
  targetThreadId: string | null;
  name: string;
  originalName: string | null;
  error: string | null;
};

type UseThreadFolderPromptOptions = {
  getWorkspaceName: (workspaceId: string) => string | undefined;
  getThreadFolderById: (workspaceId: string, folderId: string) => ThreadFolder | null;
  createThreadFolder: (options: { workspaceId: string; name: string }) => ThreadFolder;
  renameThreadFolder: (options: {
    workspaceId: string;
    folderId: string;
    name: string;
  }) => void;
  assignThreadFolder: (options: {
    workspaceId: string;
    threadId: string;
    folderId: string | null;
  }) => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function useThreadFolderPrompt({
  getWorkspaceName,
  getThreadFolderById,
  createThreadFolder,
  renameThreadFolder,
  assignThreadFolder,
}: UseThreadFolderPromptOptions) {
  const [threadFolderPrompt, setThreadFolderPrompt] =
    useState<ThreadFolderPromptState | null>(null);

  const openCreateThreadFolderPrompt = useCallback(
    (workspaceId: string, targetThreadId: string | null = null) => {
      const workspaceName = getWorkspaceName(workspaceId) ?? "Project";
      setThreadFolderPrompt({
        mode: "create",
        workspaceId,
        workspaceName,
        folderId: null,
        targetThreadId,
        name: "",
        originalName: null,
        error: null,
      });
    },
    [getWorkspaceName],
  );

  const openRenameThreadFolderPrompt = useCallback(
    (workspaceId: string, folderId: string) => {
      const folder = getThreadFolderById(workspaceId, folderId);
      if (!folder) {
        return;
      }
      const workspaceName = getWorkspaceName(workspaceId) ?? "Project";
      setThreadFolderPrompt({
        mode: "rename",
        workspaceId,
        workspaceName,
        folderId,
        targetThreadId: null,
        name: folder.name,
        originalName: folder.name,
        error: null,
      });
    },
    [getThreadFolderById, getWorkspaceName],
  );

  const handleThreadFolderPromptChange = useCallback((value: string) => {
    setThreadFolderPrompt((current) =>
      current
        ? {
            ...current,
            name: value,
            error: null,
          }
        : current,
    );
  }, []);

  const handleThreadFolderPromptCancel = useCallback(() => {
    setThreadFolderPrompt(null);
  }, []);

  const handleThreadFolderPromptConfirm = useCallback(() => {
    if (!threadFolderPrompt) {
      return;
    }

    try {
      if (threadFolderPrompt.mode === "create") {
        const created = createThreadFolder({
          workspaceId: threadFolderPrompt.workspaceId,
          name: threadFolderPrompt.name,
        });
        if (threadFolderPrompt.targetThreadId) {
          assignThreadFolder({
            workspaceId: threadFolderPrompt.workspaceId,
            threadId: threadFolderPrompt.targetThreadId,
            folderId: created.id,
          });
        }
        setThreadFolderPrompt(null);
        return;
      }

      if (!threadFolderPrompt.folderId) {
        setThreadFolderPrompt((current) =>
          current
            ? {
                ...current,
                error: "Folder not found.",
              }
            : current,
        );
        return;
      }

      renameThreadFolder({
        workspaceId: threadFolderPrompt.workspaceId,
        folderId: threadFolderPrompt.folderId,
        name: threadFolderPrompt.name,
      });
      setThreadFolderPrompt(null);
    } catch (error) {
      setThreadFolderPrompt((current) =>
        current
          ? {
              ...current,
              error: getErrorMessage(error),
            }
          : current,
      );
    }
  }, [
    assignThreadFolder,
    createThreadFolder,
    renameThreadFolder,
    threadFolderPrompt,
  ]);

  return {
    threadFolderPrompt,
    openCreateThreadFolderPrompt,
    openRenameThreadFolderPrompt,
    handleThreadFolderPromptChange,
    handleThreadFolderPromptCancel,
    handleThreadFolderPromptConfirm,
  };
}
