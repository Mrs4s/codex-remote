// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { useThreadFolders } from "./useThreadFolders";

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...(overrides as AppSettings),
    threadFoldersByWorkspace: overrides.threadFoldersByWorkspace ?? {},
    threadFolderAssignmentsByWorkspace:
      overrides.threadFolderAssignmentsByWorkspace ?? {},
  } as AppSettings;
}

describe("useThreadFolders", () => {
  it("creates, renames, and deletes thread folders", async () => {
    const queueSaveSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [appSettings, setAppSettings] = useState<AppSettings>(makeSettings());
      return useThreadFolders({
        appSettings,
        setAppSettings,
        queueSaveSettings,
      });
    });

    let createdFolderId = "";
    act(() => {
      const created = result.current.createThreadFolder({
        workspaceId: "ws-1",
        name: "  Inbox  ",
      });
      createdFolderId = created.id;
      expect(created.name).toBe("Inbox");
    });

    expect(result.current.getThreadFolders("ws-1")).toHaveLength(1);
    expect(result.current.getThreadFolders("ws-1")[0]?.name).toBe("Inbox");

    act(() => {
      result.current.renameThreadFolder({
        workspaceId: "ws-1",
        folderId: createdFolderId,
        name: "Priority",
      });
    });

    expect(result.current.getThreadFolders("ws-1")[0]?.name).toBe("Priority");

    act(() => {
      result.current.deleteThreadFolder({
        workspaceId: "ws-1",
        folderId: createdFolderId,
      });
    });

    expect(result.current.getThreadFolders("ws-1")).toHaveLength(0);
    expect(queueSaveSettings).toHaveBeenCalled();
  });

  it("rejects duplicate folder names (case-insensitive)", () => {
    const queueSaveSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [appSettings, setAppSettings] = useState<AppSettings>(
        makeSettings({
          threadFoldersByWorkspace: {
            "ws-1": [
              {
                id: "folder-1",
                name: "Backlog",
                sortOrder: 0,
                createdAt: 1,
              },
            ],
          },
        }),
      );
      return useThreadFolders({
        appSettings,
        setAppSettings,
        queueSaveSettings,
      });
    });

    expect(() =>
      result.current.createThreadFolder({
        workspaceId: "ws-1",
        name: " backlog ",
      }),
    ).toThrow("already exists");
  });

  it("assigns and clears thread folder mapping", () => {
    const queueSaveSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [appSettings, setAppSettings] = useState<AppSettings>(
        makeSettings({
          threadFoldersByWorkspace: {
            "ws-1": [
              {
                id: "folder-1",
                name: "Focus",
                sortOrder: 0,
                createdAt: 1,
              },
            ],
          },
        }),
      );
      return useThreadFolders({
        appSettings,
        setAppSettings,
        queueSaveSettings,
      });
    });

    act(() => {
      result.current.assignThreadFolder({
        workspaceId: "ws-1",
        threadId: "thread-1",
        folderId: "folder-1",
      });
    });
    expect(result.current.getThreadFolderId("ws-1", "thread-1")).toBe("folder-1");

    act(() => {
      result.current.clearThreadFolderAssignment("ws-1", "thread-1");
    });
    expect(result.current.getThreadFolderId("ws-1", "thread-1")).toBeNull();
  });

  it("drops stale assignments that point to missing folders", async () => {
    const queueSaveSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [appSettings, setAppSettings] = useState<AppSettings>(
        makeSettings({
          threadFoldersByWorkspace: {
            "ws-1": [],
          },
          threadFolderAssignmentsByWorkspace: {
            "ws-1": {
              "thread-1": "missing-folder",
            },
          },
        }),
      );
      return useThreadFolders({
        appSettings,
        setAppSettings,
        queueSaveSettings,
      });
    });

    await waitFor(() => {
      expect(result.current.getThreadFolderId("ws-1", "thread-1")).toBeNull();
    });
  });
});
