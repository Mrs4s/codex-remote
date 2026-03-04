import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
  UndoCheckpointSummary,
} from "../../../types";
import { isPlanReadyTaggedMessage } from "../../../utils/internalPlanReadyMessages";
import { PlanReadyFollowupMessage } from "../../app/components/PlanReadyFollowupMessage";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import {
  SCROLL_THRESHOLD_PX,
  buildToolGroups,
  computePlanFollowupState,
  formatCount,
  parseReasoning,
  scrollKeyForItems,
} from "../utils/messageRenderUtils";
import {
  DiffRow,
  ExploreRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  ToolRow,
  WorkingIndicator,
} from "./MessageRows";

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  isLoadingMessages?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
  workspacePath?: string | null;
  undoCheckpoints?: UndoCheckpointSummary[];
  undoCheckpointsError?: string | null;
  undoingCheckpointId?: string | null;
  onUndoCheckpoint?: (checkpointId: string) => void | Promise<void>;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  codeBlockCopyUseModifier?: boolean;
  showMessageFilePath?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => void;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onOpenThreadLink?: (threadId: string) => void;
  onQuoteMessage?: (text: string) => void;
};

function toMarkdownQuote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")
    .concat("\n\n");
}

function formatUndoLineRange(range: { kind: "add" | "del"; start: number; end: number }) {
  const prefix = range.kind === "add" ? "+" : "-";
  if (range.start === range.end) {
    return `${prefix}${range.start}`;
  }
  return `${prefix}${range.start}-${range.end}`;
}

function formatUndoLineRanges(
  lineRanges: Array<{ kind: "add" | "del"; start: number; end: number }>,
): string | null {
  if (lineRanges.length === 0) {
    return null;
  }
  const preview = lineRanges.slice(0, 6).map(formatUndoLineRange).join(", ");
  if (lineRanges.length <= 6) {
    return preview;
  }
  return `${preview}, …`;
}

function checkpointStatusLabel(checkpoint: UndoCheckpointSummary): string {
  if (checkpoint.status === "undone") {
    return "Undone";
  }
  if (checkpoint.status === "failed") {
    return "Failed";
  }
  if (checkpoint.status === "ready" && checkpoint.undoable) {
    return "Undo available";
  }
  if (checkpoint.status === "ready" && checkpoint.files.length === 0) {
    return "No file edits";
  }
  if (checkpoint.status === "ready") {
    return "Undo blocked";
  }
  return "Recording";
}

export const Messages = memo(function Messages({
  items,
  threadId,
  workspaceId = null,
  isThinking,
  isLoadingMessages = false,
  processingStartedAt = null,
  lastDurationMs = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
  workspacePath = null,
  undoCheckpoints = [],
  undoCheckpointsError = null,
  undoingCheckpointId = null,
  onUndoCheckpoint,
  openTargets,
  selectedOpenAppId,
  codeBlockCopyUseModifier = false,
  showMessageFilePath = true,
  userInputRequests = [],
  onUserInputSubmit,
  onPlanAccept,
  onPlanSubmitChanges,
  onOpenThreadLink,
  onQuoteMessage,
}: MessagesProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const manuallyToggledExpandedRef = useRef<Set<string>>(new Set());
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Set<string>>(
    new Set(),
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const activeUserInputRequestId =
    threadId && userInputRequests.length
      ? (userInputRequests.find(
          (request) =>
            request.params.thread_id === threadId &&
            (!workspaceId || request.workspace_id === workspaceId),
        )?.request_id ?? null)
      : null;
  const scrollKey = `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;
  const { openFileLink, showFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
  );

  const isNearBottom = useCallback(
    (node: HTMLDivElement) =>
      node.scrollHeight - node.scrollTop - node.clientHeight <= SCROLL_THRESHOLD_PX,
    [],
  );

  const updateAutoScroll = () => {
    if (!containerRef.current) {
      return;
    }
    autoScrollRef.current = isNearBottom(containerRef.current);
  };

  const requestAutoScroll = useCallback(() => {
    const container = containerRef.current;
    const shouldScroll =
      autoScrollRef.current || (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return;
    }
    if (container) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [isNearBottom]);

  useLayoutEffect(() => {
    autoScrollRef.current = true;
  }, [threadId]);

  const toggleExpanded = useCallback((id: string) => {
    manuallyToggledExpandedRef.current.add(id);
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleToolGroup = useCallback((id: string) => {
    setCollapsedToolGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    items.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [items]);

  const latestReasoningLabel = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "message") {
        break;
      }
      if (item.kind !== "reasoning") {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        return parsed.workingLabel;
      }
    }
    return null;
  }, [items, reasoningMetaById]);

  const latestUndoCheckpoint = useMemo(
    () => (undoCheckpoints.length > 0 ? undoCheckpoints[0] : null),
    [undoCheckpoints],
  );
  const canUndoLatestCheckpoint = Boolean(
    latestUndoCheckpoint &&
      latestUndoCheckpoint.status === "ready" &&
      latestUndoCheckpoint.undoable &&
      onUndoCheckpoint,
  );
  const isUndoingLatestCheckpoint =
    latestUndoCheckpoint !== null && undoingCheckpointId === latestUndoCheckpoint.id;

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          item.kind === "message" &&
          item.role === "user" &&
          isPlanReadyTaggedMessage(item.text)
        ) {
          return false;
        }
        if (item.kind !== "reasoning") {
          return true;
        }
        return reasoningMetaById.get(item.id)?.hasBody ?? false;
      }),
    [items, reasoningMetaById],
  );

  useEffect(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (
        item.kind === "tool" &&
        item.toolType === "plan" &&
        (item.output ?? "").trim().length > 0
      ) {
        if (manuallyToggledExpandedRef.current.has(item.id)) {
          return;
        }
        setExpandedItems((prev) => {
          if (prev.has(item.id)) {
            return prev;
          }
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
        return;
      }
    }
  }, [visibleItems]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyMessage = useCallback(
    async (item: Extract<ConversationItem, { kind: "message" }>) => {
      try {
        await navigator.clipboard.writeText(item.text);
        setCopiedMessageId(item.id);
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
        }, 1200);
      } catch {
        // No-op: clipboard errors can occur in restricted contexts.
      }
    },
    [],
  );

  const handleQuoteMessage = useCallback(
    (item: Extract<ConversationItem, { kind: "message" }>) => {
      if (!onQuoteMessage) {
        return;
      }
      const quoteText = toMarkdownQuote(item.text);
      if (!quoteText) {
        return;
      }
      onQuoteMessage(quoteText);
    },
    [onQuoteMessage],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const shouldScroll =
      autoScrollRef.current ||
      (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return;
    }
    if (container) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [scrollKey, isThinking, isNearBottom, threadId]);

  const groupedItems = useMemo(() => buildToolGroups(visibleItems), [visibleItems]);

  const hasActiveUserInputRequest = activeUserInputRequestId !== null;
  const hasVisibleUserInputRequest = hasActiveUserInputRequest && Boolean(onUserInputSubmit);
  const userInputNode =
    hasActiveUserInputRequest && onUserInputSubmit ? (
      <RequestUserInputMessage
        requests={userInputRequests}
        activeThreadId={threadId}
        activeWorkspaceId={workspaceId}
        onSubmit={onUserInputSubmit}
      />
    ) : null;

  const [dismissedPlanFollowupByThread, setDismissedPlanFollowupByThread] =
    useState<Record<string, string>>({});

  const planFollowup = useMemo(() => {
    if (!onPlanAccept || !onPlanSubmitChanges) {
      return { shouldShow: false, planItemId: null };
    }

    const candidate = computePlanFollowupState({
      threadId,
      items,
      isThinking,
      hasVisibleUserInputRequest,
    });

    if (threadId && candidate.planItemId) {
      if (dismissedPlanFollowupByThread[threadId] === candidate.planItemId) {
        return { ...candidate, shouldShow: false };
      }
    }

    return candidate;
  }, [
    dismissedPlanFollowupByThread,
    hasVisibleUserInputRequest,
    isThinking,
    items,
    onPlanAccept,
    onPlanSubmitChanges,
    threadId,
  ]);

  const planFollowupNode =
    planFollowup.shouldShow && onPlanAccept && onPlanSubmitChanges ? (
      <PlanReadyFollowupMessage
        onAccept={() => {
          if (threadId && planFollowup.planItemId) {
            setDismissedPlanFollowupByThread((prev) => ({
              ...prev,
              [threadId]: planFollowup.planItemId!,
            }));
          }
          onPlanAccept();
        }}
        onSubmitChanges={(changes) => {
          if (threadId && planFollowup.planItemId) {
            setDismissedPlanFollowupByThread((prev) => ({
              ...prev,
              [threadId]: planFollowup.planItemId!,
            }));
          }
          onPlanSubmitChanges(changes);
        }}
      />
    ) : null;

  const renderItem = (item: ConversationItem) => {
    if (item.kind === "message") {
      const isCopied = copiedMessageId === item.id;
      return (
        <MessageRow
          key={item.id}
          item={item}
          isCopied={isCopied}
          onCopy={handleCopyMessage}
          onQuote={onQuoteMessage ? handleQuoteMessage : undefined}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      );
    }
    if (item.kind === "reasoning") {
      const isExpanded = expandedItems.has(item.id);
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      return (
        <ReasoningRow
          key={item.id}
          item={item}
          parsed={parsed}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      );
    }
    if (item.kind === "review") {
      return (
        <ReviewRow
          key={item.id}
          item={item}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={item.id} item={item} />;
    }
    if (item.kind === "tool") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <ToolRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (item.kind === "explore") {
      return <ExploreRow key={item.id} item={item} />;
    }
    return null;
  };

  return (
    <div
      className="messages messages-full"
      ref={containerRef}
      onScroll={updateAutoScroll}
    >
      {groupedItems.map((entry) => {
        if (entry.kind === "toolGroup") {
          const { group } = entry;
          const isCollapsed = collapsedToolGroups.has(group.id);
          const summaryParts = [
            formatCount(group.toolCount, "tool call", "tool calls"),
          ];
          if (group.messageCount > 0) {
            summaryParts.push(formatCount(group.messageCount, "message", "messages"));
          }
          const summaryText = summaryParts.join(", ");
          const groupBodyId = `tool-group-${group.id}`;
          const ChevronIcon = isCollapsed ? ChevronDown : ChevronUp;
          return (
            <div
              key={`tool-group-${group.id}`}
              className={`tool-group ${isCollapsed ? "tool-group-collapsed" : ""}`}
            >
              <div className="tool-group-header">
                <button
                  type="button"
                  className="tool-group-toggle"
                  onClick={() => toggleToolGroup(group.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={groupBodyId}
                  aria-label={isCollapsed ? "Expand tool calls" : "Collapse tool calls"}
                >
                  <span className="tool-group-chevron" aria-hidden>
                    <ChevronIcon size={14} />
                  </span>
                  <span className="tool-group-summary">{summaryText}</span>
                </button>
              </div>
              {!isCollapsed && (
                <div className="tool-group-body" id={groupBodyId}>
                  {group.items.map(renderItem)}
                </div>
              )}
            </div>
          );
        }
        return renderItem(entry.item);
      })}
      {planFollowupNode}
      {userInputNode}
      <WorkingIndicator
        isThinking={isThinking}
        processingStartedAt={processingStartedAt}
        lastDurationMs={lastDurationMs}
        hasItems={items.length > 0}
        reasoningLabel={latestReasoningLabel}
        showPollingFetchStatus={showPollingFetchStatus}
        pollingIntervalMs={pollingIntervalMs}
      />
      {latestUndoCheckpoint && (
        <div className="undo-checkpoint-card">
          <div className="undo-checkpoint-header">
            <span className="undo-checkpoint-title">Latest checkpoint</span>
            <span className="undo-checkpoint-time">
              {new Date(latestUndoCheckpoint.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="undo-checkpoint-file-list">
            {latestUndoCheckpoint.files.length > 0 ? (
              latestUndoCheckpoint.files.map((file) => {
                const lineRanges = formatUndoLineRanges(file.lineRanges);
                return (
                  <div key={`${latestUndoCheckpoint.id}:${file.path}`} className="undo-checkpoint-file">
                    <span className="undo-checkpoint-file-path" title={file.path}>
                      {file.path}
                    </span>
                    <span className="undo-checkpoint-file-meta">
                      {lineRanges ?? `+${file.additions} / -${file.deletions}`}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="undo-checkpoint-empty">No file edits captured.</div>
            )}
          </div>
          {latestUndoCheckpoint.outOfBandFiles.length > 0 && (
            <div className="undo-checkpoint-extra-files">
              <div className="undo-checkpoint-extra-title">Additional changed files</div>
              {latestUndoCheckpoint.outOfBandFiles.slice(0, 4).map((filePath) => (
                <div key={`${latestUndoCheckpoint.id}:extra:${filePath}`} className="undo-checkpoint-file">
                  <span className="undo-checkpoint-file-path" title={filePath}>
                    {filePath}
                  </span>
                </div>
              ))}
              {latestUndoCheckpoint.outOfBandFiles.length > 4 && (
                <div className="undo-checkpoint-extra-more">
                  +{latestUndoCheckpoint.outOfBandFiles.length - 4} more file
                  {latestUndoCheckpoint.outOfBandFiles.length - 4 === 1 ? "" : "s"}
                </div>
              )}
            </div>
          )}
          <div className="undo-checkpoint-footer">
            <span className="undo-checkpoint-status" data-status={latestUndoCheckpoint.status}>
              {checkpointStatusLabel(latestUndoCheckpoint)}
            </span>
            {canUndoLatestCheckpoint && (
              <button
                type="button"
                className="ghost undo-checkpoint-button"
                onClick={() => onUndoCheckpoint?.(latestUndoCheckpoint.id)}
                disabled={isUndoingLatestCheckpoint}
              >
                {isUndoingLatestCheckpoint ? "Undoing..." : "Undo this turn"}
              </button>
            )}
          </div>
          {(latestUndoCheckpoint.failureMessage || undoCheckpointsError) && (
            <div className="diff-error undo-checkpoint-error">
              {latestUndoCheckpoint.failureMessage || undoCheckpointsError}
            </div>
          )}
        </div>
      )}
      {!latestUndoCheckpoint && undoCheckpointsError && (
        <div className="diff-error undo-checkpoint-error">{undoCheckpointsError}</div>
      )}
      {!items.length && !userInputNode && !isThinking && !isLoadingMessages && (
        <div className="empty messages-empty">
          {threadId ? "Send a prompt to the agent." : "Send a prompt to start a new agent."}
        </div>
      )}
      {!items.length && !userInputNode && !isThinking && isLoadingMessages && (
        <div className="empty messages-empty">
          <div className="messages-loading-indicator" role="status" aria-live="polite">
            <span className="working-spinner" aria-hidden />
            <span className="messages-loading-label">Loading…</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
});
