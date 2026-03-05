import { useCallback, useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { buildConversationItem } from "@utils/threadItems";
import { asString } from "@threads/utils/threadNormalize";
import type { ThreadAction } from "./useThreadsReducer";

const STREAM_FLUSH_INTERVAL_MS = 50;

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  onUserMessageCreated?: (
    workspaceId: string,
    threadId: string,
    text: string,
  ) => void | Promise<void>;
  onReviewExited?: (workspaceId: string, threadId: string) => void;
};

type PendingAgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  parts: string[];
};

type PendingThreadDelta = {
  threadId: string;
  itemId: string;
  parts: string[];
};

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  getCustomName,
  markProcessing,
  markReviewing,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  onUserMessageCreated,
  onReviewExited,
}: UseThreadItemEventsOptions) {
  const pendingAgentDeltasRef = useRef<Map<string, PendingAgentDelta>>(new Map());
  const pendingToolOutputDeltasRef = useRef<Map<string, PendingThreadDelta>>(new Map());
  const pendingReasoningSummaryDeltasRef =
    useRef<Map<string, PendingThreadDelta>>(new Map());
  const pendingReasoningContentDeltasRef =
    useRef<Map<string, PendingThreadDelta>>(new Map());
  const pendingPlanDeltasRef = useRef<Map<string, PendingThreadDelta>>(new Map());
  const flushTimerRef = useRef<number | null>(null);
  const nextFlushAtRef = useRef(0);

  const cancelScheduledFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushPendingDeltas = useCallback(() => {
    cancelScheduledFlush();

    const didHavePending =
      pendingAgentDeltasRef.current.size > 0 ||
      pendingToolOutputDeltasRef.current.size > 0 ||
      pendingReasoningSummaryDeltasRef.current.size > 0 ||
      pendingReasoningContentDeltasRef.current.size > 0 ||
      pendingPlanDeltasRef.current.size > 0;

    if (!didHavePending) {
      return;
    }

    nextFlushAtRef.current = Date.now() + STREAM_FLUSH_INTERVAL_MS;

    for (const entry of pendingAgentDeltasRef.current.values()) {
      const delta = entry.parts.join("");
      if (!delta) {
        continue;
      }
      dispatch({ type: "ensureThread", workspaceId: entry.workspaceId, threadId: entry.threadId });
      markProcessing(entry.threadId, true);
      const hasCustomName = Boolean(getCustomName(entry.workspaceId, entry.threadId));
      dispatch({
        type: "appendAgentDelta",
        workspaceId: entry.workspaceId,
        threadId: entry.threadId,
        itemId: entry.itemId,
        delta,
        hasCustomName,
      });
    }
    pendingAgentDeltasRef.current.clear();

    for (const entry of pendingReasoningSummaryDeltasRef.current.values()) {
      const delta = entry.parts.join("");
      if (!delta) {
        continue;
      }
      dispatch({ type: "appendReasoningSummary", threadId: entry.threadId, itemId: entry.itemId, delta });
    }
    pendingReasoningSummaryDeltasRef.current.clear();

    for (const entry of pendingReasoningContentDeltasRef.current.values()) {
      const delta = entry.parts.join("");
      if (!delta) {
        continue;
      }
      dispatch({ type: "appendReasoningContent", threadId: entry.threadId, itemId: entry.itemId, delta });
    }
    pendingReasoningContentDeltasRef.current.clear();

    for (const entry of pendingPlanDeltasRef.current.values()) {
      const delta = entry.parts.join("");
      if (!delta) {
        continue;
      }
      dispatch({ type: "appendPlanDelta", threadId: entry.threadId, itemId: entry.itemId, delta });
    }
    pendingPlanDeltasRef.current.clear();

    let didToolOutput = false;
    for (const entry of pendingToolOutputDeltasRef.current.values()) {
      const delta = entry.parts.join("");
      if (!delta) {
        continue;
      }
      didToolOutput = true;
      markProcessing(entry.threadId, true);
      dispatch({ type: "appendToolOutput", threadId: entry.threadId, itemId: entry.itemId, delta });
    }
    pendingToolOutputDeltasRef.current.clear();
    if (didToolOutput) {
      safeMessageActivity();
    }
  }, [cancelScheduledFlush, dispatch, getCustomName, markProcessing, safeMessageActivity]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      return;
    }
    const delayMs = Math.max(0, nextFlushAtRef.current - Date.now());
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingDeltas();
    }, delayMs);
  }, [flushPendingDeltas]);

  const enqueueOrFlush = useCallback(() => {
    if (Date.now() >= nextFlushAtRef.current) {
      flushPendingDeltas();
      return;
    }
    scheduleFlush();
  }, [flushPendingDeltas, scheduleFlush]);

  useEffect(() => {
    return () => {
      cancelScheduledFlush();
      pendingAgentDeltasRef.current.clear();
      pendingToolOutputDeltasRef.current.clear();
      pendingReasoningSummaryDeltasRef.current.clear();
      pendingReasoningContentDeltasRef.current.clear();
      pendingPlanDeltasRef.current.clear();
    };
  }, [cancelScheduledFlush]);

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
    ) => {
      flushPendingDeltas();
      dispatch({ type: "ensureThread", workspaceId, threadId });
      if (shouldMarkProcessing) {
        markProcessing(threadId, true);
      }
      applyCollabThreadLinks(workspaceId, threadId, item);
      const itemType = asString(item?.type ?? "");
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
        if (!shouldMarkProcessing) {
          onReviewExited?.(workspaceId, threadId);
        }
      }
      const itemForDisplay =
        itemType === "contextCompaction" || itemType === "webSearch"
          ? ({
              ...item,
              status: shouldMarkProcessing ? "inProgress" : "completed",
            } as Record<string, unknown>)
          : item;
      const converted = buildConversationItem(itemForDisplay);
      if (converted) {
        if (converted.kind === "message" && converted.role === "user") {
          void onUserMessageCreated?.(workspaceId, threadId, converted.text);
        }
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: converted,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
      }
      safeMessageActivity();
    },
    [
      applyCollabThreadLinks,
      dispatch,
      flushPendingDeltas,
      getCustomName,
      markProcessing,
      markReviewing,
      onReviewExited,
      onUserMessageCreated,
      safeMessageActivity,
    ],
  );

  const handleToolOutputDelta = useCallback(
    (threadId: string, itemId: string, delta: string) => {
      if (!delta) {
        return;
      }
      const key = `${threadId}:${itemId}`;
      const entry = pendingToolOutputDeltasRef.current.get(key);
      if (entry) {
        entry.parts.push(delta);
      } else {
        pendingToolOutputDeltasRef.current.set(key, { threadId, itemId, parts: [delta] });
      }
      enqueueOrFlush();
    },
    [enqueueOrFlush],
  );

  const handleTerminalInteraction = useCallback(
    (threadId: string, itemId: string, stdin: string) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(threadId, itemId, `\n[stdin]\n${normalized}${suffix}`);
    },
    [handleToolOutputDelta],
  );

  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      delta,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
    }) => {
      if (!delta) {
        return;
      }
      const key = `${workspaceId}:${threadId}:${itemId}`;
      const entry = pendingAgentDeltasRef.current.get(key);
      if (entry) {
        entry.parts.push(delta);
      } else {
        pendingAgentDeltasRef.current.set(key, { workspaceId, threadId, itemId, parts: [delta] });
      }
      enqueueOrFlush();
    },
    [enqueueOrFlush],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      text,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
    }) => {
      flushPendingDeltas();
      const timestamp = Date.now();
      dispatch({ type: "ensureThread", workspaceId, threadId });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      dispatch({
        type: "completeAgentMessage",
        workspaceId,
        threadId,
        itemId,
        text,
        hasCustomName,
      });
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp,
      });
      dispatch({
        type: "setLastAgentMessage",
        threadId,
        text,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [
      activeThreadId,
      dispatch,
      flushPendingDeltas,
      getCustomName,
      recordThreadActivity,
      safeMessageActivity,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, false);
    },
    [handleItemUpdate],
  );

  const onReasoningSummaryDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      if (!delta) {
        return;
      }
      const key = `${threadId}:${itemId}`;
      const entry = pendingReasoningSummaryDeltasRef.current.get(key);
      if (entry) {
        entry.parts.push(delta);
      } else {
        pendingReasoningSummaryDeltasRef.current.set(key, { threadId, itemId, parts: [delta] });
      }
      enqueueOrFlush();
    },
    [enqueueOrFlush],
  );

  const onReasoningSummaryBoundary = useCallback(
    (_workspaceId: string, threadId: string, itemId: string) => {
      flushPendingDeltas();
      dispatch({ type: "appendReasoningSummaryBoundary", threadId, itemId });
    },
    [dispatch, flushPendingDeltas],
  );

  const onReasoningTextDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      if (!delta) {
        return;
      }
      const key = `${threadId}:${itemId}`;
      const entry = pendingReasoningContentDeltasRef.current.get(key);
      if (entry) {
        entry.parts.push(delta);
      } else {
        pendingReasoningContentDeltasRef.current.set(key, { threadId, itemId, parts: [delta] });
      }
      enqueueOrFlush();
    },
    [enqueueOrFlush],
  );

  const onPlanDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      if (!delta) {
        return;
      }
      const key = `${threadId}:${itemId}`;
      const entry = pendingPlanDeltasRef.current.get(key);
      if (entry) {
        entry.parts.push(delta);
      } else {
        pendingPlanDeltasRef.current.set(key, { threadId, itemId, parts: [delta] });
      }
      enqueueOrFlush();
    },
    [enqueueOrFlush],
  );

  const onCommandOutputDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  const onTerminalInteraction = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, stdin: string) => {
      handleTerminalInteraction(threadId, itemId, stdin);
    },
    [handleTerminalInteraction],
  );

  const onFileChangeOutputDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemCompleted,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onPlanDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
  };
}
