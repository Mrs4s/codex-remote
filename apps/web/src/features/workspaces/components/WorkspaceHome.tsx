import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  AccessMode,
  AppOption,
  CustomPromptOption,
  ModelOption,
  SkillOption,
  WorkspaceInfo,
} from "../../../types";
import { ComposerInput } from "../../composer/components/ComposerInput";
import { useComposerImages } from "../../composer/hooks/useComposerImages";
import { useComposerAutocompleteState } from "../../composer/hooks/useComposerAutocompleteState";
import { usePromptHistory } from "../../composer/hooks/usePromptHistory";
import type {
  WorkspaceHomeRun,
  WorkspaceHomeRunInstance,
  WorkspaceRunMode,
} from "../hooks/useWorkspaceHome";
import { isComposingEvent } from "../../../utils/keys";
import { FileEditorCard } from "../../shared/components/FileEditorCard";
import { WorkspaceHomeRunControls } from "./WorkspaceHomeRunControls";
import { WorkspaceHomeHistory } from "./WorkspaceHomeHistory";
import { WorkspaceHomeGitInitBanner } from "./WorkspaceHomeGitInitBanner";
import { buildIconPath } from "./workspaceHomeHelpers";
import { useWorkspaceHomeSuggestionsStyle } from "../hooks/useWorkspaceHomeSuggestionsStyle";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { useLocalUsage } from "../../home/hooks/useLocalUsage";
import { formatRelativeTime } from "../../../utils/time";

type WorkspaceHomeProps = {
  workspace: WorkspaceInfo;
  showGitInitBanner: boolean;
  initGitRepoLoading: boolean;
  onInitGitRepo: () => void | Promise<void>;
  runs: WorkspaceHomeRun[];
  recentThreadInstances: WorkspaceHomeRunInstance[];
  recentThreadsUpdatedAt: number | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  onStartRun: (images?: string[]) => Promise<boolean>;
  runMode: WorkspaceRunMode;
  onRunModeChange: (mode: WorkspaceRunMode) => void;
  models: ModelOption[];
  selectedModelId: string | null;
  onSelectModel: (modelId: string) => void;
  modelSelections: Record<string, number>;
  onToggleModel: (modelId: string) => void;
  onModelCountChange: (modelId: string, count: number) => void;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  reasoningSupported: boolean;
  error: string | null;
  isSubmitting: boolean;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  onSelectInstance: (workspaceId: string, threadId: string) => void;
  skills: SkillOption[];
  appsEnabled: boolean;
  apps: AppOption[];
  prompts: CustomPromptOption[];
  files: string[];
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onFileAutocompleteActiveChange?: (active: boolean) => void;
  agentMdContent: string;
  agentMdExists: boolean;
  agentMdTruncated: boolean;
  agentMdLoading: boolean;
  agentMdSaving: boolean;
  agentMdError: string | null;
  agentMdDirty: boolean;
  onAgentMdChange: (value: string) => void;
  onAgentMdRefresh: () => void;
  onAgentMdSave: () => void;
};

export function WorkspaceHome({
  workspace,
  showGitInitBanner,
  initGitRepoLoading,
  onInitGitRepo,
  runs,
  recentThreadInstances,
  recentThreadsUpdatedAt,
  prompt,
  onPromptChange,
  onStartRun,
  runMode,
  onRunModeChange,
  models,
  selectedModelId,
  onSelectModel,
  modelSelections,
  onToggleModel,
  onModelCountChange,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  accessMode,
  onSelectAccessMode,
  reasoningSupported,
  error,
  isSubmitting,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  onSelectInstance,
  skills,
  appsEnabled,
  apps,
  prompts,
  files,
  textareaRef: textareaRefProp,
  onFileAutocompleteActiveChange,
  agentMdContent,
  agentMdExists,
  agentMdTruncated,
  agentMdLoading,
  agentMdSaving,
  agentMdError,
  agentMdDirty,
  onAgentMdChange,
  onAgentMdRefresh,
  onAgentMdSave,
}: WorkspaceHomeProps) {
  const {
    snapshot: localUsageSnapshot,
    isLoading: isLoadingLocalUsage,
    error: localUsageError,
    refresh: refreshLocalUsage,
  } = useLocalUsage(true, workspace.path);
  const [showIcon, setShowIcon] = useState(true);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const iconPath = useMemo(() => buildIconPath(workspace.path), [workspace.path]);
  const iconSrc = useMemo(() => convertFileSrc(iconPath), [iconPath]);
  const fallbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = textareaRefProp ?? fallbackTextareaRef;
  const {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
  } = useComposerImages({
    activeThreadId: null,
    activeWorkspaceId: workspace.id,
  });

  const {
    isAutocompleteOpen,
    autocompleteMatches,
    autocompleteAnchorIndex,
    highlightIndex,
    setHighlightIndex,
    applyAutocomplete,
    handleInputKeyDown,
    handleTextChange,
    handleSelectionChange,
    fileTriggerActive,
  } = useComposerAutocompleteState({
    text: prompt,
    selectionStart,
    disabled: isSubmitting,
    appsEnabled,
    skills,
    apps,
    prompts,
    files,
    textareaRef,
    setText: onPromptChange,
    setSelectionStart,
  });

  const suggestionsStyle = useWorkspaceHomeSuggestionsStyle({
    isAutocompleteOpen,
    autocompleteAnchorIndex,
    selectionStart,
    prompt,
    textareaRef,
  });

  useEffect(() => {
    onFileAutocompleteActiveChange?.(fileTriggerActive);
  }, [fileTriggerActive, onFileAutocompleteActiveChange]);

  const {
    handleHistoryKeyDown,
    handleHistoryTextChange,
    recordHistory,
    resetHistoryNavigation,
  } = usePromptHistory({
    historyKey: workspace.id,
    text: prompt,
    hasAttachments: activeImages.length > 0,
    disabled: isSubmitting,
    isAutocompleteOpen,
    textareaRef,
    setText: onPromptChange,
    setSelectionStart,
  });

  const handleTextChangeWithHistory = (next: string, cursor: number | null) => {
    handleHistoryTextChange(next);
    handleTextChange(next, cursor);
  };

  useEffect(() => {
    setShowIcon(true);
  }, [workspace.id]);

  const handleRunSubmit = async () => {
    if (!prompt.trim() && activeImages.length === 0) {
      return;
    }

    const trimmed = prompt.trim();
    const didStart = await onStartRun(activeImages);
    if (didStart) {
      if (trimmed) {
        recordHistory(trimmed);
      }
      resetHistoryNavigation();
      clearActiveImages();
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingEvent(event)) {
      return;
    }

    handleHistoryKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }

    handleInputKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleRunSubmit();
    }
  };

  const agentMdStatus = agentMdLoading
    ? "Loading…"
    : agentMdSaving
      ? "Saving…"
      : agentMdExists
        ? ""
        : "Not found";
  const agentMdMetaParts: string[] = [];
  if (agentMdStatus) {
    agentMdMetaParts.push(agentMdStatus);
  }
  if (agentMdTruncated) {
    agentMdMetaParts.push("Truncated");
  }
  const agentMdMeta = agentMdMetaParts.join(" · ");
  const agentMdSaveLabel = agentMdExists ? "Save" : "Create";
  const agentMdSaveDisabled = agentMdLoading || agentMdSaving || !agentMdDirty;
  const agentMdRefreshDisabled = agentMdLoading || agentMdSaving;
  const usageTotals = localUsageSnapshot?.totals ?? null;
  const usageUpdatedAt = localUsageSnapshot
    ? `Updated ${formatRelativeTime(localUsageSnapshot.updatedAt)}`
    : null;
  const peakDayLabel = (() => {
    const day = usageTotals?.peakDay;
    if (!day) {
      return "--";
    }
    const [year, month, date] = day.split("-").map(Number);
    if (!year || !month || !date) {
      return day;
    }
    const parsed = new Date(year, month - 1, date);
    if (Number.isNaN(parsed.getTime())) {
      return day;
    }
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(parsed);
  })();
  const topModels = localUsageSnapshot?.topModels?.slice(0, 5) ?? [];
  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return "--";
    }
    return new Intl.NumberFormat().format(value);
  };
  const showUsageSkeleton = isLoadingLocalUsage && !localUsageSnapshot;
  const showUsageEmpty = !isLoadingLocalUsage && !localUsageSnapshot;

  return (
    <div className="workspace-home">
      <div className="workspace-home-hero">
        {showIcon && (
          <img
            className="workspace-home-icon"
            src={iconSrc}
            alt=""
            onError={() => setShowIcon(false)}
          />
        )}
        <div>
          <div className="workspace-home-title">{workspace.name}</div>
          <div className="workspace-home-path">{workspace.path}</div>
        </div>
      </div>

      <div className="workspace-home-composer">
        <div className="composer">
          <ComposerInput
            text={prompt}
            disabled={isSubmitting}
            sendLabel="Send"
            canStop={false}
            canSend={prompt.trim().length > 0 || activeImages.length > 0}
            isProcessing={isSubmitting}
            onStop={() => {}}
            onSend={() => {
              void handleRunSubmit();
            }}
            attachments={activeImages}
            onAddAttachment={() => {
              void pickImages();
            }}
            onAttachImages={attachImages}
            onRemoveAttachment={removeImage}
            onTextChange={handleTextChangeWithHistory}
            onSelectionChange={handleSelectionChange}
            onKeyDown={handleComposerKeyDown}
            isExpanded={false}
            onToggleExpand={undefined}
            textareaRef={textareaRef}
            suggestionsOpen={isAutocompleteOpen}
            suggestions={autocompleteMatches}
            highlightIndex={highlightIndex}
            onHighlightIndex={setHighlightIndex}
            onSelectSuggestion={applyAutocomplete}
            suggestionsStyle={suggestionsStyle}
          />
        </div>
        {error && <div className="workspace-home-error">{error}</div>}
      </div>

      {showGitInitBanner && (
        <WorkspaceHomeGitInitBanner
          isLoading={initGitRepoLoading}
          onInitGitRepo={onInitGitRepo}
        />
      )}

      <WorkspaceHomeRunControls
        workspaceKind={workspace.kind}
        runMode={runMode}
        onRunModeChange={onRunModeChange}
        models={models}
        selectedModelId={selectedModelId}
        onSelectModel={onSelectModel}
        modelSelections={modelSelections}
        onToggleModel={onToggleModel}
        onModelCountChange={onModelCountChange}
        collaborationModes={collaborationModes}
        selectedCollaborationModeId={selectedCollaborationModeId}
        onSelectCollaborationMode={onSelectCollaborationMode}
        reasoningOptions={reasoningOptions}
        selectedEffort={selectedEffort}
        onSelectEffort={onSelectEffort}
        accessMode={accessMode}
        onSelectAccessMode={onSelectAccessMode}
        reasoningSupported={reasoningSupported}
        isSubmitting={isSubmitting}
      />

      <div className="workspace-home-agent">
        {agentMdTruncated && (
          <div className="workspace-home-agent-warning">
            Showing the first part of a large file.
          </div>
        )}
        <FileEditorCard
          title="AGENTS.md"
          meta={agentMdMeta}
          error={agentMdError}
          value={agentMdContent}
          placeholder="Add workspace instructions for the agent…"
          disabled={agentMdLoading}
          refreshDisabled={agentMdRefreshDisabled}
          saveDisabled={agentMdSaveDisabled}
          saveLabel={agentMdSaveLabel}
          onChange={onAgentMdChange}
          onRefresh={onAgentMdRefresh}
          onSave={onAgentMdSave}
          classNames={{
            container: "workspace-home-agent-card",
            header: "workspace-home-section-header",
            title: "workspace-home-section-title",
            actions: "workspace-home-section-actions",
            meta: "workspace-home-section-meta",
            iconButton: "ghost workspace-home-icon-button",
            error: "workspace-home-error",
            textarea: "workspace-home-agent-textarea",
            help: "workspace-home-section-meta",
          }}
        />
      </div>

      <WorkspaceHomeHistory
        runs={runs}
        recentThreadInstances={recentThreadInstances}
        recentThreadsUpdatedAt={recentThreadsUpdatedAt}
        activeWorkspaceId={activeWorkspaceId}
        activeThreadId={activeThreadId}
        threadStatusById={threadStatusById}
        onSelectInstance={onSelectInstance}
      />

      <div className="workspace-home-usage">
        <div className="workspace-home-section-header">
          <div className="workspace-home-section-title">Project usage</div>
          <div className="workspace-home-section-actions">
            {usageUpdatedAt && (
              <span className="workspace-home-section-meta">{usageUpdatedAt}</span>
            )}
            <button
              type="button"
              className={
                isLoadingLocalUsage
                  ? "ghost workspace-home-usage-refresh is-loading"
                  : "ghost workspace-home-usage-refresh"
              }
              onClick={() => {
                refreshLocalUsage()?.catch(() => {});
              }}
              disabled={isLoadingLocalUsage}
              aria-label="Refresh project usage"
              title="Refresh project usage"
            >
              <RefreshCw
                size={14}
                className={isLoadingLocalUsage ? "workspace-home-refresh-icon spinning" : ""}
                aria-hidden
              />
            </button>
          </div>
        </div>
        {showUsageSkeleton ? (
          <div className="workspace-home-usage-empty">Loading usage data…</div>
        ) : showUsageEmpty ? (
          <div className="workspace-home-usage-empty">No usage data yet for this project.</div>
        ) : (
          <>
            <div className="workspace-home-usage-grid">
              <div className="workspace-home-usage-card">
                <span className="workspace-home-usage-label">Last 7 days</span>
                <span className="workspace-home-usage-value">
                  {formatNumber(usageTotals?.last7DaysTokens)}
                </span>
              </div>
              <div className="workspace-home-usage-card">
                <span className="workspace-home-usage-label">Last 30 days</span>
                <span className="workspace-home-usage-value">
                  {formatNumber(usageTotals?.last30DaysTokens)}
                </span>
              </div>
              <div className="workspace-home-usage-card">
                <span className="workspace-home-usage-label">Avg / day</span>
                <span className="workspace-home-usage-value">
                  {formatNumber(usageTotals?.averageDailyTokens)}
                </span>
              </div>
              <div className="workspace-home-usage-card">
                <span className="workspace-home-usage-label">Cache hit rate</span>
                <span className="workspace-home-usage-value">
                  {usageTotals ? `${usageTotals.cacheHitRatePercent.toFixed(1)}%` : "--"}
                </span>
              </div>
              <div className="workspace-home-usage-card">
                <span className="workspace-home-usage-label">Peak day</span>
                <span className="workspace-home-usage-value">
                  {peakDayLabel}
                  {usageTotals?.peakDayTokens
                    ? ` · ${formatNumber(usageTotals.peakDayTokens)}`
                    : ""}
                </span>
              </div>
            </div>
            <div className="workspace-home-usage-models">
              <span className="workspace-home-section-meta">Top models</span>
              <div className="workspace-home-usage-model-list">
                {topModels.length > 0 ? (
                  topModels.map((model) => (
                    <span
                      className="workspace-home-usage-model-chip"
                      key={model.model}
                      title={`${model.model}: ${formatNumber(model.tokens)} tokens`}
                    >
                      {model.model}
                      <span className="workspace-home-usage-model-share">
                        {model.sharePercent.toFixed(1)}%
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="workspace-home-section-meta">No models yet</span>
                )}
              </div>
            </div>
          </>
        )}
        {localUsageError && <div className="workspace-home-error">{localUsageError}</div>}
      </div>
    </div>
  );
}
