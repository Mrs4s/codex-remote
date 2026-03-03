import { useCallback, useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings, ThreadFolder } from "@/types";

type SetAppSettings = Dispatch<SetStateAction<AppSettings>>;
type QueueSaveSettings = (next: AppSettings) => Promise<AppSettings | void>;

type UseThreadFoldersOptions = {
  appSettings: AppSettings;
  setAppSettings: SetAppSettings;
  queueSaveSettings: QueueSaveSettings;
};

type CreateThreadFolderOptions = {
  workspaceId: string;
  name: string;
};

type RenameThreadFolderOptions = {
  workspaceId: string;
  folderId: string;
  name: string;
};

type DeleteThreadFolderOptions = {
  workspaceId: string;
  folderId: string;
};

type AssignThreadFolderOptions = {
  workspaceId: string;
  threadId: string;
  folderId: string | null;
};

const RANDOM_ID_MAX = 1_000_000;

function createThreadFolderId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `thread-folder-${Date.now()}-${Math.floor(Math.random() * RANDOM_ID_MAX)}`;
}

function normalizeThreadFolderName(name: string) {
  return name.trim();
}

function sortThreadFolders(folders: ThreadFolder[]): ThreadFolder[] {
  return folders.slice().sort((a, b) => {
    const orderDiff = a.sortOrder - b.sortOrder;
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.name.localeCompare(b.name);
  });
}

function hasDuplicateThreadFolderName(
  folders: ThreadFolder[],
  name: string,
  excludeFolderId?: string,
) {
  const target = normalizeThreadFolderName(name).toLowerCase();
  return folders.some(
    (folder) =>
      folder.id !== excludeFolderId &&
      normalizeThreadFolderName(folder.name).toLowerCase() === target,
  );
}

function cleanupWorkspaceFolderAssignments(
  assignments: Record<string, string>,
  validFolderIds: Set<string>,
) {
  const next: Record<string, string> = {};
  let didChange = false;
  Object.entries(assignments).forEach(([threadId, folderId]) => {
    const trimmedThreadId = threadId.trim();
    const trimmedFolderId = folderId.trim();
    if (!trimmedThreadId || !trimmedFolderId || !validFolderIds.has(trimmedFolderId)) {
      didChange = true;
      return;
    }
    next[trimmedThreadId] = trimmedFolderId;
    if (trimmedThreadId !== threadId || trimmedFolderId !== folderId) {
      didChange = true;
    }
  });
  return {
    assignments: next,
    didChange,
  };
}

export function useThreadFolders({
  appSettings,
  setAppSettings,
  queueSaveSettings,
}: UseThreadFoldersOptions) {
  const foldersByWorkspace = appSettings.threadFoldersByWorkspace ?? {};
  const assignmentsByWorkspace = appSettings.threadFolderAssignmentsByWorkspace ?? {};

  useEffect(() => {
    let didMutate = false;
    const nextAssignmentsByWorkspace: Record<string, Record<string, string>> = {};

    Object.entries(assignmentsByWorkspace).forEach(([workspaceId, assignments]) => {
      const validFolderIds = new Set(
        (foldersByWorkspace[workspaceId] ?? []).map((folder) => folder.id),
      );
      const cleaned = cleanupWorkspaceFolderAssignments(assignments, validFolderIds);
      if (cleaned.didChange) {
        didMutate = true;
      }
      if (Object.keys(cleaned.assignments).length > 0) {
        nextAssignmentsByWorkspace[workspaceId] = cleaned.assignments;
      }
    });

    if (!didMutate) {
      return;
    }

    setAppSettings((current) => {
      const next = {
        ...current,
        threadFolderAssignmentsByWorkspace: nextAssignmentsByWorkspace,
      };
      void queueSaveSettings(next);
      return next;
    });
  }, [assignmentsByWorkspace, foldersByWorkspace, queueSaveSettings, setAppSettings]);

  const getThreadFolders = useCallback(
    (workspaceId: string) => sortThreadFolders(foldersByWorkspace[workspaceId] ?? []),
    [foldersByWorkspace],
  );

  const getThreadFolderById = useCallback(
    (workspaceId: string, folderId: string) =>
      (foldersByWorkspace[workspaceId] ?? []).find((folder) => folder.id === folderId) ?? null,
    [foldersByWorkspace],
  );

  const getThreadFolderId = useCallback(
    (workspaceId: string, threadId: string) => {
      const folderId = assignmentsByWorkspace[workspaceId]?.[threadId] ?? null;
      if (!folderId) {
        return null;
      }
      return getThreadFolderById(workspaceId, folderId) ? folderId : null;
    },
    [assignmentsByWorkspace, getThreadFolderById],
  );

  const createThreadFolder = useCallback(
    ({ workspaceId, name }: CreateThreadFolderOptions) => {
      const trimmedWorkspaceId = workspaceId.trim();
      const trimmedName = normalizeThreadFolderName(name);
      if (!trimmedWorkspaceId) {
        throw new Error("Workspace is required.");
      }
      if (!trimmedName) {
        throw new Error("Folder name is required.");
      }

      const existingFolders = sortThreadFolders(foldersByWorkspace[trimmedWorkspaceId] ?? []);
      if (hasDuplicateThreadFolderName(existingFolders, trimmedName)) {
        throw new Error("A folder with this name already exists.");
      }

      const nextSortOrder =
        existingFolders.length > 0
          ? Math.max(...existingFolders.map((folder) => folder.sortOrder)) + 1
          : 0;
      const createdFolder: ThreadFolder = {
        id: createThreadFolderId(),
        name: trimmedName,
        sortOrder: nextSortOrder,
        createdAt: Date.now(),
      };

      setAppSettings((current) => {
        const currentFolders = sortThreadFolders(
          current.threadFoldersByWorkspace[trimmedWorkspaceId] ?? [],
        );
        if (hasDuplicateThreadFolderName(currentFolders, trimmedName)) {
          return current;
        }
        const next = {
          ...current,
          threadFoldersByWorkspace: {
            ...current.threadFoldersByWorkspace,
            [trimmedWorkspaceId]: [...currentFolders, createdFolder],
          },
        };
        void queueSaveSettings(next);
        return next;
      });

      return createdFolder;
    },
    [foldersByWorkspace, queueSaveSettings, setAppSettings],
  );

  const renameThreadFolder = useCallback(
    ({ workspaceId, folderId, name }: RenameThreadFolderOptions) => {
      const trimmedWorkspaceId = workspaceId.trim();
      const trimmedFolderId = folderId.trim();
      const trimmedName = normalizeThreadFolderName(name);
      if (!trimmedWorkspaceId || !trimmedFolderId) {
        throw new Error("Folder not found.");
      }
      if (!trimmedName) {
        throw new Error("Folder name is required.");
      }

      const existingFolders = foldersByWorkspace[trimmedWorkspaceId] ?? [];
      const target = existingFolders.find((folder) => folder.id === trimmedFolderId);
      if (!target) {
        throw new Error("Folder not found.");
      }
      if (hasDuplicateThreadFolderName(existingFolders, trimmedName, trimmedFolderId)) {
        throw new Error("A folder with this name already exists.");
      }
      if (normalizeThreadFolderName(target.name) === trimmedName) {
        return;
      }

      setAppSettings((current) => {
        const workspaceFolders = current.threadFoldersByWorkspace[trimmedWorkspaceId] ?? [];
        if (hasDuplicateThreadFolderName(workspaceFolders, trimmedName, trimmedFolderId)) {
          return current;
        }
        const nextFolders = workspaceFolders.map((folder) =>
          folder.id === trimmedFolderId ? { ...folder, name: trimmedName } : folder,
        );
        const next = {
          ...current,
          threadFoldersByWorkspace: {
            ...current.threadFoldersByWorkspace,
            [trimmedWorkspaceId]: nextFolders,
          },
        };
        void queueSaveSettings(next);
        return next;
      });
    },
    [foldersByWorkspace, queueSaveSettings, setAppSettings],
  );

  const deleteThreadFolder = useCallback(
    ({ workspaceId, folderId }: DeleteThreadFolderOptions) => {
      const trimmedWorkspaceId = workspaceId.trim();
      const trimmedFolderId = folderId.trim();
      if (!trimmedWorkspaceId || !trimmedFolderId) {
        return;
      }

      setAppSettings((current) => {
        const workspaceFolders = current.threadFoldersByWorkspace[trimmedWorkspaceId] ?? [];
        if (!workspaceFolders.some((folder) => folder.id === trimmedFolderId)) {
          return current;
        }

        const nextFolders = workspaceFolders.filter((folder) => folder.id !== trimmedFolderId);
        const workspaceAssignments =
          current.threadFolderAssignmentsByWorkspace[trimmedWorkspaceId] ?? {};
        const nextWorkspaceAssignments = Object.fromEntries(
          Object.entries(workspaceAssignments).filter(
            ([, assignedFolderId]) => assignedFolderId !== trimmedFolderId,
          ),
        );

        const nextFoldersByWorkspace = { ...current.threadFoldersByWorkspace };
        if (nextFolders.length > 0) {
          nextFoldersByWorkspace[trimmedWorkspaceId] = nextFolders;
        } else {
          delete nextFoldersByWorkspace[trimmedWorkspaceId];
        }

        const nextAssignmentsByWorkspace = {
          ...current.threadFolderAssignmentsByWorkspace,
        };
        if (Object.keys(nextWorkspaceAssignments).length > 0) {
          nextAssignmentsByWorkspace[trimmedWorkspaceId] = nextWorkspaceAssignments;
        } else {
          delete nextAssignmentsByWorkspace[trimmedWorkspaceId];
        }

        const next = {
          ...current,
          threadFoldersByWorkspace: nextFoldersByWorkspace,
          threadFolderAssignmentsByWorkspace: nextAssignmentsByWorkspace,
        };
        void queueSaveSettings(next);
        return next;
      });
    },
    [queueSaveSettings, setAppSettings],
  );

  const assignThreadFolder = useCallback(
    ({ workspaceId, threadId, folderId }: AssignThreadFolderOptions) => {
      const trimmedWorkspaceId = workspaceId.trim();
      const trimmedThreadId = threadId.trim();
      const trimmedFolderId = folderId?.trim() || null;
      if (!trimmedWorkspaceId || !trimmedThreadId) {
        return;
      }

      const validFolderIds = new Set(
        (foldersByWorkspace[trimmedWorkspaceId] ?? []).map((folder) => folder.id),
      );
      const resolvedFolderId =
        trimmedFolderId && validFolderIds.has(trimmedFolderId) ? trimmedFolderId : null;

      setAppSettings((current) => {
        const currentAssignments =
          current.threadFolderAssignmentsByWorkspace[trimmedWorkspaceId] ?? {};
        const existingFolderId = currentAssignments[trimmedThreadId] ?? null;
        if (existingFolderId === resolvedFolderId) {
          return current;
        }

        const nextWorkspaceAssignments = { ...currentAssignments };
        if (resolvedFolderId) {
          nextWorkspaceAssignments[trimmedThreadId] = resolvedFolderId;
        } else {
          delete nextWorkspaceAssignments[trimmedThreadId];
        }

        const nextAssignmentsByWorkspace = {
          ...current.threadFolderAssignmentsByWorkspace,
        };
        if (Object.keys(nextWorkspaceAssignments).length > 0) {
          nextAssignmentsByWorkspace[trimmedWorkspaceId] = nextWorkspaceAssignments;
        } else {
          delete nextAssignmentsByWorkspace[trimmedWorkspaceId];
        }

        const next = {
          ...current,
          threadFolderAssignmentsByWorkspace: nextAssignmentsByWorkspace,
        };
        void queueSaveSettings(next);
        return next;
      });
    },
    [foldersByWorkspace, queueSaveSettings, setAppSettings],
  );

  const clearThreadFolderAssignment = useCallback(
    (workspaceId: string, threadId: string) => {
      assignThreadFolder({ workspaceId, threadId, folderId: null });
    },
    [assignThreadFolder],
  );

  const threadFolderState = useMemo(
    () => ({
      foldersByWorkspace,
      assignmentsByWorkspace,
    }),
    [assignmentsByWorkspace, foldersByWorkspace],
  );

  return {
    threadFolderState,
    getThreadFolders,
    getThreadFolderById,
    getThreadFolderId,
    createThreadFolder,
    renameThreadFolder,
    deleteThreadFolder,
    assignThreadFolder,
    clearThreadFolderAssignment,
  };
}
