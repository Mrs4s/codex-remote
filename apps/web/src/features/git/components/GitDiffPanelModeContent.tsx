import type { BranchInfo, GitHubIssue, GitHubPullRequest, GitLogEntry } from "../../../types";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Download from "lucide-react/dist/esm/icons/download";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";
import Upload from "lucide-react/dist/esm/icons/upload";
import { formatRelativeTime } from "../../../utils/time";
import {
  MagicSparkleIcon,
  MagicSparkleLoaderIcon,
} from "@/features/shared/components/MagicSparkleIcon";
import type { GitPanelMode } from "../types";
import type { PerFileDiffGroup } from "../utils/perFileThreadDiffs";
import { ModalShell } from "../../design-system/components/modal/ModalShell";
import {
  CommitButton,
  DiffSection,
  type DiffFile,
  GitLogEntryRow,
} from "./GitDiffPanelShared";
import { pushErrorToast } from "../../../services/toasts";
import {
  DEPTH_OPTIONS,
  isGitRootNotFound,
  isMissingRepo,
  normalizeRootPath,
  splitPath,
} from "./GitDiffPanel.utils";

type GitMode = GitPanelMode;

type GitPanelModeStatusProps = {
  mode: GitMode;
  diffStatusLabel: string;
  perFileDiffStatusLabel: string;
  logCountLabel: string;
  logSyncLabel: string;
  logUpstreamLabel: string;
  issuesLoading: boolean;
  issuesTotal: number;
  pullRequestsLoading: boolean;
  pullRequestsTotal: number;
};

export function GitPanelModeStatus({
  mode,
  diffStatusLabel,
  perFileDiffStatusLabel,
  logCountLabel,
  logSyncLabel,
  logUpstreamLabel,
  issuesLoading,
  issuesTotal,
  pullRequestsLoading,
  pullRequestsTotal,
}: GitPanelModeStatusProps) {
  if (mode === "diff") {
    return <div className="diff-status">{diffStatusLabel}</div>;
  }

  if (mode === "perFile") {
    return <div className="diff-status">{perFileDiffStatusLabel}</div>;
  }

  if (mode === "log") {
    return (
      <>
        <div className="diff-status">{logCountLabel}</div>
        <div className="git-log-sync">
          <span>{logSyncLabel}</span>
          {logUpstreamLabel && (
            <>
              <span className="git-log-sep">·</span>
              <span>{logUpstreamLabel}</span>
            </>
          )}
        </div>
      </>
    );
  }

  if (mode === "issues") {
    return (
      <>
        <div className="diff-status diff-status-issues">
          <span>GitHub issues</span>
          {issuesLoading && <span className="git-panel-spinner" aria-hidden />}
        </div>
        <div className="git-log-sync">
          <span>{issuesTotal} open</span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="diff-status diff-status-issues">
        <span>GitHub pull requests</span>
        {pullRequestsLoading && <span className="git-panel-spinner" aria-hidden />}
      </div>
      <div className="git-log-sync">
        <span>{pullRequestsTotal} open</span>
      </div>
    </>
  );
}

type GitBranchRowProps = {
  mode: GitMode;
  branchName: string;
  branches: BranchInfo[];
  remoteBranches: BranchInfo[];
  onCheckoutBranch?: (name: string) => void | Promise<void>;
  onFetch?: () => void | Promise<void>;
  fetchLoading: boolean;
};

type BranchTreeNode = {
  key: string;
  label: string;
  fullName: string | null;
  children: BranchTreeNode[];
};

type BranchTreeFlatNode = {
  key: string;
  label: string;
  fullName: string | null;
  depth: number;
};

function buildBranchTree(branches: string[]): BranchTreeNode[] {
  type MutableNode = {
    key: string;
    label: string;
    fullName: string | null;
    children: Map<string, MutableNode>;
  };

  const root = new Map<string, MutableNode>();

  const ensureChild = (
    parent: Map<string, MutableNode>,
    segment: string,
    key: string,
  ) => {
    const existing = parent.get(segment);
    if (existing) {
      return existing;
    }
    const created: MutableNode = {
      key,
      label: segment,
      fullName: null,
      children: new Map<string, MutableNode>(),
    };
    parent.set(segment, created);
    return created;
  };

  for (const branch of branches) {
    const segments = branch.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    let path = "";
    let parent = root;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      path = path ? `${path}/${segment}` : segment;
      const node = ensureChild(parent, segment, path);
      if (index === segments.length - 1) {
        node.fullName = branch;
      }
      parent = node.children;
    }
  }

  const toReadonlyNodes = (map: Map<string, MutableNode>): BranchTreeNode[] =>
    Array.from(map.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((node) => ({
        key: node.key,
        label: node.label,
        fullName: node.fullName,
        children: toReadonlyNodes(node.children),
      }));

  return toReadonlyNodes(root);
}

function flattenBranchTree(nodes: BranchTreeNode[], depth = 0): BranchTreeFlatNode[] {
  const rows: BranchTreeFlatNode[] = [];
  for (const node of nodes) {
    rows.push({
      key: node.key,
      label: node.label,
      fullName: node.fullName,
      depth,
    });
    if (node.children.length > 0) {
      rows.push(...flattenBranchTree(node.children, depth + 1));
    }
  }
  return rows;
}

type BranchSwitchDialogProps = {
  open: boolean;
  localBranches: string[];
  remoteBranches: string[];
  currentBranch: string;
  switching: boolean;
  onClose: () => void;
  onConfirm: (branch: string) => void;
};

function BranchSwitchDialog({
  open,
  localBranches,
  remoteBranches,
  currentBranch,
  switching,
  onClose,
  onConfirm,
}: BranchSwitchDialogProps) {
  type BranchTab = "local" | "remote";
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<BranchTab>("local");
  const [selectedBranch, setSelectedBranch] = useState(currentBranch);

  useEffect(() => {
    if (!open) {
      return;
    }
    const defaultTab: BranchTab =
      currentBranch && remoteBranches.includes(currentBranch)
        ? "remote"
        : localBranches.length > 0
          ? "local"
          : "remote";
    const defaultBranches = defaultTab === "local" ? localBranches : remoteBranches;
    const fallback =
      (currentBranch && defaultBranches.includes(currentBranch) ? currentBranch : null) ??
      defaultBranches[0] ??
      "";
    setActiveTab(defaultTab);
    setQuery("");
    setSelectedBranch(fallback);
  }, [currentBranch, localBranches, open, remoteBranches]);

  const branchesInTab = useMemo(
    () => (activeTab === "local" ? localBranches : remoteBranches),
    [activeTab, localBranches, remoteBranches],
  );

  const filteredBranches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return branchesInTab;
    }
    return branchesInTab.filter((branch) => branch.toLowerCase().includes(normalizedQuery));
  }, [branchesInTab, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedBranch((previous) => {
      if (previous && filteredBranches.includes(previous)) {
        return previous;
      }
      if (currentBranch && filteredBranches.includes(currentBranch)) {
        return currentBranch;
      }
      return filteredBranches[0] ?? "";
    });
  }, [activeTab, currentBranch, filteredBranches, open]);

  const treeRows = useMemo(
    () => flattenBranchTree(buildBranchTree(filteredBranches)),
    [filteredBranches],
  );

  if (!open) {
    return null;
  }

  const canConfirm =
    !switching &&
    selectedBranch.trim().length > 0 &&
    selectedBranch !== currentBranch &&
    filteredBranches.includes(selectedBranch);

  return (
    <ModalShell
      className="git-branch-tree-modal"
      onBackdropClick={switching ? undefined : onClose}
      ariaLabel="Switch branch"
    >
      <div className="git-branch-tree-title">Switch branch</div>
      <div className="git-branch-tree-tabs" role="tablist" aria-label="Branch source">
        <button
          type="button"
          role="tab"
          className={`git-branch-tree-tab${activeTab === "local" ? " active" : ""}`}
          aria-selected={activeTab === "local"}
          onClick={() => {
            setActiveTab("local");
            setQuery("");
          }}
          disabled={switching || localBranches.length === 0}
        >
          Local
        </button>
        <button
          type="button"
          role="tab"
          className={`git-branch-tree-tab${activeTab === "remote" ? " active" : ""}`}
          aria-selected={activeTab === "remote"}
          onClick={() => {
            setActiveTab("remote");
            setQuery("");
          }}
          disabled={switching || remoteBranches.length === 0}
        >
          Remote
        </button>
      </div>
      <input
        className="git-branch-tree-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Filter ${activeTab} branches...`}
        disabled={switching}
      />
      <div className="git-branch-tree-list" role="tree" aria-label="Branch tree">
        {treeRows.length === 0 ? (
          <div className="git-branch-tree-empty">No {activeTab} branches found</div>
        ) : (
          treeRows.map((row) => {
            const isLeaf = Boolean(row.fullName);
            const value = row.fullName ?? "";
            const isSelected = isLeaf && value === selectedBranch;
            const isCurrent = isLeaf && value === currentBranch;
            return (
              <div
                key={row.key}
                className="git-branch-tree-entry"
                style={{ paddingLeft: `${12 + row.depth * 16}px` }}
              >
                {isLeaf ? (
                  <button
                    type="button"
                    className={`git-branch-tree-item${isSelected ? " selected" : ""}`}
                    role="treeitem"
                    aria-selected={isSelected}
                    onClick={() => setSelectedBranch(value)}
                    disabled={switching}
                  >
                    <span className="git-branch-tree-item-label">{row.label}</span>
                    {isCurrent && <span className="git-branch-tree-badge">current</span>}
                  </button>
                ) : (
                  <div className="git-branch-tree-group" role="treeitem" aria-expanded="true">
                    {row.label}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="git-branch-tree-actions">
        <button
          type="button"
          className="ghost settings-button-compact"
          onClick={onClose}
          disabled={switching}
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary settings-button-compact"
          onClick={() => onConfirm(selectedBranch)}
          disabled={!canConfirm}
        >
          {switching ? "Switching..." : "Switch"}
        </button>
      </div>
    </ModalShell>
  );
}

export function GitBranchRow({
  mode,
  branchName,
  branches,
  remoteBranches,
  onCheckoutBranch,
  onFetch,
  fetchLoading,
}: GitBranchRowProps) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { localBranchOptions, remoteBranchOptions } = useMemo(() => {
    const toUniqueNames = (input: BranchInfo[]): string[] => {
      const names: string[] = [];
      const seen = new Set<string>();
      for (const item of input) {
        const trimmed = item.name.trim();
        if (!trimmed || seen.has(trimmed)) {
          continue;
        }
        seen.add(trimmed);
        names.push(trimmed);
      }
      return names;
    };

    const local = toUniqueNames(branches);
    const remote = toUniqueNames(remoteBranches);
    const current = branchName.trim();
    if (current && !local.includes(current) && !remote.includes(current)) {
      local.unshift(current);
    }
    return {
      localBranchOptions: local,
      remoteBranchOptions: remote,
    };
  }, [branchName, branches, remoteBranches]);

  const hasBranchSwitcher =
    Boolean(onCheckoutBranch) &&
    (localBranchOptions.length > 0 || remoteBranchOptions.length > 0);

  const handleSwitchBranch = useCallback(
    async (targetBranch: string) => {
      if (!onCheckoutBranch || !targetBranch || targetBranch === branchName) {
        return;
      }

      setCheckoutLoading(true);
      try {
        await onCheckoutBranch(targetBranch);
        setDialogOpen(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushErrorToast({
          title: "Failed to switch branch",
          message,
        });
      } finally {
        setCheckoutLoading(false);
      }
    },
    [branchName, onCheckoutBranch],
  );

  if (mode !== "diff" && mode !== "perFile" && mode !== "log") {
    return null;
  }

  return (
    <>
      <div className="diff-branch-row">
        <div className="diff-branch-main">
          <div className="diff-branch">{branchName || "unknown"}</div>
        </div>
        <div className="diff-branch-actions">
          {hasBranchSwitcher && (
            <button
              type="button"
              className="diff-branch-switch"
              onClick={() => setDialogOpen(true)}
              disabled={checkoutLoading}
              title="Switch branch"
              aria-label="Switch branch"
            >
              Switch branch
            </button>
          )}
          <button
            type="button"
            className="diff-branch-refresh"
            onClick={() => void onFetch?.()}
            disabled={!onFetch || fetchLoading}
            title={fetchLoading ? "Fetching remote..." : "Fetch remote"}
            aria-label={fetchLoading ? "Fetching remote" : "Fetch remote"}
          >
            {fetchLoading ? (
              <span className="git-panel-spinner" aria-hidden />
            ) : (
              <RotateCw size={12} aria-hidden />
            )}
          </button>
        </div>
      </div>
      {hasBranchSwitcher && (
        <BranchSwitchDialog
          open={dialogOpen}
          localBranches={localBranchOptions}
          remoteBranches={remoteBranchOptions}
          currentBranch={branchName}
          switching={checkoutLoading}
          onClose={() => {
            if (!checkoutLoading) {
              setDialogOpen(false);
            }
          }}
          onConfirm={(branch) => {
            void handleSwitchBranch(branch);
          }}
        />
      )}
    </>
  );
}

type GitRootCurrentPathProps = {
    mode: GitMode;
    hasGitRoot: boolean;
    gitRoot: string | null;
    onScanGitRoots?: () => void;
    gitRootScanLoading: boolean;
};

export function GitRootCurrentPath({
    mode,
    hasGitRoot,
    gitRoot,
    onScanGitRoots,
    gitRootScanLoading,
}: GitRootCurrentPathProps) {
    if (mode === "issues" || !hasGitRoot) {
        return null;
    }

    return (
        <div className="git-root-current">
            <span className="git-root-label">Path:</span>
            <span className="git-root-path" title={gitRoot ?? ""}>
                {gitRoot}
            </span>
            {onScanGitRoots && (
                <button
                    type="button"
                    className="ghost git-root-button git-root-button--icon"
                    onClick={onScanGitRoots}
                    disabled={gitRootScanLoading}
                >
                    <ArrowLeftRight className="git-root-button-icon" aria-hidden />
                    Change
                </button>
            )}
        </div>
    );
}

type GitPerFileModeContentProps = {
  groups: PerFileDiffGroup[];
  selectedPath: string | null;
  onSelectFile?: (path: string) => void;
};

export function GitPerFileModeContent({
  groups,
  selectedPath,
  onSelectFile,
}: GitPerFileModeContentProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCollapsedPaths((previous) => {
      if (previous.size === 0) {
        return previous;
      }

      const activePaths = new Set(groups.map((group) => group.path));
      let changed = false;
      const next = new Set<string>();

      for (const path of previous) {
        if (activePaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      }

      if (!changed && next.size === previous.size) {
        return previous;
      }

      return next;
    });
  }, [groups]);

  const toggleGroup = useCallback((path: string) => {
    setCollapsedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (groups.length === 0) {
    return <div className="diff-empty">No agent edits in this thread yet.</div>;
  }

  return (
    <div className="per-file-tree">
      {groups.map((group) => {
        const isExpanded = !collapsedPaths.has(group.path);
        const { name: fileName } = splitPath(group.path);
        return (
          <div key={group.path} className="per-file-group">
            <button
              type="button"
              className="per-file-group-row"
              onClick={() => toggleGroup(group.path)}
            >
              <span className="per-file-group-chevron" aria-hidden>
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              <span className="per-file-group-path" title={group.path}>
                {fileName || group.path}
              </span>
              <span className="per-file-group-count">
                {group.edits.length} edit{group.edits.length === 1 ? "" : "s"}
              </span>
            </button>
            {isExpanded && (
              <div className="per-file-edit-list">
                {group.edits.map((edit) => {
                  const isActive = selectedPath === edit.id;
                  return (
                    <button
                      key={edit.id}
                      type="button"
                      className={`per-file-edit-row ${isActive ? "active" : ""}`}
                      onClick={() => onSelectFile?.(edit.id)}
                    >
                      <span className="per-file-edit-status" data-status={edit.status}>
                        {edit.status}
                      </span>
                      <span className="per-file-edit-label">{edit.label}</span>
                      <span className="per-file-edit-stats">
                        {edit.additions > 0 && (
                          <span className="per-file-edit-stat per-file-edit-stat-add">
                            +{edit.additions}
                          </span>
                        )}
                        {edit.deletions > 0 && (
                          <span className="per-file-edit-stat per-file-edit-stat-del">
                            -{edit.deletions}
                          </span>
                        )}
                        {edit.additions === 0 && edit.deletions === 0 && (
                          <span className="per-file-edit-stat">0</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type GitDiffModeContentProps = {
    error: string | null | undefined;
    showGitRootPanel: boolean;
    onScanGitRoots?: () => void;
    gitRootScanLoading: boolean;
    gitRootScanDepth: number;
    onGitRootScanDepthChange?: (depth: number) => void;
    onPickGitRoot?: () => void | Promise<void>;
    onInitGitRepo?: () => void | Promise<void>;
    initGitRepoLoading: boolean;
    hasGitRoot: boolean;
    onClearGitRoot?: () => void;
    gitRootScanError: string | null | undefined;
    gitRootScanHasScanned: boolean;
    gitRootCandidates: string[];
    gitRoot: string | null;
    onSelectGitRoot?: (path: string) => void;
    showGenerateCommitMessage: boolean;
    showApplyWorktree: boolean;
    commitMessage: string;
    onCommitMessageChange?: (value: string) => void;
    commitMessageLoading: boolean;
    canGenerateCommitMessage: boolean;
    onGenerateCommitMessage?: () => void | Promise<void>;
    worktreeApplyTitle: string | null;
    worktreeApplyLoading: boolean;
    worktreeApplySuccess: boolean;
    onApplyWorktreeChanges?: () => void | Promise<void>;
    stagedFiles: DiffFile[];
    unstagedFiles: DiffFile[];
    commitLoading: boolean;
    onCommit?: () => void | Promise<void>;
    commitsAhead: number;
    commitsBehind: number;
    onPull?: () => void | Promise<void>;
    pullLoading: boolean;
    onPush?: () => void | Promise<void>;
    pushLoading: boolean;
    onSync?: () => void | Promise<void>;
    syncLoading: boolean;
    onStageAllChanges?: () => void | Promise<void>;
    onStageFile?: (path: string) => Promise<void> | void;
    onUnstageFile?: (path: string) => Promise<void> | void;
    onDiscardFile?: (path: string) => Promise<void> | void;
    onDiscardFiles?: (paths: string[]) => Promise<void> | void;
    onReviewUncommittedChanges?: () => void | Promise<void>;
    selectedFiles: Set<string>;
    selectedPath: string | null;
    onSelectFile?: (path: string) => void;
    onFileClick: (
        event: ReactMouseEvent<HTMLDivElement>,
        path: string,
        section: "staged" | "unstaged",
    ) => void;
    onShowFileMenu: (
        event: ReactMouseEvent<HTMLDivElement>,
        path: string,
        section: "staged" | "unstaged",
    ) => void;
    onDiffListClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export function GitDiffModeContent({
    error,
    showGitRootPanel,
    onScanGitRoots,
    gitRootScanLoading,
    gitRootScanDepth,
    onGitRootScanDepthChange,
    onPickGitRoot,
    onInitGitRepo,
    initGitRepoLoading,
    hasGitRoot,
    onClearGitRoot,
    gitRootScanError,
    gitRootScanHasScanned,
    gitRootCandidates,
    gitRoot,
    onSelectGitRoot,
    showGenerateCommitMessage,
    showApplyWorktree,
    commitMessage,
    onCommitMessageChange,
    commitMessageLoading,
    canGenerateCommitMessage,
    onGenerateCommitMessage,
    worktreeApplyTitle,
    worktreeApplyLoading,
    worktreeApplySuccess,
    onApplyWorktreeChanges,
    stagedFiles,
    unstagedFiles,
    commitLoading,
    onCommit,
    commitsAhead,
    commitsBehind,
    onPull,
    pullLoading,
    onPush,
    pushLoading,
    onSync,
    syncLoading,
    onStageAllChanges,
    onStageFile,
    onUnstageFile,
    onDiscardFile,
    onDiscardFiles,
    onReviewUncommittedChanges,
    selectedFiles,
    selectedPath,
    onSelectFile,
    onFileClick,
    onShowFileMenu,
    onDiffListClick,
}: GitDiffModeContentProps) {
    const normalizedGitRoot = normalizeRootPath(gitRoot);
    const missingRepo = isMissingRepo(error);
    const gitRootNotFound = isGitRootNotFound(error);
    const showInitGitRepo = Boolean(onInitGitRepo) && missingRepo && !gitRootNotFound;
    const gitRootTitle = gitRootNotFound
        ? "Git root folder not found."
        : missingRepo
            ? "This workspace isn't a Git repository yet."
            : "Choose a repo for this workspace.";
    const generateCommitMessageTooltip = "Generate commit message";
    const showWorktreeApplyInUnstaged = showApplyWorktree && unstagedFiles.length > 0;
    const showWorktreeApplyInStaged =
        showApplyWorktree && unstagedFiles.length === 0 && stagedFiles.length > 0;

    return (
        <div className="diff-list" onClick={onDiffListClick}>
            {showGitRootPanel && (
                <div className="git-root-panel">
                    <div className="git-root-title">{gitRootTitle}</div>
                    {showInitGitRepo && (
                        <div className="git-root-primary-action">
                            <button
                                type="button"
                                className="primary git-root-button"
                                onClick={() => {
                                    void onInitGitRepo?.();
                                }}
                                disabled={initGitRepoLoading || gitRootScanLoading}
                            >
                                {initGitRepoLoading ? "Initializing..." : "Initialize Git"}
                            </button>
                        </div>
                    )}
                    <div className="git-root-actions">
                        <button
                            type="button"
                            className="ghost git-root-button"
                            onClick={onScanGitRoots}
                            disabled={!onScanGitRoots || gitRootScanLoading || initGitRepoLoading}
                        >
                            Scan workspace
                        </button>
                        <label className="git-root-depth">
                            <span>Depth</span>
                            <select
                                className="git-root-select"
                                value={gitRootScanDepth}
                                onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (!Number.isNaN(value)) {
                                        onGitRootScanDepthChange?.(value);
                                    }
                                }}
                                disabled={gitRootScanLoading || initGitRepoLoading}
                            >
                                {DEPTH_OPTIONS.map((depth) => (
                                    <option key={depth} value={depth}>
                                        {depth}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {onPickGitRoot && (
                            <button
                                type="button"
                                className="ghost git-root-button"
                                onClick={() => {
                                    void onPickGitRoot();
                                }}
                                disabled={gitRootScanLoading || initGitRepoLoading}
                            >
                                Pick folder
                            </button>
                        )}
                        {hasGitRoot && onClearGitRoot && (
                            <button
                                type="button"
                                className="ghost git-root-button"
                                onClick={onClearGitRoot}
                                disabled={gitRootScanLoading || initGitRepoLoading}
                            >
                                Use workspace root
                            </button>
                        )}
                    </div>
                    {gitRootScanLoading && <div className="diff-empty">Scanning for repositories...</div>}
                    {!gitRootScanLoading &&
                        !gitRootScanError &&
                        gitRootScanHasScanned &&
                        gitRootCandidates.length === 0 && <div className="diff-empty">No repositories found.</div>}
                    {gitRootCandidates.length > 0 && (
                        <div className="git-root-list">
                            {gitRootCandidates.map((path) => {
                                const normalizedPath = normalizeRootPath(path);
                                const isActive = normalizedGitRoot && normalizedGitRoot === normalizedPath;
                                return (
                                    <button
                                        key={path}
                                        type="button"
                                        className={`git-root-item ${isActive ? "active" : ""}`}
                                        onClick={() => onSelectGitRoot?.(path)}
                                    >
                                        <span className="git-root-path">{path}</span>
                                        {isActive && <span className="git-root-tag">Active</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            {showGenerateCommitMessage && (
                <div className="commit-message-section">
                    <div className="commit-message-input-wrapper">
                        <textarea
                            className="commit-message-input"
                            placeholder="Commit message..."
                            value={commitMessage}
                            onChange={(event) => onCommitMessageChange?.(event.target.value)}
                            disabled={commitMessageLoading}
                            rows={2}
                        />
                        <button
                            type="button"
                            className="commit-message-generate-button diff-row-action"
                            onClick={() => {
                                if (!canGenerateCommitMessage) {
                                    return;
                                }
                                void onGenerateCommitMessage?.();
                            }}
                            disabled={commitMessageLoading || !canGenerateCommitMessage}
                            title={generateCommitMessageTooltip}
                            data-tooltip={generateCommitMessageTooltip}
                            data-tooltip-placement="bottom"
                            aria-label="Generate commit message"
                        >
                            {commitMessageLoading ? (
                                <MagicSparkleLoaderIcon className="commit-message-loader" />
                            ) : (
                                <MagicSparkleIcon />
                            )}
                        </button>
                    </div>
                    <CommitButton
                        commitMessage={commitMessage}
                        hasStagedFiles={stagedFiles.length > 0}
                        hasUnstagedFiles={unstagedFiles.length > 0}
                        commitLoading={commitLoading}
                        onCommit={onCommit}
                    />
                </div>
            )}
            {(commitsAhead > 0 || commitsBehind > 0) && !stagedFiles.length && (
                <div className="push-section">
                    <div className="push-sync-buttons">
                        {commitsBehind > 0 && (
                            <button
                                type="button"
                                className="push-button-secondary"
                                onClick={() => void onPull?.()}
                                disabled={!onPull || pullLoading || syncLoading}
                                title={`Pull ${commitsBehind} commit${commitsBehind > 1 ? "s" : ""}`}
                            >
                                {pullLoading ? (
                                    <span className="commit-button-spinner" aria-hidden />
                                ) : (
                                    <Download size={14} aria-hidden />
                                )}
                                <span>{pullLoading ? "Pulling..." : "Pull"}</span>
                                <span className="push-count">{commitsBehind}</span>
                            </button>
                        )}
                        {commitsAhead > 0 && (
                            <button
                                type="button"
                                className="push-button"
                                onClick={() => void onPush?.()}
                                disabled={!onPush || pushLoading || commitsBehind > 0}
                                title={
                                    commitsBehind > 0
                                        ? "Remote is ahead. Pull first, or use Sync."
                                        : `Push ${commitsAhead} commit${commitsAhead > 1 ? "s" : ""}`
                                }
                            >
                                {pushLoading ? (
                                    <span className="commit-button-spinner" aria-hidden />
                                ) : (
                                    <Upload size={14} aria-hidden />
                                )}
                                <span>Push</span>
                                <span className="push-count">{commitsAhead}</span>
                            </button>
                        )}
                    </div>
                    {commitsAhead > 0 && commitsBehind > 0 && (
                        <button
                            type="button"
                            className="push-button-secondary"
                            onClick={() => void onSync?.()}
                            disabled={!onSync || syncLoading || pullLoading}
                            title="Pull latest changes and push your local commits"
                        >
                            {syncLoading ? (
                                <span className="commit-button-spinner" aria-hidden />
                            ) : (
                                <RotateCcw size={14} aria-hidden />
                            )}
                            <span>{syncLoading ? "Syncing..." : "Sync (pull then push)"}</span>
                        </button>
                    )}
                </div>
            )}
            {!error &&
                !stagedFiles.length &&
                !unstagedFiles.length &&
                commitsAhead === 0 &&
                commitsBehind === 0 && <div className="diff-empty">No changes detected.</div>}
            {(stagedFiles.length > 0 || unstagedFiles.length > 0) && (
                <>
                    {stagedFiles.length > 0 && (
                        <DiffSection
                            title="Staged"
                            files={stagedFiles}
                            section="staged"
                            selectedFiles={selectedFiles}
                            selectedPath={selectedPath}
                            onSelectFile={onSelectFile}
                            onUnstageFile={onUnstageFile}
                            onDiscardFile={onDiscardFile}
                            onDiscardFiles={onDiscardFiles}
                            showWorktreeApplyAction={showWorktreeApplyInStaged}
                            worktreeApplyTitle={worktreeApplyTitle}
                            worktreeApplyLoading={worktreeApplyLoading}
                            worktreeApplySuccess={worktreeApplySuccess}
                            onApplyWorktreeChanges={onApplyWorktreeChanges}
                            onFileClick={onFileClick}
                            onShowFileMenu={onShowFileMenu}
                        />
                    )}
                    {unstagedFiles.length > 0 && (
                        <DiffSection
                            title="Unstaged"
                            files={unstagedFiles}
                            section="unstaged"
                            selectedFiles={selectedFiles}
                            selectedPath={selectedPath}
                            onSelectFile={onSelectFile}
                            onStageAllChanges={onStageAllChanges}
                            onStageFile={onStageFile}
                            onDiscardFile={onDiscardFile}
                            onDiscardFiles={onDiscardFiles}
                            onReviewUncommittedChanges={onReviewUncommittedChanges}
                            showWorktreeApplyAction={showWorktreeApplyInUnstaged}
                            worktreeApplyTitle={worktreeApplyTitle}
                            worktreeApplyLoading={worktreeApplyLoading}
                            worktreeApplySuccess={worktreeApplySuccess}
                            onApplyWorktreeChanges={onApplyWorktreeChanges}
                            onFileClick={onFileClick}
                            onShowFileMenu={onShowFileMenu}
                        />
                    )}
                </>
            )}
        </div>
    );
}

type GitLogModeContentProps = {
    logError: string | null | undefined;
    logLoading: boolean;
    logEntries: GitLogEntry[];
    showAheadSection: boolean;
    showBehindSection: boolean;
    logAheadEntries: GitLogEntry[];
    logBehindEntries: GitLogEntry[];
    selectedCommitSha: string | null;
    onSelectCommit?: (entry: GitLogEntry) => void;
    onShowLogMenu: (event: ReactMouseEvent<HTMLDivElement>, entry: GitLogEntry) => void;
};

export function GitLogModeContent({
    logError,
    logLoading,
    logEntries,
    showAheadSection,
    showBehindSection,
    logAheadEntries,
    logBehindEntries,
    selectedCommitSha,
    onSelectCommit,
    onShowLogMenu,
}: GitLogModeContentProps) {
    return (
        <div className="git-log-list">
            {!logError && logLoading && <div className="diff-viewer-loading">Loading commits...</div>}
            {!logError &&
                !logLoading &&
                !logEntries.length &&
                !showAheadSection &&
                !showBehindSection && <div className="diff-empty">No commits yet.</div>}
            {showAheadSection && (
                <div className="git-log-section">
                    <div className="git-log-section-title">To push</div>
                    <div className="git-log-section-list">
                        {logAheadEntries.map((entry) => {
                            const isSelected = selectedCommitSha === entry.sha;
                            return (
                                <GitLogEntryRow
                                    key={entry.sha}
                                    entry={entry}
                                    isSelected={isSelected}
                                    compact
                                    onSelect={onSelectCommit}
                                    onContextMenu={(event) => onShowLogMenu(event, entry)}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
            {showBehindSection && (
                <div className="git-log-section">
                    <div className="git-log-section-title">To pull</div>
                    <div className="git-log-section-list">
                        {logBehindEntries.map((entry) => {
                            const isSelected = selectedCommitSha === entry.sha;
                            return (
                                <GitLogEntryRow
                                    key={entry.sha}
                                    entry={entry}
                                    isSelected={isSelected}
                                    compact
                                    onSelect={onSelectCommit}
                                    onContextMenu={(event) => onShowLogMenu(event, entry)}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
            {(logEntries.length > 0 || logLoading) && (
                <div className="git-log-section">
                    <div className="git-log-section-title">Recent commits</div>
                    <div className="git-log-section-list">
                        {logEntries.map((entry) => {
                            const isSelected = selectedCommitSha === entry.sha;
                            return (
                                <GitLogEntryRow
                                    key={entry.sha}
                                    entry={entry}
                                    isSelected={isSelected}
                                    onSelect={onSelectCommit}
                                    onContextMenu={(event) => onShowLogMenu(event, entry)}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

type GitIssuesModeContentProps = {
    issuesError: string | null | undefined;
    issuesLoading: boolean;
    issues: GitHubIssue[];
};

export function GitIssuesModeContent({
    issuesError,
    issuesLoading,
    issues,
}: GitIssuesModeContentProps) {
    return (
        <div className="git-issues-list">
            {!issuesError && !issuesLoading && !issues.length && (
                <div className="diff-empty">No open issues.</div>
            )}
            {issues.map((issue) => {
                const relativeTime = formatRelativeTime(new Date(issue.updatedAt).getTime());
                return (
                    <a
                        key={issue.number}
                        className="git-issue-entry"
                        href={issue.url}
                        onClick={(event) => {
                            event.preventDefault();
                            void openUrl(issue.url);
                        }}
                    >
                        <div className="git-issue-summary">
                            <span className="git-issue-title">
                                <span className="git-issue-number">#{issue.number}</span>{" "}
                                {issue.title} <span className="git-issue-date">· {relativeTime}</span>
                            </span>
                        </div>
                    </a>
                );
            })}
        </div>
    );
}

type GitPullRequestsModeContentProps = {
    pullRequestsError: string | null | undefined;
    pullRequestsLoading: boolean;
    pullRequests: GitHubPullRequest[];
    selectedPullRequest: number | null;
    onSelectPullRequest?: (pullRequest: GitHubPullRequest) => void;
    onShowPullRequestMenu: (
        event: ReactMouseEvent<HTMLDivElement>,
        pullRequest: GitHubPullRequest,
    ) => void;
};

export function GitPullRequestsModeContent({
    pullRequestsError,
    pullRequestsLoading,
    pullRequests,
    selectedPullRequest,
    onSelectPullRequest,
    onShowPullRequestMenu,
}: GitPullRequestsModeContentProps) {
    return (
        <div className="git-pr-list">
            {!pullRequestsError && !pullRequestsLoading && !pullRequests.length && (
                <div className="diff-empty">No open pull requests.</div>
            )}
            {pullRequests.map((pullRequest) => {
                const relativeTime = formatRelativeTime(new Date(pullRequest.updatedAt).getTime());
                const author = pullRequest.author?.login ?? "unknown";
                const isSelected = selectedPullRequest === pullRequest.number;

                return (
                    <div
                        key={pullRequest.number}
                        className={`git-pr-entry ${isSelected ? "active" : ""}`}
                        onClick={() => onSelectPullRequest?.(pullRequest)}
                        onContextMenu={(event) => onShowPullRequestMenu(event, pullRequest)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelectPullRequest?.(pullRequest);
                            }
                        }}
                    >
                        <div className="git-pr-header">
                            <span className="git-pr-title">
                                <span className="git-pr-number">#{pullRequest.number}</span>
                                <span className="git-pr-title-text">
                                    {pullRequest.title} <span className="git-pr-author-inline">@{author}</span>
                                </span>
                            </span>
                            <span className="git-pr-time">{relativeTime}</span>
                        </div>
                        <div className="git-pr-meta">
                            {pullRequest.isDraft && <span className="git-pr-pill git-pr-draft">Draft</span>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
