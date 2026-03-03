import type { ThreadFolder, ThreadSummary } from "@/types";

export type ThreadListRow = {
  thread: ThreadSummary;
  depth: number;
};

export type ThreadFolderSection = {
  folderId: string | null;
  name: string;
  rows: ThreadListRow[];
  rootCount: number;
};

type BuildThreadFolderSectionsOptions = {
  workspaceId: string;
  rows: ThreadListRow[];
  folders: ThreadFolder[];
  getThreadFolderId: (workspaceId: string, threadId: string) => string | null;
  ungroupedLabel?: string;
};

const DEFAULT_UNGROUPED_LABEL = "Ungrouped";

type ThreadRootCluster = {
  rootThreadId: string;
  rows: ThreadListRow[];
};

function buildThreadRootClusters(rows: ThreadListRow[]): ThreadRootCluster[] {
  const clusters: ThreadRootCluster[] = [];
  let currentRootThreadId: string | null = null;
  let currentRows: ThreadListRow[] = [];

  rows.forEach((row) => {
    if (row.depth === 0) {
      if (currentRootThreadId && currentRows.length > 0) {
        clusters.push({
          rootThreadId: currentRootThreadId,
          rows: currentRows,
        });
      }
      currentRootThreadId = row.thread.id;
      currentRows = [row];
      return;
    }
    if (!currentRootThreadId) {
      return;
    }
    currentRows.push(row);
  });

  if (currentRootThreadId && currentRows.length > 0) {
    clusters.push({
      rootThreadId: currentRootThreadId,
      rows: currentRows,
    });
  }

  return clusters;
}

export function buildThreadFolderSections({
  workspaceId,
  rows,
  folders,
  getThreadFolderId,
  ungroupedLabel = DEFAULT_UNGROUPED_LABEL,
}: BuildThreadFolderSectionsOptions): ThreadFolderSection[] {
  const rootClusters = buildThreadRootClusters(rows);
  const sortedFolders = folders.slice().sort((a, b) => {
    const sortDiff = a.sortOrder - b.sortOrder;
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return a.name.localeCompare(b.name);
  });

  const folderById = new Map(sortedFolders.map((folder) => [folder.id, folder]));
  const sectionByFolderId = new Map<string | null, ThreadFolderSection>();
  sectionByFolderId.set(null, {
    folderId: null,
    name: ungroupedLabel,
    rows: [],
    rootCount: 0,
  });
  sortedFolders.forEach((folder) => {
    sectionByFolderId.set(folder.id, {
      folderId: folder.id,
      name: folder.name,
      rows: [],
      rootCount: 0,
    });
  });

  rootClusters.forEach((cluster) => {
    const assignedFolderId = getThreadFolderId(workspaceId, cluster.rootThreadId);
    const folderId =
      assignedFolderId && folderById.has(assignedFolderId) ? assignedFolderId : null;
    const targetSection = sectionByFolderId.get(folderId);
    if (!targetSection) {
      return;
    }
    targetSection.rows.push(...cluster.rows);
    targetSection.rootCount += 1;
  });

  const orderedSectionIds: Array<string | null> = [null, ...sortedFolders.map((folder) => folder.id)];

  return orderedSectionIds
    .map((sectionId) => sectionByFolderId.get(sectionId) ?? null)
    .filter(
      (section): section is ThreadFolderSection =>
        Boolean(
          section &&
            (section.folderId !== null || section.rows.length > 0),
        ),
    );
}
