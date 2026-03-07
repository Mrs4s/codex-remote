export type ChatImageAttachment = {
  kind: "image";
  name: string;
  mimeType?: string | null;
  source: string;
};

export type ChatTextAttachment = {
  kind: "text";
  name: string;
  mimeType?: string | null;
  text: string;
  path?: string | null;
  truncated?: boolean;
};

export type ChatAttachment = ChatImageAttachment | ChatTextAttachment;

type SerializedAttachmentMetadata = {
  kind: "text";
  name: string;
  mimeType?: string | null;
  path?: string | null;
  truncated?: boolean;
};

const ATTACHMENT_START_PREFIX = "<!-- codex-remote-attachment ";
const ATTACHMENT_END_MARKER = "<!-- /codex-remote-attachment -->";

const TEXT_ATTACHMENT_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: "js",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "js",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  md: "md",
  mts: "ts",
  py: "python",
  rs: "rust",
  sass: "sass",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "svg",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

function attachmentBasename(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] ?? value : value;
}

function attachmentExtension(name: string) {
  const base = attachmentBasename(name);
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex >= base.length - 1) {
    return "";
  }
  return base.slice(dotIndex + 1).toLowerCase();
}

function attachmentFenceLanguage(name: string) {
  return TEXT_ATTACHMENT_LANGUAGE_BY_EXTENSION[attachmentExtension(name)] ?? "";
}

function attachmentFence(text: string) {
  const matches = text.match(/`{3,}/g) ?? [];
  const longest = matches.reduce((max, match) => Math.max(max, match.length), 2);
  return "`".repeat(longest + 1);
}

function parseAttachmentMetadata(raw: string): SerializedAttachmentMetadata | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedAttachmentMetadata>;
    if (parsed.kind !== "text" || typeof parsed.name !== "string" || !parsed.name.trim()) {
      return null;
    }
    return {
      kind: "text",
      name: parsed.name.trim(),
      mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : null,
      path: typeof parsed.path === "string" ? parsed.path : null,
      truncated: parsed.truncated === true,
    };
  } catch {
    return null;
  }
}

function parseAttachmentBody(block: string): string | null {
  const normalized = block.replace(/^\s+/, "").replace(/\s+$/, "");
  const match = normalized.match(/^(`{3,})([^\n`]*)\n([\s\S]*?)\n\1$/);
  if (!match) {
    return null;
  }
  return match[3] ?? "";
}

function normalizeResidualText(text: string) {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function isChatImageAttachment(
  attachment: ChatAttachment,
): attachment is ChatImageAttachment {
  return attachment.kind === "image";
}

export function isChatTextAttachment(
  attachment: ChatAttachment,
): attachment is ChatTextAttachment {
  return attachment.kind === "text";
}

export function chatImageAttachmentName(attachment: ChatImageAttachment) {
  const trimmed = attachment.name.trim();
  if (trimmed) {
    return trimmed;
  }
  return attachmentBasename(attachment.source);
}

export function createChatImageAttachment(
  source: string,
  options?: { name?: string | null; mimeType?: string | null },
): ChatImageAttachment {
  return {
    kind: "image",
    name: options?.name?.trim() || attachmentBasename(source) || "image",
    mimeType: options?.mimeType ?? null,
    source,
  };
}

export function chatAttachmentKey(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return `image:${attachment.source}`;
  }
  return `text:${attachment.path ?? attachment.name}:${attachment.text}`;
}

export function serializeChatTextAttachment(attachment: ChatTextAttachment) {
  const metadata: SerializedAttachmentMetadata = {
    kind: "text",
    name: attachment.name.trim() || "attachment.txt",
    mimeType: attachment.mimeType ?? null,
    path: attachment.path ?? null,
    truncated: attachment.truncated === true,
  };
  const fence = attachmentFence(attachment.text);
  const language = attachmentFenceLanguage(metadata.name);
  const languageSuffix = language ? language : "";
  return `${ATTACHMENT_START_PREFIX}${JSON.stringify(metadata)} -->\n${fence}${languageSuffix}\n${attachment.text}\n${fence}\n${ATTACHMENT_END_MARKER}`;
}

export function extractChatTextAttachmentsFromText(text: string): {
  text: string;
  attachments: ChatTextAttachment[];
} {
  if (!text.includes(ATTACHMENT_START_PREFIX)) {
    return { text, attachments: [] };
  }

  const attachments: ChatTextAttachment[] = [];
  const residualParts: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const startIndex = text.indexOf(ATTACHMENT_START_PREFIX, cursor);
    if (startIndex === -1) {
      residualParts.push(text.slice(cursor));
      break;
    }

    residualParts.push(text.slice(cursor, startIndex));
    const markerEndIndex = text.indexOf("-->", startIndex);
    if (markerEndIndex === -1) {
      residualParts.push(text.slice(startIndex));
      break;
    }

    const metadata = parseAttachmentMetadata(
      text.slice(startIndex + ATTACHMENT_START_PREFIX.length, markerEndIndex).trim(),
    );
    const contentStartIndex = markerEndIndex + 3;
    const endIndex = text.indexOf(ATTACHMENT_END_MARKER, contentStartIndex);
    if (!metadata || endIndex === -1) {
      residualParts.push(text.slice(startIndex));
      break;
    }

    const body = parseAttachmentBody(text.slice(contentStartIndex, endIndex));
    if (body === null) {
      residualParts.push(text.slice(startIndex, endIndex + ATTACHMENT_END_MARKER.length));
      cursor = endIndex + ATTACHMENT_END_MARKER.length;
      continue;
    }

    attachments.push({
      kind: "text",
      name: metadata.name,
      mimeType: metadata.mimeType ?? null,
      path: metadata.path ?? null,
      truncated: metadata.truncated === true,
      text: body,
    });
    cursor = endIndex + ATTACHMENT_END_MARKER.length;
  }

  return {
    text: normalizeResidualText(residualParts.join("")),
    attachments,
  };
}
