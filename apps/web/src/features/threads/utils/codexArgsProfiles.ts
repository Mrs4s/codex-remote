import {
  getIgnoredCodexArgsFlagsMetadata,
  normalizeCodexArgsInput,
  parseCodexArgsProfile,
  sanitizeRuntimeCodexArgs,
  type CodexArgsIgnoredFlag,
  type CodexArgsIgnoredFlagsMetadata,
  type CodexArgsRecognizedSegment,
  type ParsedCodexArgsProfile,
} from "@codex-remote/shared-types";

export type {
  CodexArgsIgnoredFlag,
  CodexArgsIgnoredFlagsMetadata,
  CodexArgsRecognizedSegment,
  ParsedCodexArgsProfile,
};

export type CodexArgsOption = {
  value: string; // empty string means default
  codexArgs: string | null;
  label: string;
  effectiveCodexArgs?: string | null;
  recognizedSegments?: CodexArgsRecognizedSegment[];
  ignoredFlags?: CodexArgsIgnoredFlag[];
  hasIgnoredFlags?: boolean;
};

const FALLBACK_LABEL_MAX = 22;

function normalizeCodexArgs(value: string | null | undefined): string | null {
  return normalizeCodexArgsInput(value);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function getTrailingPath(path: string, segments: number): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) {
    return path;
  }
  return parts.slice(-segments).join("/");
}

function formatLabelValue(value: string): string {
  const normalized = stripWrappingQuotes(value).trim();
  if (!normalized) {
    return normalized;
  }

  if (normalized.includes("://")) {
    if (normalized.length <= FALLBACK_LABEL_MAX) {
      return normalized;
    }
    return `${normalized.slice(0, FALLBACK_LABEL_MAX - 3)}…`;
  }

  if (normalized.includes("/") || normalized.includes("\\")) {
    return getTrailingPath(normalized, 2);
  }

  if (normalized.length <= FALLBACK_LABEL_MAX) {
    return normalized;
  }
  return `${normalized.slice(0, FALLBACK_LABEL_MAX - 3)}…`;
}

function fallbackLabel(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length <= FALLBACK_LABEL_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, FALLBACK_LABEL_MAX - 3)}…`;
}

function fallbackLabelFromParsed(parsed: ParsedCodexArgsProfile): string {
  return fallbackLabel(parsed.effectiveArgs ?? parsed.originalArgs);
}

function buildOptionLabelFromParsed(parsed: ParsedCodexArgsProfile): string {
  if (parsed.recognizedSegments.length > 0) {
    const firstTwo = parsed.recognizedSegments
      .slice(0, 2)
      .map((segment) => {
        const [rawLabel, ...rest] = segment.label.split(":");
        const value = rest.join(":");
        if (!value) {
          return rawLabel;
        }
        return `${rawLabel}:${formatLabelValue(value)}`;
      });
    const extraCount = parsed.recognizedSegments.length - firstTwo.length;
    return `${firstTwo.join(" • ")}${extraCount > 0 ? ` +${extraCount}` : ""}`;
  }

  return fallbackLabelFromParsed(parsed);
}

export { getIgnoredCodexArgsFlagsMetadata, parseCodexArgsProfile, sanitizeRuntimeCodexArgs };

export function buildCodexArgsOptionLabel(args: string): string {
  return buildOptionLabelFromParsed(parseCodexArgsProfile(args));
}

export function buildCodexArgsBadgeLabel(args: string): string {
  const parsed = parseCodexArgsProfile(args);
  const firstRecognized = parsed.recognizedSegments[0];
  if (firstRecognized) {
    const [rawLabel, ...rest] = firstRecognized.label.split(":");
    const value = rest.join(":");
    return value ? `${rawLabel}:${formatLabelValue(value)}` : rawLabel;
  }

  return fallbackLabelFromParsed(parsed);
}

export function labelForCodexArgs(args: string): string {
  return buildCodexArgsBadgeLabel(args);
}

export function buildEffectiveCodexArgsBadgeLabel(
  args: string | null | undefined,
): string | null {
  const sanitizedArgs = sanitizeRuntimeCodexArgs(args);
  if (!sanitizedArgs) {
    return null;
  }
  const label = buildCodexArgsBadgeLabel(sanitizedArgs).trim();
  return label.length > 0 ? label : null;
}

export function buildCodexArgsOptions(input: {
  appCodexArgs: string | null;
  additionalCodexArgs?: Array<string | null | undefined>;
}): CodexArgsOption[] {
  const seen = new Set<string>();
  const options: CodexArgsOption[] = [{ value: "", codexArgs: null, label: "Default" }];

  const candidates = [
    normalizeCodexArgs(input.appCodexArgs),
    ...(input.additionalCodexArgs ?? []).map(normalizeCodexArgs),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const args of candidates) {
    if (seen.has(args)) {
      continue;
    }

    seen.add(args);
    const parsed = parseCodexArgsProfile(args);

    options.push({
      value: args,
      codexArgs: args,
      label: buildOptionLabelFromParsed(parsed),
      effectiveCodexArgs: parsed.effectiveArgs,
      recognizedSegments: parsed.recognizedSegments,
      ignoredFlags: parsed.ignoredFlags,
      hasIgnoredFlags: parsed.ignoredFlags.length > 0,
    });
  }

  const [defaultOption, ...rest] = options;
  rest.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return [defaultOption, ...rest];
}
