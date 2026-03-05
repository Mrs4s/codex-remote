import { useCallback, useEffect, useMemo, useState } from "react";
import X from "lucide-react/dist/esm/icons/x";
import type { LocalUsageCostDay, LocalUsageCostSnapshot } from "../../../types";
import { localUsageCostSnapshot } from "../../../services/tauri";
import { formatRelativeTimeShort } from "../../../utils/time";
import { ModalShell } from "../../design-system/components/modal/ModalShell";
import type { LocalUsageCountingMode } from "../../../types";

type SidebarFooterProps = {
  sessionPercent: number | null;
  weeklyPercent: number | null;
  sessionResetLabel: string | null;
  weeklyResetLabel: string | null;
  creditsLabel: string | null;
  showWeekly: boolean;
};

type UsageHistoryMode = "day" | "week" | "month";

type UsageHistoryRow = {
  key: string;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
};

const HISTORY_DAYS = 365;

type UsageHistoryCountingMode = LocalUsageCountingMode;

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  return Math.round(value).toLocaleString();
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0";
  }
  if (value < 0.01) {
    return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  if (value < 1) {
    return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function parseDayKey(dayKey: string): Date {
  const [yearRaw, monthRaw, dayRaw] = dayKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return new Date(year, month - 1, day);
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStartKey(dayKey: string): string {
  const dayDate = parseDayKey(dayKey);
  const dayOfWeek = dayDate.getDay();
  const distance = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  dayDate.setDate(dayDate.getDate() - distance);
  return formatDayKey(dayDate);
}

function getMonthKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

function buildHistoryRows(
  rows: LocalUsageCostDay[],
  mode: UsageHistoryMode,
): UsageHistoryRow[] {
  const buckets = new Map<
    string,
    {
      startDay: string;
      endDay: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      totalCostUsd: number;
    }
  >();

  for (const row of rows) {
    const key =
      mode === "day"
        ? row.day
        : mode === "week"
          ? getWeekStartKey(row.day)
          : getMonthKey(row.day);
    const current = buckets.get(key) ?? {
      startDay: row.day,
      endDay: row.day,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    };

    current.endDay = row.day;
    current.inputTokens += row.inputTokens;
    current.cachedInputTokens += row.cachedInputTokens;
    current.outputTokens += row.outputTokens;
    current.totalTokens += row.totalTokens;
    current.totalCostUsd += row.totalCostUsd;
    buckets.set(key, current);
  }

  return [...buckets.entries()]
    .map(([key, value]) => {
      const label =
        mode === "day"
          ? value.startDay
          : mode === "week"
            ? `${value.startDay} to ${value.endDay}`
            : key;
      return {
        key,
        label,
        inputTokens: value.inputTokens,
        cachedInputTokens: value.cachedInputTokens,
        outputTokens: value.outputTokens,
        totalTokens: value.totalTokens,
        totalCostUsd: value.totalCostUsd,
      };
    })
    .filter((row) => row.totalTokens > 0 || row.totalCostUsd > 0)
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function SidebarFooter({
  sessionPercent,
  weeklyPercent,
  sessionResetLabel,
  weeklyResetLabel,
  creditsLabel,
  showWeekly,
}: SidebarFooterProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState<UsageHistoryMode>("day");
  const [historyCountingMode, setHistoryCountingMode] =
    useState<UsageHistoryCountingMode>("ccusage");
  const [historySnapshot, setHistorySnapshot] = useState<LocalUsageCostSnapshot | null>(
    null,
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async (countingMode: UsageHistoryCountingMode) => {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistorySnapshot(null);
    try {
      const snapshot = await localUsageCostSnapshot(HISTORY_DAYS, undefined, countingMode);
      setHistorySnapshot(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isHistoryOpen || historySnapshot || historyLoading) {
      return;
    }
    loadHistory(historyCountingMode).catch(() => undefined);
  }, [historyLoading, historySnapshot, historyCountingMode, isHistoryOpen, loadHistory]);

  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHistoryOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isHistoryOpen]);

  const groupedRows = useMemo(
    () => buildHistoryRows(historySnapshot?.days ?? [], historyMode),
    [historyMode, historySnapshot?.days],
  );

  const historyCountingLabel =
    historyCountingMode === "ccusage" ? "ccusage-compatible" : "deduplicated";

  return (
    <div className="sidebar-footer">
      <div className="usage-bars">
        <div className="usage-block">
          <div className="usage-label">
            <span className="usage-title">
              <span>Session</span>
              {sessionResetLabel && (
                <span className="usage-reset">· {sessionResetLabel}</span>
              )}
            </span>
            <span className="usage-value">
              {sessionPercent === null ? "--" : `${sessionPercent}%`}
            </span>
          </div>
          <div className="usage-bar">
            <span
              className="usage-bar-fill"
              style={{ width: `${sessionPercent ?? 0}%` }}
            />
          </div>
        </div>
        {showWeekly && (
          <div className="usage-block">
            <div className="usage-label">
              <span className="usage-title">
                <span>Weekly</span>
                {weeklyResetLabel && (
                  <span className="usage-reset">· {weeklyResetLabel}</span>
                )}
              </span>
              <span className="usage-value">
                {weeklyPercent === null ? "--" : `${weeklyPercent}%`}
              </span>
            </div>
            <div className="usage-bar">
              <span
                className="usage-bar-fill"
                style={{ width: `${weeklyPercent ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {creditsLabel && <div className="usage-meta">{creditsLabel}</div>}
      <button
        type="button"
        className="ghost usage-history-button"
        onClick={() => setIsHistoryOpen(true)}
      >
        Global usage history
      </button>
      {isHistoryOpen && (
        <ModalShell
          className="usage-history-modal"
          cardClassName="usage-history-modal-card"
          onBackdropClick={() => setIsHistoryOpen(false)}
          ariaLabel="Global usage history"
        >
          <div className="usage-history-header">
            <div className="usage-history-title">Global usage history</div>
            <button
              type="button"
              className="ghost usage-history-close"
              onClick={() => setIsHistoryOpen(false)}
              aria-label="Close usage history"
            >
              <X size={14} />
            </button>
          </div>
          <div className="usage-history-subtitle">
            {historySnapshot
              ? `Updated ${formatRelativeTimeShort(historySnapshot.updatedAt)} · ${historyCountingLabel}`
              : `Usage from local Codex sessions · ${historyCountingLabel}`}
          </div>
          <div className="usage-history-controls">
            <div className="usage-history-control-group">
              <div className="usage-history-toggle" role="group" aria-label="Usage period">
                <button
                  type="button"
                  className={
                    historyMode === "day"
                      ? "usage-history-toggle-button is-active"
                      : "usage-history-toggle-button"
                  }
                  onClick={() => setHistoryMode("day")}
                  aria-pressed={historyMode === "day"}
                >
                  Day
                </button>
                <button
                  type="button"
                  className={
                    historyMode === "week"
                      ? "usage-history-toggle-button is-active"
                      : "usage-history-toggle-button"
                  }
                  onClick={() => setHistoryMode("week")}
                  aria-pressed={historyMode === "week"}
                >
                  Week
                </button>
                <button
                  type="button"
                  className={
                    historyMode === "month"
                      ? "usage-history-toggle-button is-active"
                      : "usage-history-toggle-button"
                  }
                  onClick={() => setHistoryMode("month")}
                  aria-pressed={historyMode === "month"}
                >
                  Month
                </button>
              </div>
              <div
                className="usage-history-toggle"
                role="group"
                aria-label="Token counting mode"
              >
                <button
                  type="button"
                  className={
                    historyCountingMode === "deduped"
                      ? "usage-history-toggle-button is-active"
                      : "usage-history-toggle-button"
                  }
                  onClick={() => {
                    const mode: UsageHistoryCountingMode = "deduped";
                    setHistoryCountingMode(mode);
                    loadHistory(mode).catch(() => undefined);
                  }}
                  aria-pressed={historyCountingMode === "deduped"}
                >
                  Deduped
                </button>
                <button
                  type="button"
                  className={
                    historyCountingMode === "ccusage"
                      ? "usage-history-toggle-button is-active"
                      : "usage-history-toggle-button"
                  }
                  onClick={() => {
                    const mode: UsageHistoryCountingMode = "ccusage";
                    setHistoryCountingMode(mode);
                    loadHistory(mode).catch(() => undefined);
                  }}
                  aria-pressed={historyCountingMode === "ccusage"}
                >
                  ccusage
                </button>
              </div>
            </div>
            <button
              type="button"
              className="ghost usage-history-refresh"
              disabled={historyLoading}
              onClick={() => {
                loadHistory(historyCountingMode).catch(() => undefined);
              }}
            >
              {historyLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {historyError ? (
            <div className="usage-history-error">{historyError}</div>
          ) : (
            <div className="usage-history-table-wrap">
              <table className="usage-history-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Total</th>
                    <th>Input</th>
                    <th>Cache Read</th>
                    <th>Output</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="usage-history-empty">
                        No usage data yet.
                      </td>
                    </tr>
                  ) : (
                    groupedRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{formatCount(row.totalTokens)}</td>
                        <td>{formatCount(Math.max(row.inputTokens - row.cachedInputTokens, 0))}</td>
                        <td>{formatCount(row.cachedInputTokens)}</td>
                        <td>{formatCount(row.outputTokens)}</td>
                        <td>{formatUsd(row.totalCostUsd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {historySnapshot && historySnapshot.missingPricingModels.length > 0 && (
            <div className="usage-history-note">
              {`Some models have no pricing data (${historySnapshot.missingPricingModels.length}), so displayed cost is a lower-bound estimate.`}
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}
