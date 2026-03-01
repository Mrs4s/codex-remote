import type { WorkspaceInfo, WorkspaceSettings } from "@codex-remote/shared-types";

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
  backendMode: "remote";
  remoteBackendHost: string;
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
});

export const defaultAppSettings = (): AppSettings => ({
  backendMode: "remote",
  remoteBackendHost: "127.0.0.1:8787",
  threadTitleAutogenerationEnabled: false,
  steerEnabled: true,
  followUpMessageBehavior: "steer",
});
