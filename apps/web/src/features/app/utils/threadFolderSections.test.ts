import { describe, expect, it } from "vitest";
import type { ThreadFolder, ThreadSummary } from "@/types";
import { buildThreadFolderSections, type ThreadListRow } from "./threadFolderSections";

function row(thread: ThreadSummary, depth = 0): ThreadListRow {
  return { thread, depth };
}

describe("buildThreadFolderSections", () => {
  it("keeps root+child rows together under the root thread folder", () => {
    const root = { id: "thread-root", name: "Root", updatedAt: 10 };
    const child = { id: "thread-child", name: "Child", updatedAt: 9, isSubagent: true };
    const secondRoot = { id: "thread-2", name: "Second", updatedAt: 8 };
    const folders: ThreadFolder[] = [
      {
        id: "folder-1",
        name: "Important",
        sortOrder: 1,
        createdAt: 1,
      },
    ];

    const sections = buildThreadFolderSections({
      workspaceId: "ws-1",
      rows: [row(root), row(child, 1), row(secondRoot)],
      folders,
      getThreadFolderId: (_workspaceId, threadId) =>
        threadId === "thread-root" ? "folder-1" : null,
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]?.folderId).toBeNull();
    expect(sections[0]?.rows.map((entry) => entry.thread.id)).toEqual(["thread-2"]);
    expect(sections[1]?.folderId).toBe("folder-1");
    expect(sections[1]?.rows.map((entry) => [entry.thread.id, entry.depth])).toEqual([
      ["thread-root", 0],
      ["thread-child", 1],
    ]);
  });

  it("falls back to ungrouped when assignment points to an unknown folder", () => {
    const sections = buildThreadFolderSections({
      workspaceId: "ws-1",
      rows: [row({ id: "thread-1", name: "One", updatedAt: 10 })],
      folders: [],
      getThreadFolderId: () => "missing-folder",
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.folderId).toBeNull();
    expect(sections[0]?.rows.map((entry) => entry.thread.id)).toEqual(["thread-1"]);
  });

  it("orders folder sections by sort order then name", () => {
    const folders: ThreadFolder[] = [
      { id: "folder-b", name: "B", sortOrder: 2, createdAt: 1 },
      { id: "folder-a2", name: "A2", sortOrder: 1, createdAt: 1 },
      { id: "folder-a1", name: "A1", sortOrder: 1, createdAt: 1 },
    ];
    const sections = buildThreadFolderSections({
      workspaceId: "ws-1",
      rows: [
        row({ id: "thread-a", name: "A", updatedAt: 3 }),
        row({ id: "thread-b", name: "B", updatedAt: 2 }),
        row({ id: "thread-c", name: "C", updatedAt: 1 }),
      ],
      folders,
      getThreadFolderId: (_workspaceId, threadId) => {
        if (threadId === "thread-a") {
          return "folder-b";
        }
        if (threadId === "thread-b") {
          return "folder-a2";
        }
        if (threadId === "thread-c") {
          return "folder-a1";
        }
        return null;
      },
    });

    expect(sections.map((section) => section.folderId)).toEqual([
      "folder-a1",
      "folder-a2",
      "folder-b",
    ]);
  });

  it("keeps named folders visible even when they have no threads", () => {
    const sections = buildThreadFolderSections({
      workspaceId: "ws-1",
      rows: [row({ id: "thread-1", name: "One", updatedAt: 10 })],
      folders: [
        { id: "folder-empty", name: "Empty", sortOrder: 1, createdAt: 1 },
        { id: "folder-used", name: "Used", sortOrder: 2, createdAt: 1 },
      ],
      getThreadFolderId: (_workspaceId, threadId) =>
        threadId === "thread-1" ? "folder-used" : null,
    });

    expect(sections.map((section) => section.folderId)).toEqual([
      "folder-empty",
      "folder-used",
    ]);
    expect(sections[0]?.rows).toEqual([]);
    expect(sections[1]?.rows.map((entry) => entry.thread.id)).toEqual(["thread-1"]);
  });
});
