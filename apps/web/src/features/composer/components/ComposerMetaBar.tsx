import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BrainCog, SlidersHorizontal } from "lucide-react";
import type { AccessMode, ServiceTier, ThreadTokenUsage } from "../../../types";
import { modelSupportsServiceTier } from "../../../utils/serviceTier";
import {
  litellmPricingLookup,
  type LiteLLMPricingLookup,
} from "../../../services/tauri";
import type { CodexArgsOption } from "../../threads/utils/codexArgsProfiles";

type ComposerMetaBarProps = {
  disabled: boolean;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  models: { id: string; displayName: string; model: string }[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  selectedServiceTier: ServiceTier | null;
  onSelectServiceTier: (serviceTier: ServiceTier | null) => void;
  reasoningSupported: boolean;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  codexArgsOptions?: CodexArgsOption[];
  selectedCodexArgsOverride?: string | null;
  onSelectCodexArgsOverride?: (value: string | null) => void;
  contextUsage?: ThreadTokenUsage | null;
};

function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0";
  }
  if (value < 0.000001) {
    return "<$0.000001";
  }
  if (value < 0.01) {
    return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  if (value < 1) {
    return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0";
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `$${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  if (value >= 1) {
    return `$${value >= 10 ? value.toFixed(1) : value.toFixed(2)}`.replace(
      /\.0$/,
      "",
    );
  }
  if (value >= 0.01) {
    return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return formatUsd(value);
}

type SessionCostBreakdown = {
  totalCostUsd: number;
  inputCostUsd: number;
  cachedCostUsd: number;
  outputCostUsd: number;
  nonCachedInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

function clampTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function calculateSessionCost(
  usage: ThreadTokenUsage["total"] | null,
  pricing: LiteLLMPricingLookup | null,
): SessionCostBreakdown | null {
  if (!usage || !pricing || !pricing.pricingFound) {
    return null;
  }

  const inputTokens = clampTokens(usage.inputTokens);
  const cachedInputTokens = Math.min(clampTokens(usage.cachedInputTokens), inputTokens);
  const nonCachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  const outputTokens = clampTokens(usage.outputTokens);

  const inputCostUsd = nonCachedInputTokens * pricing.inputCostPerToken;
  const cachedCostUsd = cachedInputTokens * pricing.cachedInputCostPerToken;
  const outputCostUsd = outputTokens * pricing.outputCostPerToken;
  const totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd;

  return {
    totalCostUsd,
    inputCostUsd,
    cachedCostUsd,
    outputCostUsd,
    nonCachedInputTokens,
    cachedInputTokens,
    outputTokens,
  };
}

export function ComposerMetaBar({
  disabled,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  models,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  selectedServiceTier,
  onSelectServiceTier,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  codexArgsOptions = [],
  selectedCodexArgsOverride = null,
  onSelectCodexArgsOverride,
  contextUsage = null,
}: ComposerMetaBarProps) {
  const [sessionPricing, setSessionPricing] = useState<LiteLLMPricingLookup | null>(
    null,
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );
  const selectedModelName = selectedModel?.model ?? null;
  const serviceTierSupported = useMemo(
    () => modelSupportsServiceTier(selectedModelName),
    [selectedModelName],
  );

  useEffect(() => {
    let canceled = false;
    if (!selectedModelName) {
      setSessionPricing(null);
      return () => {
        canceled = true;
      };
    }

    litellmPricingLookup(selectedModelName)
      .then((pricing) => {
        if (!canceled) {
          setSessionPricing(pricing);
        }
      })
      .catch(() => {
        if (!canceled) {
          setSessionPricing(null);
        }
      });

    return () => {
      canceled = true;
    };
  }, [selectedModelName]);

  const contextWindow = contextUsage?.modelContextWindow ?? null;
  const lastTokens = contextUsage?.last.totalTokens ?? 0;
  const totalTokens = contextUsage?.total.totalTokens ?? 0;
  const usedTokens = lastTokens > 0 ? lastTokens : totalTokens;
  const sessionCostBreakdown = useMemo(
    () => calculateSessionCost(contextUsage?.total ?? null, sessionPricing),
    [contextUsage, sessionPricing],
  );
  const sessionCostText =
    sessionCostBreakdown !== null
      ? formatCompactUsd(sessionCostBreakdown.totalCostUsd)
      : null;
  const sessionUsageText = contextUsage
    ? sessionCostText
      ? `${formatCompactTokens(totalTokens)} · ${sessionCostText}`
      : formatCompactTokens(totalTokens)
    : "--";
  const sessionUsageTooltip = contextUsage
    ? [
        "Session token usage",
        `Total: ${formatTokenCount(contextUsage.total.totalTokens)}`,
        `Input: ${formatTokenCount(contextUsage.total.inputTokens)}`,
        `Cached input: ${formatTokenCount(contextUsage.total.cachedInputTokens)}`,
        `Output: ${formatTokenCount(contextUsage.total.outputTokens)}`,
        `Reasoning output: ${formatTokenCount(contextUsage.total.reasoningOutputTokens)}`,
        ...(sessionCostBreakdown
          ? [
              `Estimated cost: ${formatUsd(sessionCostBreakdown.totalCostUsd)}`,
              `Model: ${sessionPricing?.matchedModel ?? selectedModelName ?? "unknown"}`,
              `Input cost: ${formatUsd(sessionCostBreakdown.inputCostUsd)}`,
              `Cached input cost: ${formatUsd(sessionCostBreakdown.cachedCostUsd)}`,
              `Output cost: ${formatUsd(sessionCostBreakdown.outputCostUsd)}`,
              "Pricing uses current model rates (multi-model sessions may differ).",
            ]
          : selectedModelName && sessionPricing?.pricingFound === false
            ? [`Estimated cost: unavailable for ${selectedModelName}`]
            : []),
      ].join("\n")
    : "Session token usage\nNo usage data yet";
  const contextFreePercent =
    contextWindow && contextWindow > 0 && usedTokens > 0
      ? Math.max(
          0,
          100 -
            Math.min(Math.max((usedTokens / contextWindow) * 100, 0), 100),
        )
      : null;
  const planMode =
    collaborationModes.find((mode) => mode.id === "plan") ?? null;
  const defaultMode =
    collaborationModes.find((mode) => mode.id === "default") ?? null;
  const canUsePlanToggle =
    Boolean(planMode) &&
    collaborationModes.every(
      (mode) => mode.id === "default" || mode.id === "plan",
    );
  const planSelected = selectedCollaborationModeId === (planMode?.id ?? "");

  return (
    <div className="composer-bar">
      <div className="composer-meta">
        {collaborationModes.length > 0 && (
          canUsePlanToggle ? (
            <div className="composer-select-wrap composer-plan-toggle-wrap">
              <label className="composer-plan-toggle" aria-label="Plan mode">
                <input
                  className="composer-plan-toggle-input"
                  type="checkbox"
                  checked={planSelected}
                  disabled={disabled}
                  onChange={(event) =>
                    onSelectCollaborationMode(
                      event.target.checked
                        ? planMode?.id ?? "plan"
                        : (defaultMode?.id ?? null),
                    )
                  }
                />
                <span className="composer-plan-toggle-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="composer-plan-toggle-label">
                  {planMode?.label || "Plan"}
                </span>
              </label>
            </div>
          ) : (
            <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
              <select
                className="composer-select composer-select--model composer-select--collab"
                aria-label="Collaboration mode"
                value={selectedCollaborationModeId ?? ""}
                onChange={(event) =>
                  onSelectCollaborationMode(event.target.value || null)
                }
                disabled={disabled}
              >
                {collaborationModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label || mode.id}
                  </option>
                ))}
              </select>
            </div>
          )
        )}
        <div className="composer-select-wrap composer-select-wrap--model">
          <span className="composer-icon composer-icon--model" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4v2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M8 7.5h8a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 15v-5A2.5 2.5 0 0 1 8 7.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="9.5" cy="12.5" r="1" fill="currentColor" />
              <circle cx="14.5" cy="12.5" r="1" fill="currentColor" />
              <path
                d="M9.5 15.5h5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M5.5 11H4M20 11h-1.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--model"
            aria-label="Model"
            value={selectedModelId ?? ""}
            onChange={(event) => onSelectModel(event.target.value)}
            disabled={disabled}
          >
            {models.length === 0 && <option value="">No models</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName || model.model}
              </option>
            ))}
          </select>
        </div>
        <div className="composer-select-wrap composer-select-wrap--effort">
          <span className="composer-icon composer-icon--effort" aria-hidden>
            <BrainCog size={14} strokeWidth={1.8} />
          </span>
          <select
            className="composer-select composer-select--effort"
            aria-label="Thinking mode"
            value={selectedEffort ?? ""}
            onChange={(event) => onSelectEffort(event.target.value)}
            disabled={disabled || !reasoningSupported}
          >
            {reasoningOptions.length === 0 && <option value="">Default</option>}
            {reasoningOptions.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </div>
        {serviceTierSupported && (
          <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 8.5h12M6 12h12M6 15.5h8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <select
              className="composer-select composer-select--effort"
              aria-label="Service tier"
              value={selectedServiceTier ?? ""}
              onChange={(event) =>
                onSelectServiceTier((event.target.value || null) as ServiceTier | null)
              }
              disabled={disabled}
            >
              <option value="">Default</option>
              <option value="fast">Fast</option>
              <option value="flex">Flex</option>
            </select>
          </div>
        )}
        {codexArgsOptions.length > 1 && onSelectCodexArgsOverride && (
          <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <SlidersHorizontal size={14} strokeWidth={1.8} />
            </span>
            <select
              className="composer-select composer-select--approval"
              aria-label="Codex args profile"
              disabled={disabled}
              value={selectedCodexArgsOverride ?? ""}
              onChange={(event) =>
                onSelectCodexArgsOverride(event.target.value || null)
              }
            >
              {codexArgsOptions.map((option) => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="composer-select-wrap">
          <span className="composer-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4l7 3v5c0 4.5-3 7.5-7 8-4-0.5-7-3.5-7-8V7l7-3z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 12.5l1.8 1.8 3.7-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--approval"
            aria-label="Agent access"
            disabled={disabled}
            value={accessMode}
            onChange={(event) =>
              onSelectAccessMode(event.target.value as AccessMode)
            }
          >
            <option value="read-only">Read only</option>
            <option value="current">On-Request</option>
            <option value="full-access">Full access</option>
          </select>
        </div>
      </div>
      <div className="composer-context">
        <div
          className="composer-session-usage"
          data-tooltip={sessionUsageTooltip}
          aria-label={sessionUsageTooltip}
        >
          <span className="composer-session-usage-label">Session</span>
          <span className="composer-session-usage-value">
            {sessionUsageText}
          </span>
        </div>
        <div
          className="composer-context-ring"
          data-tooltip={
            contextFreePercent === null
              ? "Context free --"
              : `Context free ${Math.round(contextFreePercent)}%`
          }
          aria-label={
            contextFreePercent === null
              ? "Context free --"
              : `Context free ${Math.round(contextFreePercent)}%`
          }
          style={
            {
              "--context-free": contextFreePercent ?? 0,
            } as CSSProperties
          }
        >
          <span className="composer-context-value">●</span>
        </div>
      </div>
    </div>
  );
}
