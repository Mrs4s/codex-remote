import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BranchInfo, DebugEntry, WorkspaceInfo } from "../../../types";
import {
  checkoutGitHubPullRequest,
  checkoutGitBranch,
  createGitBranch,
  listGitBranches,
} from "../../../services/tauri";

type UseGitBranchesOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
};

export function useGitBranches({ activeWorkspace, onDebug }: UseGitBranchesOptions) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<BranchInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);

  const refreshBranches = useCallback(async () => {
    const normalizeBranchList = (data: unknown): BranchInfo[] => {
      if (!Array.isArray(data)) {
        return [];
      }
      return data
        .map((item: any) => ({
          name: String(item?.name ?? ""),
          lastCommit: Number(item?.lastCommit ?? item?.last_commit ?? 0),
        }))
        .filter((branch) => branch.name);
    };

    if (!workspaceId || !isConnected) {
      setBranches([]);
      setRemoteBranches([]);
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    onDebug?.({
      id: `${Date.now()}-client-branches-list`,
      timestamp: Date.now(),
      source: "client",
      label: "git/branches/list",
      payload: { workspaceId },
    });
    try {
      const response = await listGitBranches(workspaceId);
      onDebug?.({
        id: `${Date.now()}-server-branches-list`,
        timestamp: Date.now(),
        source: "server",
        label: "git/branches/list response",
        payload: response,
      });
      const localData = response?.branches ?? response?.result?.branches ?? response ?? [];
      const remoteData =
        response?.remoteBranches ??
        response?.remote_branches ??
        response?.result?.remoteBranches ??
        response?.result?.remote_branches ??
        [];
      setBranches(normalizeBranchList(localData));
      setRemoteBranches(normalizeBranchList(remoteData));
      lastFetchedWorkspaceId.current = workspaceId;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      onDebug?.({
        id: `${Date.now()}-client-branches-list-error`,
        timestamp: Date.now(),
        source: "error",
        label: "git/branches/list error",
        payload: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlight.current = false;
    }
  }, [isConnected, onDebug, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && branches.length > 0) {
      return;
    }
    refreshBranches();
  }, [branches.length, isConnected, refreshBranches, workspaceId]);

  const recentBranches = useMemo(
    () => branches.slice().sort((a, b) => b.lastCommit - a.lastCommit),
    [branches],
  );
  const recentRemoteBranches = useMemo(
    () => remoteBranches.slice().sort((a, b) => b.lastCommit - a.lastCommit),
    [remoteBranches],
  );

  const checkoutBranch = useCallback(
    async (name: string) => {
      if (!workspaceId || !name) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-branch-checkout`,
        timestamp: Date.now(),
        source: "client",
        label: "git/branch/checkout",
        payload: { workspaceId, name },
      });
      await checkoutGitBranch(workspaceId, name);
      void refreshBranches();
    },
    [onDebug, refreshBranches, workspaceId],
  );

  const checkoutPullRequest = useCallback(
    async (prNumber: number) => {
      if (!workspaceId || !Number.isFinite(prNumber)) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-pr-checkout`,
        timestamp: Date.now(),
        source: "client",
        label: "git/pr/checkout",
        payload: { workspaceId, prNumber },
      });
      await checkoutGitHubPullRequest(workspaceId, prNumber);
      void refreshBranches();
    },
    [onDebug, refreshBranches, workspaceId],
  );

  const createBranch = useCallback(
    async (name: string) => {
      if (!workspaceId || !name) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-branch-create`,
        timestamp: Date.now(),
        source: "client",
        label: "git/branch/create",
        payload: { workspaceId, name },
      });
      await createGitBranch(workspaceId, name);
      void refreshBranches();
    },
    [onDebug, refreshBranches, workspaceId],
  );

  return {
    branches: recentBranches,
    remoteBranches: recentRemoteBranches,
    error,
    refreshBranches,
    checkoutBranch,
    checkoutPullRequest,
    createBranch,
  };
}
