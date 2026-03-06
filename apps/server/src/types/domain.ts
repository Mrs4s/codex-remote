import type { ServiceTier, WorkspaceInfo, WorkspaceSettings } from "@codex-remote/shared-types";

export type WorkspaceKind = "main" | "worktree";

export type WorkspaceEntry = {
  id: string;
  name: string;
  path: string;
  kind?: WorkspaceKind;
  parentId?: string | null;
  worktree?: { branch: string } | null;
  settings: WorkspaceSettings;
};

export type AppSettings = {
  codexBin: string | null;
  codexArgs: string | null;
  backendMode: "remote";
  remoteBackendHost: string;
  lastComposerServiceTier: ServiceTier | null;
  threadTitleAutogenerationEnabled: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: "queue" | "steer";
};

export function toWorkspaceInfo(entry: WorkspaceEntry, connected: boolean): WorkspaceInfo {
  return {
    ...entry,
    connected,
  };
}

export const defaultWorkspaceSettings = (): WorkspaceSettings => ({
  sidebarCollapsed: false,
  sortOrder: null,
  groupId: null,
  cloneSourceWorkspaceId: null,
  gitRoot: null,
  launchScript: null,
  launchScripts: null,
  worktreeSetupScript: null,
  defaultAccessMode: null,
});

export const defaultAppSettings = (): AppSettings => ({
  codexBin: null,
  codexArgs: null,
  backendMode: "remote",
  remoteBackendHost: "127.0.0.1:8787",
  lastComposerServiceTier: null,
  threadTitleAutogenerationEnabled: false,
  steerEnabled: true,
  followUpMessageBehavior: "steer",
});
