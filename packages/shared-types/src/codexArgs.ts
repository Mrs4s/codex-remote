const SMART_DOUBLE_QUOTES_PATTERN = /[\u201C\u201D\u201E\u201F]/g;
const SMART_SINGLE_QUOTES_PATTERN = /[\u2018\u2019\u201A\u201B]/g;
const DASH_LIKE_PATTERN = /[\u2010-\u2015\u2212]/g;
const DASH_LIKE_TOKEN_PREFIX_PATTERN = /(^|\s)[\u2010-\u2015\u2212]([^\s]+)/g;
const NBSP_PATTERN = /[\u00A0\u2007\u202F]/g;

export type CodexArgsRecognizedSegment = {
  flag: string;
  canonicalFlag: string;
  value: string | null;
  label: string;
};

export type CodexArgsIgnoredFlag = {
  flag: string;
  canonicalFlag: string;
  value: string | null;
};

export type ParsedCodexArgsProfile = {
  originalArgs: string;
  recognizedSegments: CodexArgsRecognizedSegment[];
  ignoredFlags: CodexArgsIgnoredFlag[];
  effectiveArgs: string | null;
};

export type CodexArgsIgnoredFlagsMetadata = {
  hasIgnoredFlags: boolean;
  ignoredFlags: CodexArgsIgnoredFlag[];
  ignoredCanonicalFlags: string[];
};

type FlagCategory = "recognized" | "ignored";
type ValueMode = "none" | "required" | "optional";

type FlagSpec = {
  canonicalFlag: string;
  category: FlagCategory;
  valueMode: ValueMode;
};

const FLAG_SPECS: Record<string, FlagSpec> = {};

function registerFlags(
  aliases: string[],
  spec: { canonicalFlag: string; category: FlagCategory; valueMode: ValueMode },
): void {
  for (const alias of aliases) {
    FLAG_SPECS[alias] = spec;
  }
}

registerFlags(["-c", "--config"], {
  canonicalFlag: "--config",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["--enable"], {
  canonicalFlag: "--enable",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["--disable"], {
  canonicalFlag: "--disable",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["--auth-file"], {
  canonicalFlag: "--auth-file",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["-i", "--image"], {
  canonicalFlag: "--image",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["-p", "--profile"], {
  canonicalFlag: "--profile",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["-C", "--cd"], {
  canonicalFlag: "--cd",
  category: "recognized",
  valueMode: "required",
});
registerFlags(["--search"], {
  canonicalFlag: "--search",
  category: "recognized",
  valueMode: "optional",
});
registerFlags(["--add-dir"], {
  canonicalFlag: "--add-dir",
  category: "recognized",
  valueMode: "required",
});

registerFlags(["-m", "--model"], {
  canonicalFlag: "--model",
  category: "ignored",
  valueMode: "required",
});
registerFlags(["-a", "--ask-for-approval"], {
  canonicalFlag: "--ask-for-approval",
  category: "ignored",
  valueMode: "required",
});
registerFlags(["-s", "--sandbox"], {
  canonicalFlag: "--sandbox",
  category: "ignored",
  valueMode: "required",
});
registerFlags(["--full-auto"], {
  canonicalFlag: "--full-auto",
  category: "ignored",
  valueMode: "none",
});
registerFlags(["--dangerously-bypass-approvals-and-sandbox"], {
  canonicalFlag: "--dangerously-bypass-approvals-and-sandbox",
  category: "ignored",
  valueMode: "none",
});
registerFlags(["--oss"], {
  canonicalFlag: "--oss",
  category: "ignored",
  valueMode: "none",
});
registerFlags(["--local-provider"], {
  canonicalFlag: "--local-provider",
  category: "ignored",
  valueMode: "required",
});
registerFlags(["--no-alt-screen"], {
  canonicalFlag: "--no-alt-screen",
  category: "ignored",
  valueMode: "none",
});

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token.length > 1;
}

function splitFlagToken(token: string): { flag: string; inlineValue: string | null } {
  if (!token.startsWith("-")) {
    return { flag: token, inlineValue: null };
  }

  const equalsIndex = token.indexOf("=");
  if (equalsIndex <= 1) {
    return { flag: token, inlineValue: null };
  }

  return {
    flag: token.slice(0, equalsIndex),
    inlineValue: token.slice(equalsIndex + 1),
  };
}

function quoteTokenIfNeeded(token: string): string {
  if (token.length === 0) {
    return "\"\"";
  }

  if (/^[A-Za-z0-9_./:@%+,=~-]+$/.test(token)) {
    return token;
  }

  const escaped = token.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `"${escaped}"`;
}

function readFlagValue(
  spec: FlagSpec,
  inlineValue: string | null,
  nextToken: string | undefined,
): { value: string | null; consumeNext: boolean; isValid: boolean } {
  if (spec.valueMode === "none") {
    return { value: null, consumeNext: false, isValid: true };
  }

  if (inlineValue != null) {
    const normalized = inlineValue.trim();
    const hasValue = normalized.length > 0;
    if (!hasValue && spec.valueMode === "required") {
      return { value: null, consumeNext: false, isValid: false };
    }
    return {
      value: hasValue ? normalized : null,
      consumeNext: false,
      isValid: spec.valueMode === "optional" || hasValue,
    };
  }

  if (
    typeof nextToken === "string" &&
    nextToken.trim().length > 0 &&
    !nextToken.trim().startsWith("-")
  ) {
    return { value: nextToken.trim(), consumeNext: true, isValid: true };
  }

  if (spec.valueMode === "optional") {
    return { value: null, consumeNext: false, isValid: true };
  }

  return { value: null, consumeNext: false, isValid: false };
}

function canonicalFlagLabel(canonicalFlag: string): string {
  return canonicalFlag.replace(/^--/, "");
}

function makeRecognizedLabel(canonicalFlag: string, value: string | null): string {
  const label = canonicalFlagLabel(canonicalFlag);
  if (!value) {
    return label;
  }
  return `${label}:${stripWrappingQuotes(value).trim()}`;
}

export function normalizeCodexArgsInput(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) {
    return null;
  }

  let normalized = raw
    .replace(NBSP_PATTERN, " ")
    .replace(SMART_DOUBLE_QUOTES_PATTERN, "\"")
    .replace(SMART_SINGLE_QUOTES_PATTERN, "'")
    .trim();

  normalized = stripWrappingQuotes(normalized).trim();

  normalized = normalized.replace(
    DASH_LIKE_TOKEN_PREFIX_PATTERN,
    (_match, prefix: string, token: string) => {
      const equalsIndex = token.indexOf("=");
      const flagToken = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
      const suffix = equalsIndex >= 0 ? token.slice(equalsIndex) : "";

      if (/^[A-Za-z][A-Za-z0-9-]*$/.test(flagToken)) {
        return `${prefix}${flagToken.length === 1 ? "-" : "--"}${flagToken}${suffix}`;
      }
      return `${prefix}-${token}`;
    },
  );

  normalized = normalized.replace(DASH_LIKE_PATTERN, "-").trim();

  return normalized.length > 0 ? normalized : null;
}

export function tokenizeCodexArgs(rawArgs: string | null | undefined): string[] {
  const source = rawArgs ?? "";
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";

    if (quote) {
      if (char === "\\") {
        const nextChar = source[index + 1] ?? "";
        if (nextChar === quote || nextChar === "\\") {
          current += nextChar;
          index += 1;
          continue;
        }
        current += char;
        continue;
      }
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function joinCodexArgTokens(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }

  const joined = tokens.map((token) => quoteTokenIfNeeded(token)).join(" ").trim();
  return joined.length > 0 ? joined : null;
}

export function parseCodexArgsProfile(args: string | null | undefined): ParsedCodexArgsProfile {
  const originalArgs = normalizeCodexArgsInput(args) ?? "";
  if (!originalArgs) {
    return {
      originalArgs: "",
      recognizedSegments: [],
      ignoredFlags: [],
      effectiveArgs: null,
    };
  }

  const tokens = tokenizeCodexArgs(originalArgs);
  const recognizedSegments: CodexArgsRecognizedSegment[] = [];
  const ignoredFlags: CodexArgsIgnoredFlag[] = [];
  const effectiveTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token) {
      continue;
    }

    if (!isFlagToken(token)) {
      effectiveTokens.push(token);
      continue;
    }

    const { flag, inlineValue } = splitFlagToken(token);
    const spec = FLAG_SPECS[flag];

    if (!spec) {
      effectiveTokens.push(token);
      continue;
    }

    const { value, consumeNext, isValid } = readFlagValue(spec, inlineValue, tokens[index + 1]);

    if (consumeNext) {
      index += 1;
    }

    if (spec.category === "ignored") {
      ignoredFlags.push({
        flag,
        canonicalFlag: spec.canonicalFlag,
        value,
      });
      continue;
    }

    if (!isValid) {
      continue;
    }

    recognizedSegments.push({
      flag,
      canonicalFlag: spec.canonicalFlag,
      value,
      label: makeRecognizedLabel(spec.canonicalFlag, value),
    });

    if (spec.valueMode === "none") {
      effectiveTokens.push(flag);
      continue;
    }

    if (inlineValue != null) {
      if (value != null) {
        if (/\s/.test(value)) {
          effectiveTokens.push(flag);
          effectiveTokens.push(value);
        } else {
          effectiveTokens.push(`${flag}=${value}`);
        }
      } else {
        effectiveTokens.push(flag);
      }
      continue;
    }

    effectiveTokens.push(flag);
    if (value != null) {
      effectiveTokens.push(value);
    }
  }

  return {
    originalArgs,
    recognizedSegments,
    ignoredFlags,
    effectiveArgs: joinCodexArgTokens(effectiveTokens),
  };
}

export function sanitizeRuntimeCodexArgs(args: string | null | undefined): string | null {
  return parseCodexArgsProfile(args).effectiveArgs;
}

export function getIgnoredCodexArgsFlagsMetadata(
  argsOrParsed: string | ParsedCodexArgsProfile | null | undefined,
): CodexArgsIgnoredFlagsMetadata {
  const parsed =
    typeof argsOrParsed === "string" || argsOrParsed == null
      ? parseCodexArgsProfile(argsOrParsed)
      : argsOrParsed;

  const ignoredCanonicalFlags = Array.from(
    new Set(parsed.ignoredFlags.map((flag) => flag.canonicalFlag)),
  );

  return {
    hasIgnoredFlags: parsed.ignoredFlags.length > 0,
    ignoredFlags: parsed.ignoredFlags,
    ignoredCanonicalFlags,
  };
}
