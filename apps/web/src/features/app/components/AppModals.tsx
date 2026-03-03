import { lazy, memo, Suspense } from "react";
import type { ComponentType } from "react";
import type { BranchInfo, WorkspaceInfo } from "../../../types";
import type { SettingsViewProps } from "../../settings/components/SettingsView";
import { useThreadFolderPrompt } from "../../threads/hooks/useThreadFolderPrompt";
import { useRenameThreadPrompt } from "../../threads/hooks/useRenameThreadPrompt";
import { useClonePrompt } from "../../workspaces/hooks/useClonePrompt";
import { useWorktreePrompt } from "../../workspaces/hooks/useWorktreePrompt";
import { useWorkspaceFromUrlPrompt } from "../../workspaces/hooks/useWorkspaceFromUrlPrompt";
import type { BranchSwitcherState } from "../../git/hooks/useBranchSwitcher";
import { useGitBranches } from "../../git/hooks/useGitBranches";

const RenameThreadPrompt = lazy(() =>
  import("../../threads/components/RenameThreadPrompt").then((module) => ({
    default: module.RenameThreadPrompt,
  })),
);
const ThreadFolderPrompt = lazy(() =>
  import("../../threads/components/ThreadFolderPrompt").then((module) => ({
    default: module.ThreadFolderPrompt,
  })),
);
const WorktreePrompt = lazy(() =>
  import("../../workspaces/components/WorktreePrompt").then((module) => ({
    default: module.WorktreePrompt,
  })),
);
const ClonePrompt = lazy(() =>
  import("../../workspaces/components/ClonePrompt").then((module) => ({
    default: module.ClonePrompt,
  })),
);
const WorkspaceFromUrlPrompt = lazy(() =>
  import("../../workspaces/components/WorkspaceFromUrlPrompt").then((module) => ({
    default: module.WorkspaceFromUrlPrompt,
  })),
);
const MobileRemoteWorkspacePrompt = lazy(() =>
  import("../../workspaces/components/MobileRemoteWorkspacePrompt").then((module) => ({
    default: module.MobileRemoteWorkspacePrompt,
  })),
);
const WorkspacePathAccessPrompt = lazy(() =>
  import("../../workspaces/components/WorkspacePathAccessPrompt").then((module) => ({
    default: module.WorkspacePathAccessPrompt,
  })),
);
const BranchSwitcherPrompt = lazy(() =>
  import("../../git/components/BranchSwitcherPrompt").then((module) => ({
    default: module.BranchSwitcherPrompt,
  })),
);
const InitGitRepoPrompt = lazy(() =>
  import("../../git/components/InitGitRepoPrompt").then((module) => ({
    default: module.InitGitRepoPrompt,
  })),
);

type RenamePromptState = ReturnType<typeof useRenameThreadPrompt>["renamePrompt"];
type ThreadFolderPromptState = ReturnType<
  typeof useThreadFolderPrompt
>["threadFolderPrompt"];

type WorktreePromptState = ReturnType<typeof useWorktreePrompt>["worktreePrompt"];

type ClonePromptState = ReturnType<typeof useClonePrompt>["clonePrompt"];
type WorkspaceFromUrlPromptState = ReturnType<
  typeof useWorkspaceFromUrlPrompt
>["workspaceFromUrlPrompt"];
type MobileRemoteWorkspacePathPromptState = {
  value: string;
  accessMode: "read-only" | "current" | "full-access";
  error: string | null;
  recentPaths: string[];
} | null;
type WorkspacePathAccessPromptState = {
  pathCount: number;
  accessMode: "read-only" | "current" | "full-access";
} | null;

type AppModalsProps = {
  renamePrompt: RenamePromptState;
  onRenamePromptChange: (value: string) => void;
  onRenamePromptCancel: () => void;
  onRenamePromptConfirm: () => void;
  threadFolderPrompt: ThreadFolderPromptState;
  onThreadFolderPromptChange: (value: string) => void;
  onThreadFolderPromptCancel: () => void;
  onThreadFolderPromptConfirm: () => void;
  initGitRepoPrompt: {
    workspaceName: string;
    branch: string;
    createRemote: boolean;
    repoName: string;
    isPrivate: boolean;
    error: string | null;
  } | null;
  initGitRepoPromptBusy: boolean;
  onInitGitRepoPromptBranchChange: (value: string) => void;
  onInitGitRepoPromptCreateRemoteChange: (value: boolean) => void;
  onInitGitRepoPromptRepoNameChange: (value: string) => void;
  onInitGitRepoPromptPrivateChange: (value: boolean) => void;
  onInitGitRepoPromptCancel: () => void;
  onInitGitRepoPromptConfirm: () => void;
  worktreePrompt: WorktreePromptState;
  onWorktreePromptNameChange: (value: string) => void;
  onWorktreePromptChange: (value: string) => void;
  onWorktreePromptCopyAgentsMdChange: (value: boolean) => void;
  onWorktreeSetupScriptChange: (value: string) => void;
  onWorktreePromptCancel: () => void;
  onWorktreePromptConfirm: () => void;
  clonePrompt: ClonePromptState;
  onClonePromptCopyNameChange: (value: string) => void;
  onClonePromptChooseCopiesFolder: () => void;
  onClonePromptUseSuggestedFolder: () => void;
  onClonePromptClearCopiesFolder: () => void;
  onClonePromptCancel: () => void;
  onClonePromptConfirm: () => void;
  workspaceFromUrlPrompt: WorkspaceFromUrlPromptState;
  workspaceFromUrlCanSubmit: boolean;
  onWorkspaceFromUrlPromptUrlChange: (value: string) => void;
  onWorkspaceFromUrlPromptTargetFolderNameChange: (value: string) => void;
  onWorkspaceFromUrlPromptAccessModeChange: (value: "read-only" | "current" | "full-access") => void;
  onWorkspaceFromUrlPromptChooseDestinationPath: () => void;
  onWorkspaceFromUrlPromptClearDestinationPath: () => void;
  onWorkspaceFromUrlPromptCancel: () => void;
  onWorkspaceFromUrlPromptConfirm: () => void;
  mobileRemoteWorkspacePathPrompt: MobileRemoteWorkspacePathPromptState;
  onMobileRemoteWorkspacePathPromptChange: (value: string) => void;
  onMobileRemoteWorkspacePathPromptAccessModeChange: (value: "read-only" | "current" | "full-access") => void;
  onMobileRemoteWorkspacePathPromptRecentPathSelect: (path: string) => void;
  onMobileRemoteWorkspacePathPromptCancel: () => void;
  onMobileRemoteWorkspacePathPromptConfirm: () => void;
  workspacePathAccessPrompt: WorkspacePathAccessPromptState;
  onWorkspacePathAccessPromptAccessModeChange: (
    value: "read-only" | "current" | "full-access",
  ) => void;
  onWorkspacePathAccessPromptCancel: () => void;
  onWorkspacePathAccessPromptConfirm: () => void;
  branchSwitcher: BranchSwitcherState;
  branches: BranchInfo[];
  workspaces: WorkspaceInfo[];
  activeWorkspace: WorkspaceInfo | null;
  currentBranch: string | null;
  onBranchSwitcherSelect: (branch: string, worktree: WorkspaceInfo | null) => void;
  onBranchSwitcherCancel: () => void;
  settingsOpen: boolean;
  settingsSection: SettingsViewProps["initialSection"] | null;
  onCloseSettings: () => void;
  SettingsViewComponent: ComponentType<SettingsViewProps>;
  settingsProps: Omit<SettingsViewProps, "initialSection" | "onClose">;
};

export const AppModals = memo(function AppModals({
  renamePrompt,
  onRenamePromptChange,
  onRenamePromptCancel,
  onRenamePromptConfirm,
  threadFolderPrompt,
  onThreadFolderPromptChange,
  onThreadFolderPromptCancel,
  onThreadFolderPromptConfirm,
  initGitRepoPrompt,
  initGitRepoPromptBusy,
  onInitGitRepoPromptBranchChange,
  onInitGitRepoPromptCreateRemoteChange,
  onInitGitRepoPromptRepoNameChange,
  onInitGitRepoPromptPrivateChange,
  onInitGitRepoPromptCancel,
  onInitGitRepoPromptConfirm,
  worktreePrompt,
  onWorktreePromptNameChange,
  onWorktreePromptChange,
  onWorktreePromptCopyAgentsMdChange,
  onWorktreeSetupScriptChange,
  onWorktreePromptCancel,
  onWorktreePromptConfirm,
  clonePrompt,
  onClonePromptCopyNameChange,
  onClonePromptChooseCopiesFolder,
  onClonePromptUseSuggestedFolder,
  onClonePromptClearCopiesFolder,
  onClonePromptCancel,
  onClonePromptConfirm,
  workspaceFromUrlPrompt,
  workspaceFromUrlCanSubmit,
  onWorkspaceFromUrlPromptUrlChange,
  onWorkspaceFromUrlPromptTargetFolderNameChange,
  onWorkspaceFromUrlPromptAccessModeChange,
  onWorkspaceFromUrlPromptChooseDestinationPath,
  onWorkspaceFromUrlPromptClearDestinationPath,
  onWorkspaceFromUrlPromptCancel,
  onWorkspaceFromUrlPromptConfirm,
  mobileRemoteWorkspacePathPrompt,
  onMobileRemoteWorkspacePathPromptChange,
  onMobileRemoteWorkspacePathPromptAccessModeChange,
  onMobileRemoteWorkspacePathPromptRecentPathSelect,
  onMobileRemoteWorkspacePathPromptCancel,
  onMobileRemoteWorkspacePathPromptConfirm,
  workspacePathAccessPrompt,
  onWorkspacePathAccessPromptAccessModeChange,
  onWorkspacePathAccessPromptCancel,
  onWorkspacePathAccessPromptConfirm,
  branchSwitcher,
  branches,
  workspaces,
  activeWorkspace,
  currentBranch,
  onBranchSwitcherSelect,
  onBranchSwitcherCancel,
  settingsOpen,
  settingsSection,
  onCloseSettings,
  SettingsViewComponent,
  settingsProps,
}: AppModalsProps) {
  const { branches: worktreeBranches } = useGitBranches({
    activeWorkspace: worktreePrompt?.workspace ?? null,
  });

  return (
    <>
      {renamePrompt && (
        <Suspense fallback={null}>
          <RenameThreadPrompt
            currentName={renamePrompt.originalName}
            name={renamePrompt.name}
            onChange={onRenamePromptChange}
            onCancel={onRenamePromptCancel}
            onConfirm={onRenamePromptConfirm}
          />
        </Suspense>
      )}
      {threadFolderPrompt && (
        <Suspense fallback={null}>
          <ThreadFolderPrompt
            mode={threadFolderPrompt.mode}
            workspaceName={threadFolderPrompt.workspaceName}
            currentName={threadFolderPrompt.originalName}
            name={threadFolderPrompt.name}
            error={threadFolderPrompt.error}
            onChange={onThreadFolderPromptChange}
            onCancel={onThreadFolderPromptCancel}
            onConfirm={onThreadFolderPromptConfirm}
          />
        </Suspense>
      )}
      {initGitRepoPrompt && (
        <Suspense fallback={null}>
          <InitGitRepoPrompt
            workspaceName={initGitRepoPrompt.workspaceName}
            branch={initGitRepoPrompt.branch}
            createRemote={initGitRepoPrompt.createRemote}
            repoName={initGitRepoPrompt.repoName}
            isPrivate={initGitRepoPrompt.isPrivate}
            error={initGitRepoPrompt.error}
            isBusy={initGitRepoPromptBusy}
            onBranchChange={onInitGitRepoPromptBranchChange}
            onCreateRemoteChange={onInitGitRepoPromptCreateRemoteChange}
            onRepoNameChange={onInitGitRepoPromptRepoNameChange}
            onPrivateChange={onInitGitRepoPromptPrivateChange}
            onCancel={onInitGitRepoPromptCancel}
            onConfirm={onInitGitRepoPromptConfirm}
          />
        </Suspense>
      )}
      {worktreePrompt && (
        <Suspense fallback={null}>
          <WorktreePrompt
            workspaceName={worktreePrompt.workspace.name}
            name={worktreePrompt.name}
            branch={worktreePrompt.branch}
            branchWasEdited={worktreePrompt.branchWasEdited}
            branchSuggestions={worktreeBranches}
            copyAgentsMd={worktreePrompt.copyAgentsMd}
            setupScript={worktreePrompt.setupScript}
            scriptError={worktreePrompt.scriptError}
            error={worktreePrompt.error}
            isBusy={worktreePrompt.isSubmitting}
            isSavingScript={worktreePrompt.isSavingScript}
            onNameChange={onWorktreePromptNameChange}
            onChange={onWorktreePromptChange}
            onCopyAgentsMdChange={onWorktreePromptCopyAgentsMdChange}
            onSetupScriptChange={onWorktreeSetupScriptChange}
            onCancel={onWorktreePromptCancel}
            onConfirm={onWorktreePromptConfirm}
          />
        </Suspense>
      )}
      {clonePrompt && (
        <Suspense fallback={null}>
          <ClonePrompt
            workspaceName={clonePrompt.workspace.name}
            copyName={clonePrompt.copyName}
            copiesFolder={clonePrompt.copiesFolder}
            suggestedCopiesFolder={clonePrompt.suggestedCopiesFolder}
            error={clonePrompt.error}
            isBusy={clonePrompt.isSubmitting}
            onCopyNameChange={onClonePromptCopyNameChange}
            onChooseCopiesFolder={onClonePromptChooseCopiesFolder}
            onUseSuggestedCopiesFolder={onClonePromptUseSuggestedFolder}
            onClearCopiesFolder={onClonePromptClearCopiesFolder}
            onCancel={onClonePromptCancel}
            onConfirm={onClonePromptConfirm}
          />
        </Suspense>
      )}
      {workspaceFromUrlPrompt && (
        <Suspense fallback={null}>
          <WorkspaceFromUrlPrompt
            url={workspaceFromUrlPrompt.url}
            destinationPath={workspaceFromUrlPrompt.destinationPath}
            targetFolderName={workspaceFromUrlPrompt.targetFolderName}
            accessMode={workspaceFromUrlPrompt.accessMode}
            error={workspaceFromUrlPrompt.error}
            isBusy={workspaceFromUrlPrompt.isSubmitting}
            canSubmit={workspaceFromUrlCanSubmit}
            onUrlChange={onWorkspaceFromUrlPromptUrlChange}
            onTargetFolderNameChange={onWorkspaceFromUrlPromptTargetFolderNameChange}
            onAccessModeChange={onWorkspaceFromUrlPromptAccessModeChange}
            onChooseDestinationPath={onWorkspaceFromUrlPromptChooseDestinationPath}
            onClearDestinationPath={onWorkspaceFromUrlPromptClearDestinationPath}
            onCancel={onWorkspaceFromUrlPromptCancel}
            onConfirm={onWorkspaceFromUrlPromptConfirm}
          />
        </Suspense>
      )}
      {mobileRemoteWorkspacePathPrompt && (
        <Suspense fallback={null}>
          <MobileRemoteWorkspacePrompt
            value={mobileRemoteWorkspacePathPrompt.value}
            accessMode={mobileRemoteWorkspacePathPrompt.accessMode}
            error={mobileRemoteWorkspacePathPrompt.error}
            recentPaths={mobileRemoteWorkspacePathPrompt.recentPaths}
            onChange={onMobileRemoteWorkspacePathPromptChange}
            onAccessModeChange={onMobileRemoteWorkspacePathPromptAccessModeChange}
            onRecentPathSelect={onMobileRemoteWorkspacePathPromptRecentPathSelect}
            onCancel={onMobileRemoteWorkspacePathPromptCancel}
            onConfirm={onMobileRemoteWorkspacePathPromptConfirm}
          />
        </Suspense>
      )}
      {workspacePathAccessPrompt && (
        <Suspense fallback={null}>
          <WorkspacePathAccessPrompt
            pathCount={workspacePathAccessPrompt.pathCount}
            accessMode={workspacePathAccessPrompt.accessMode}
            onAccessModeChange={onWorkspacePathAccessPromptAccessModeChange}
            onCancel={onWorkspacePathAccessPromptCancel}
            onConfirm={onWorkspacePathAccessPromptConfirm}
          />
        </Suspense>
      )}
      {branchSwitcher && (
        <Suspense fallback={null}>
          <BranchSwitcherPrompt
            branches={branches}
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            currentBranch={currentBranch}
            onSelect={onBranchSwitcherSelect}
            onCancel={onBranchSwitcherCancel}
          />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsViewComponent
            {...settingsProps}
            onClose={onCloseSettings}
            initialSection={settingsSection ?? undefined}
          />
        </Suspense>
      )}
    </>
  );
});
