import type { AppSettings } from "../types/domain.js";
import type { PromptScope, PromptService } from "../services/promptService.js";
import type { WorkspaceService } from "../services/workspaceService.js";
import type { SessionManager } from "../services/sessionManager.js";
import type { TerminalService } from "../services/terminalService.js";
import { listWorkspaceFiles, readWorkspaceFile } from "../services/fileService.js";
import {
  checkoutGitHubPullRequest,
  checkoutGitBranch,
  commitGit,
  createGitHubRepo,
  createGitBranch,
  fetchGit,
  getGitCommitDiff,
  getGitDiffs,
  getGitHubIssues,
  getGitHubPullRequestComments,
  getGitHubPullRequestDiff,
  getGitHubPullRequests,
  getGitLog,
  getGitRemote,
  getGitStatus,
  initGitRepo,
  listGitRoots,
  listGitBranches,
  pullGit,
  pushGit,
  revertGitAll,
  revertGitFile,
  stageGitAll,
  stageGitFile,
  syncGit,
  unstageGitFile,
} from "../services/gitService.js";
import { rememberApprovalRule } from "../services/approvalRuleService.js";
import type { JsonStore } from "../storage/jsonStore.js";
import { fileRead, fileWrite, type FileKind, type FileScope } from "../services/textFileService.js";
import { localUsageSnapshot } from "../services/localUsageService.js";
import {
  generateAgentDescription,
  generateCommitMessage,
  setCodexFeatureFlag,
  writeAgentConfigToml,
} from "../services/codexCompatService.js";
import type { DictationService } from "../services/dictationService.js";

export type DispatcherDeps = {
  workspaceService: WorkspaceService;
  sessionManager: SessionManager;
  terminalService: TerminalService;
  promptService: PromptService;
  dictationService: DictationService;
  store: JsonStore;
};

const NOT_IMPLEMENTED_METHODS = new Set([
  "get_codex_config_path",
  "read_image_as_data_url",
  "get_agents_settings",
  "set_agents_core_settings",
  "create_agent",
  "update_agent",
  "delete_agent",
  "read_agent_config_toml",
  "get_config_model",
  "open_workspace_in",
  "get_open_app_icon",
  "generate_run_metadata",
  "is_mobile_runtime",
  "tailscale_status",
  "tailscale_daemon_command_preview",
  "tailscale_daemon_start",
  "tailscale_daemon_stop",
  "tailscale_daemon_status",
  "menu_set_accelerators",
  "codex_doctor",
  "codex_update",
  "get_app_build_type",
  "send_notification",
  "send_notification_fallback",
  "get_workspace_files",
  "read_workspace_file_path",
  "read_agent_md",
  "write_agent_md",
]);

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | null {
  const value = params[key];
  if (value === undefined || value === null) {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${key} must be a number`);
  }
  return num;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | null {
  const value = params[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function parseFileScope(value: unknown): FileScope {
  if (value === "workspace" || value === "global") {
    return value;
  }
  throw new Error("scope must be 'workspace' or 'global'");
}

function parseFileKind(value: unknown): FileKind {
  if (value === "agents" || value === "config") {
    return value;
  }
  throw new Error("kind must be 'agents' or 'config'");
}

function parsePromptScope(value: unknown): PromptScope {
  if (value === "workspace" || value === "global") {
    return value;
  }
  throw new Error("scope must be 'workspace' or 'global'");
}

export async function dispatchRpc(
  deps: DispatcherDeps,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const workspaceById = (id: string) => {
    const workspace = deps.workspaceService.findById(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }
    return workspace;
  };

  const workspaceFromParams = (key = "workspaceId") => {
    const id = requireString(params, key);
    return workspaceById(id);
  };

  switch (method) {
    case "list_workspaces": {
      return deps.workspaceService.list(deps.sessionManager.connectedWorkspaceIds());
    }
    case "add_workspace": {
      const workspacePath = requireString(params, "path");
      const entry = await deps.workspaceService.addWorkspace(workspacePath);
      return {
        ...entry,
        connected: deps.sessionManager.connectedWorkspaceIds().has(entry.id),
      };
    }
    case "add_workspace_from_git_url": {
      const url = requireString(params, "url");
      const destinationPath = requireString(params, "destinationPath");
      const targetFolderName = optionalString(params, "targetFolderName");
      const entry = await deps.workspaceService.addWorkspaceFromGitUrl(
        url,
        destinationPath,
        targetFolderName,
      );
      return {
        ...entry,
        connected: deps.sessionManager.connectedWorkspaceIds().has(entry.id),
      };
    }
    case "add_clone": {
      const sourceWorkspaceId = requireString(params, "sourceWorkspaceId");
      const copiesFolder = requireString(params, "copiesFolder");
      const copyName = requireString(params, "copyName");
      const entry = await deps.workspaceService.addClone(sourceWorkspaceId, copiesFolder, copyName);
      return {
        ...entry,
        connected: deps.sessionManager.connectedWorkspaceIds().has(entry.id),
      };
    }
    case "add_worktree": {
      const parentId = requireString(params, "parentId");
      const branch = requireString(params, "branch");
      const name = optionalString(params, "name");
      const copyAgentsMd = optionalBoolean(params, "copyAgentsMd") ?? true;
      const entry = await deps.workspaceService.addWorktree(parentId, branch, name, copyAgentsMd);
      return {
        ...entry,
        connected: deps.sessionManager.connectedWorkspaceIds().has(entry.id),
      };
    }
    case "worktree_setup_status": {
      const workspaceId = requireString(params, "workspaceId");
      return deps.workspaceService.worktreeSetupStatus(workspaceId);
    }
    case "worktree_setup_mark_ran": {
      const workspaceId = requireString(params, "workspaceId");
      await deps.workspaceService.worktreeSetupMarkRan(workspaceId);
      return { ok: true };
    }
    case "is_workspace_path_dir": {
      const workspacePath = requireString(params, "path");
      return deps.workspaceService.isWorkspacePathDir(workspacePath);
    }
    case "remove_workspace": {
      const workspaceId = requireString(params, "id");
      deps.sessionManager.disconnect(workspaceId);
      await deps.workspaceService.removeWorkspace(workspaceId);
      return { ok: true };
    }
    case "remove_worktree": {
      const workspaceId = requireString(params, "id");
      deps.sessionManager.disconnect(workspaceId);
      await deps.workspaceService.removeWorktree(workspaceId);
      return { ok: true };
    }
    case "rename_worktree": {
      const workspaceId = requireString(params, "id");
      const branch = requireString(params, "branch");
      const entry = await deps.workspaceService.renameWorktree(workspaceId, branch);
      return {
        ...entry,
        connected: deps.sessionManager.connectedWorkspaceIds().has(entry.id),
      };
    }
    case "rename_worktree_upstream": {
      const workspaceId = requireString(params, "id");
      const oldBranch = requireString(params, "oldBranch");
      const newBranch = requireString(params, "newBranch");
      await deps.workspaceService.renameWorktreeUpstream(workspaceId, oldBranch, newBranch);
      return { ok: true };
    }
    case "apply_worktree_changes": {
      const workspaceId = requireString(params, "workspaceId");
      await deps.workspaceService.applyWorktreeChanges(workspaceId);
      return { ok: true };
    }
    case "connect_workspace": {
      const id = requireString(params, "id");
      const workspace = workspaceById(id);
      await deps.sessionManager.connect(workspace);
      return { ok: true };
    }
    case "set_workspace_runtime_codex_args": {
      const workspaceId = requireString(params, "workspaceId");
      const codexArgs = optionalString(params, "codexArgs");
      return deps.workspaceService.setRuntimeCodexArgs(workspaceId, codexArgs);
    }
    case "update_workspace_settings": {
      const id = requireString(params, "id");
      const settings = (params.settings ?? {}) as Record<string, unknown>;
      const workspace = await deps.workspaceService.updateSettings(id, {
        sidebarCollapsed: Boolean(settings.sidebarCollapsed ?? false),
        sortOrder: (settings.sortOrder ?? null) as number | null,
        groupId: (settings.groupId ?? null) as string | null,
        cloneSourceWorkspaceId: (settings.cloneSourceWorkspaceId ?? null) as string | null,
        gitRoot: (settings.gitRoot ?? null) as string | null,
        launchScript: (settings.launchScript ?? null) as string | null,
        worktreeSetupScript: (settings.worktreeSetupScript ?? null) as string | null,
      });
      return {
        ...workspace,
        connected: deps.sessionManager.connectedWorkspaceIds().has(workspace.id),
      };
    }
    case "start_thread": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.startThread(workspace);
    }
    case "list_threads": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.listThreads(
        workspace,
        optionalString(params, "cursor"),
        optionalNumber(params, "limit"),
        optionalString(params, "sortKey"),
      );
    }
    case "resume_thread": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      return deps.sessionManager.resumeThread(workspace, threadId);
    }
    case "fork_thread": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      return deps.sessionManager.forkThread(workspace, threadId);
    }
    case "compact_thread": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      return deps.sessionManager.compactThread(workspace, threadId);
    }
    case "archive_thread": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      return deps.sessionManager.archiveThread(workspace, threadId);
    }
    case "set_thread_name": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      const name = requireString(params, "name");
      return deps.sessionManager.setThreadName(workspace, threadId, name);
    }
    case "thread_live_subscribe": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      return deps.sessionManager.threadLiveSubscribe(workspace, threadId);
    }
    case "thread_live_unsubscribe": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      return deps.sessionManager.threadLiveUnsubscribe(workspace, threadId);
    }
    case "list_mcp_server_status": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.listMcpServerStatus(
        workspace,
        optionalString(params, "cursor"),
        optionalNumber(params, "limit"),
      );
    }
    case "send_user_message": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      const text = String(params.text ?? "");
      return deps.sessionManager.sendUserMessage(workspace, {
        threadId,
        text,
        model: (params.model as string | null | undefined) ?? null,
        effort: (params.effort as string | null | undefined) ?? null,
        accessMode: (params.accessMode as string | null | undefined) ?? null,
        images: (params.images as string[] | null | undefined) ?? null,
        appMentions: (params.appMentions as unknown[] | null | undefined) ?? null,
        collaborationMode:
          (params.collaborationMode as Record<string, unknown> | null | undefined) ?? null,
      });
    }
    case "turn_steer": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.steerTurn(workspace, {
        threadId: requireString(params, "threadId"),
        turnId: requireString(params, "turnId"),
        text: String(params.text ?? ""),
        images: (params.images as string[] | null | undefined) ?? null,
        appMentions: (params.appMentions as unknown[] | null | undefined) ?? null,
      });
    }
    case "turn_interrupt": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.interruptTurn(workspace, {
        threadId: requireString(params, "threadId"),
        turnId: requireString(params, "turnId"),
      });
    }
    case "start_review": {
      const workspace = workspaceFromParams();
      const threadId = requireString(params, "threadId");
      if (!Object.prototype.hasOwnProperty.call(params, "target")) {
        throw new Error("target is required");
      }
      return deps.sessionManager.startReview(
        workspace,
        threadId,
        params.target,
        optionalString(params, "delivery"),
      );
    }
    case "respond_to_server_request": {
      const workspace = workspaceFromParams();
      const requestId = params.requestId as string | number;
      if (requestId === undefined || requestId === null) {
        throw new Error("requestId is required");
      }
      const result = (params.result ?? {}) as Record<string, unknown>;
      await deps.sessionManager.respondToServerRequest(workspace, requestId, result);
      return { ok: true };
    }
    case "model_list": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "model/list", {});
    }
    case "experimental_feature_list": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "experimentalFeature/list", {
        cursor: optionalString(params, "cursor"),
        limit: optionalNumber(params, "limit"),
      });
    }
    case "collaboration_mode_list": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "collaborationMode/list", {});
    }
    case "account_rate_limits": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "account/rateLimits/read", null);
    }
    case "account_read": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "account/read", null);
    }
    case "codex_login": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.codexLogin(workspace);
    }
    case "codex_login_cancel": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.codexLoginCancel(workspace);
    }
    case "skills_list": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "skills/list", {
        cwd: workspace.path,
      });
    }
    case "apps_list": {
      const workspace = workspaceFromParams();
      return deps.sessionManager.callSessionMethod(workspace, "app/list", {
        cursor: optionalString(params, "cursor"),
        limit: optionalNumber(params, "limit"),
        threadId: optionalString(params, "threadId"),
      });
    }
    case "remember_approval_rule": {
      workspaceFromParams();
      const rawCommand = params.command;
      if (!Array.isArray(rawCommand)) {
        throw new Error("command is required");
      }
      const command = rawCommand.map((item) => String(item));
      return rememberApprovalRule(command);
    }
    case "init_git_repo": {
      const workspace = workspaceFromParams();
      const branch = requireString(params, "branch");
      const force = optionalBoolean(params, "force") ?? false;
      return initGitRepo(workspace, branch, force);
    }
    case "create_github_repo": {
      const workspace = workspaceFromParams();
      const repo = requireString(params, "repo");
      const visibilityRaw = requireString(params, "visibility");
      const visibility = visibilityRaw === "public" ? "public" : "private";
      const branch = optionalString(params, "branch");
      return createGitHubRepo(workspace, repo, visibility, branch);
    }
    case "get_git_status": {
      const workspace = workspaceFromParams();
      return getGitStatus(workspace);
    }
    case "get_git_diffs": {
      const workspace = workspaceFromParams();
      return getGitDiffs(workspace);
    }
    case "get_git_log": {
      const workspace = workspaceFromParams();
      return getGitLog(workspace, optionalNumber(params, "limit"));
    }
    case "list_git_roots": {
      const workspace = workspaceFromParams();
      return listGitRoots(workspace, optionalNumber(params, "depth"));
    }
    case "get_git_commit_diff": {
      const workspace = workspaceFromParams();
      const sha = requireString(params, "sha");
      return getGitCommitDiff(workspace, sha);
    }
    case "get_github_issues": {
      const workspace = workspaceFromParams();
      return getGitHubIssues(workspace);
    }
    case "get_github_pull_requests": {
      const workspace = workspaceFromParams();
      return getGitHubPullRequests(workspace);
    }
    case "get_github_pull_request_diff": {
      const workspace = workspaceFromParams();
      const prNumber = Number(params.prNumber);
      if (!Number.isFinite(prNumber)) {
        throw new Error("prNumber must be a number");
      }
      return getGitHubPullRequestDiff(workspace, prNumber);
    }
    case "get_github_pull_request_comments": {
      const workspace = workspaceFromParams();
      const prNumber = Number(params.prNumber);
      if (!Number.isFinite(prNumber)) {
        throw new Error("prNumber must be a number");
      }
      return getGitHubPullRequestComments(workspace, prNumber);
    }
    case "checkout_github_pull_request": {
      const workspace = workspaceFromParams();
      const prNumber = Number(params.prNumber);
      if (!Number.isFinite(prNumber)) {
        throw new Error("prNumber must be a number");
      }
      await checkoutGitHubPullRequest(workspace, prNumber);
      return { ok: true };
    }
    case "get_git_remote": {
      const workspace = workspaceFromParams();
      return getGitRemote(workspace);
    }
    case "stage_git_file": {
      const workspace = workspaceFromParams();
      const filePath = requireString(params, "path");
      await stageGitFile(workspace, filePath);
      return { ok: true };
    }
    case "stage_git_all": {
      const workspace = workspaceFromParams();
      await stageGitAll(workspace);
      return { ok: true };
    }
    case "unstage_git_file": {
      const workspace = workspaceFromParams();
      const filePath = requireString(params, "path");
      await unstageGitFile(workspace, filePath);
      return { ok: true };
    }
    case "revert_git_file": {
      const workspace = workspaceFromParams();
      const filePath = requireString(params, "path");
      await revertGitFile(workspace, filePath);
      return { ok: true };
    }
    case "revert_git_all": {
      const workspace = workspaceFromParams();
      await revertGitAll(workspace);
      return { ok: true };
    }
    case "commit_git": {
      const workspace = workspaceFromParams();
      const message = requireString(params, "message");
      await commitGit(workspace, message);
      return { ok: true };
    }
    case "push_git": {
      const workspace = workspaceFromParams();
      await pushGit(workspace);
      return { ok: true };
    }
    case "pull_git": {
      const workspace = workspaceFromParams();
      await pullGit(workspace);
      return { ok: true };
    }
    case "fetch_git": {
      const workspace = workspaceFromParams();
      await fetchGit(workspace);
      return { ok: true };
    }
    case "sync_git": {
      const workspace = workspaceFromParams();
      await syncGit(workspace);
      return { ok: true };
    }
    case "list_git_branches": {
      const workspace = workspaceFromParams();
      return listGitBranches(workspace);
    }
    case "checkout_git_branch": {
      const workspace = workspaceFromParams();
      const name = requireString(params, "name");
      await checkoutGitBranch(workspace, name);
      return { ok: true };
    }
    case "create_git_branch": {
      const workspace = workspaceFromParams();
      const name = requireString(params, "name");
      await createGitBranch(workspace, name);
      return { ok: true };
    }
    case "local_usage_snapshot": {
      return localUsageSnapshot(optionalNumber(params, "days"), optionalString(params, "workspacePath"));
    }
    case "write_agent_config_toml": {
      const agentName = requireString(params, "agentName");
      const content = String(params.content ?? "");
      await writeAgentConfigToml(agentName, content);
      return { ok: true };
    }
    case "set_codex_feature_flag": {
      const featureKey = requireString(params, "featureKey");
      const enabled = optionalBoolean(params, "enabled");
      if (enabled === null) {
        throw new Error("enabled must be a boolean");
      }
      await setCodexFeatureFlag(featureKey, enabled);
      return { ok: true };
    }
    case "dictation_start": {
      const preferredLanguage = optionalString(params, "preferredLanguage");
      await deps.dictationService.start(preferredLanguage);
      return { ok: true };
    }
    case "dictation_request_permission": {
      return deps.dictationService.requestPermission();
    }
    case "dictation_stop": {
      await deps.dictationService.stop();
      return { ok: true };
    }
    case "dictation_cancel": {
      await deps.dictationService.cancel();
      return { ok: true };
    }
    case "generate_commit_message": {
      const workspace = workspaceFromParams();
      const commitMessageModelId = optionalString(params, "commitMessageModelId");
      return generateCommitMessage(workspace, commitMessageModelId);
    }
    case "generate_agent_description": {
      const workspace = workspaceFromParams();
      const description = String(params.description ?? "");
      return generateAgentDescription(workspace, description);
    }
    case "list_workspace_files": {
      const workspace = workspaceFromParams();
      return listWorkspaceFiles(workspace);
    }
    case "read_workspace_file": {
      const workspace = workspaceFromParams();
      const filePath = requireString(params, "path");
      return readWorkspaceFile(workspace, filePath);
    }
    case "file_read": {
      const scope = parseFileScope(params.scope);
      const kind = parseFileKind(params.kind);
      const workspace = scope === "workspace" ? workspaceFromParams() : undefined;
      return fileRead(scope, kind, workspace);
    }
    case "file_write": {
      const scope = parseFileScope(params.scope);
      const kind = parseFileKind(params.kind);
      const content = String(params.content ?? "");
      const workspace = scope === "workspace" ? workspaceFromParams() : undefined;
      await fileWrite(scope, kind, content, workspace);
      return { ok: true };
    }
    case "prompts_list": {
      const workspace = workspaceFromParams();
      return deps.promptService.list(workspace);
    }
    case "prompts_workspace_dir": {
      const workspace = workspaceFromParams();
      return deps.promptService.workspaceDir(workspace);
    }
    case "prompts_global_dir": {
      workspaceFromParams();
      return deps.promptService.globalDir();
    }
    case "prompts_create": {
      const workspace = workspaceFromParams();
      return deps.promptService.create(workspace, {
        scope: parsePromptScope(params.scope),
        name: requireString(params, "name"),
        description: optionalString(params, "description"),
        argumentHint: optionalString(params, "argumentHint"),
        content: String(params.content ?? ""),
      });
    }
    case "prompts_update": {
      const workspace = workspaceFromParams();
      return deps.promptService.update(workspace, {
        path: requireString(params, "path"),
        name: requireString(params, "name"),
        description: optionalString(params, "description"),
        argumentHint: optionalString(params, "argumentHint"),
        content: String(params.content ?? ""),
      });
    }
    case "prompts_delete": {
      const workspace = workspaceFromParams();
      await deps.promptService.remove(workspace, requireString(params, "path"));
      return { ok: true };
    }
    case "prompts_move": {
      const workspace = workspaceFromParams();
      return deps.promptService.move(
        workspace,
        requireString(params, "path"),
        parsePromptScope(params.scope),
      );
    }
    case "terminal_open": {
      const workspace = workspaceFromParams();
      const terminalId = requireString(params, "terminalId");
      return deps.terminalService.open(
        workspace,
        terminalId,
        Number(params.cols ?? 80),
        Number(params.rows ?? 24),
      );
    }
    case "terminal_write": {
      const workspace = workspaceFromParams();
      deps.terminalService.write(
        workspace.id,
        requireString(params, "terminalId"),
        String(params.data ?? ""),
      );
      return { ok: true };
    }
    case "terminal_resize": {
      const workspace = workspaceFromParams();
      deps.terminalService.resize(
        workspace.id,
        requireString(params, "terminalId"),
        Number(params.cols ?? 80),
        Number(params.rows ?? 24),
      );
      return { ok: true };
    }
    case "terminal_close": {
      const workspace = workspaceFromParams();
      deps.terminalService.close(workspace.id, requireString(params, "terminalId"));
      return { ok: true };
    }
    case "get_app_settings": {
      return deps.store.readSettings();
    }
    case "update_app_settings": {
      const current = await deps.store.readSettings();
      const next: AppSettings = {
        ...current,
        ...((params.settings ?? {}) as Partial<AppSettings>),
        backendMode: "remote",
      };
      await deps.store.writeSettings(next);
      return next;
    }
    default:
      break;
  }

  if (NOT_IMPLEMENTED_METHODS.has(method)) {
    throw new Error(`method not implemented in codex-remote yet: ${method}`);
  }

  throw new Error(`unknown method: ${method}`);
}
