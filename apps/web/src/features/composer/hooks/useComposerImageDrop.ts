import { useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "@codex-remote/shared-types";
import { createChatImageAttachment } from "@codex-remote/shared-types";
import { subscribeWindowDragDrop } from "../../../services/dragDrop";

const imageExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
];
const textAttachmentExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".log",
  ".lua",
  ".md",
  ".mjs",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const TEXT_ATTACHMENT_MAX_BYTES = 400_000;

function isImagePath(path: string) {
  const lower = path.toLowerCase();
  return imageExtensions.some((ext) => lower.endsWith(ext));
}

function isTextPath(path: string) {
  const lower = path.toLowerCase();
  return Array.from(textAttachmentExtensions).some((ext) => lower.endsWith(ext));
}

function isDragFileTransfer(types: readonly string[] | undefined) {
  if (!types || types.length === 0) {
    return false;
  }
  return (
    types.includes("Files") ||
    types.includes("public.file-url") ||
    types.includes("application/x-moz-file")
  );
}

function readFilesAsDataUrls(files: File[]) {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(file);
        }),
    ),
  ).then((items) => items.filter(Boolean));
}

async function readFileAsTextAttachment(file: File): Promise<ChatAttachment | null> {
  const slice = file.slice(0, TEXT_ATTACHMENT_MAX_BYTES + 1);
  const text = await slice.text();
  const truncated = text.length > TEXT_ATTACHMENT_MAX_BYTES || file.size > TEXT_ATTACHMENT_MAX_BYTES;
  return {
    kind: "text",
    name: file.name || "attachment.txt",
    mimeType: file.type || null,
    path: null,
    truncated,
    text: truncated ? text.slice(0, TEXT_ATTACHMENT_MAX_BYTES) : text,
  };
}

async function readDroppedFileAttachment(file: File): Promise<ChatAttachment | null> {
  const path = (file as File & { path?: string }).path ?? "";
  if (path && isImagePath(path)) {
    return createChatImageAttachment(path, {
      name: file.name || null,
      mimeType: file.type || null,
    });
  }
  if (String(file.type ?? "").startsWith("image/")) {
    const [source] = await readFilesAsDataUrls([file]);
    return source
      ? createChatImageAttachment(source, {
          name: file.name || null,
          mimeType: file.type || null,
        })
      : null;
  }
  if (
    path
      ? isTextPath(path)
      : String(file.type ?? "").startsWith("text/") || textAttachmentExtensions.has(`.${file.name.split(".").pop()?.toLowerCase() ?? ""}`)
  ) {
    return readFileAsTextAttachment(file);
  }
  return null;
}

function getDragPosition(position: { x: number; y: number }) {
  return position;
}

function normalizeDragPosition(
  position: { x: number; y: number },
  lastClientPosition: { x: number; y: number } | null,
) {
  const scale = window.devicePixelRatio || 1;
  if (scale === 1 || !lastClientPosition) {
    return getDragPosition(position);
  }
  const logicalDistance = Math.hypot(
    position.x - lastClientPosition.x,
    position.y - lastClientPosition.y,
  );
  const scaled = { x: position.x / scale, y: position.y / scale };
  const scaledDistance = Math.hypot(
    scaled.x - lastClientPosition.x,
    scaled.y - lastClientPosition.y,
  );
  return scaledDistance < logicalDistance ? scaled : position;
}

type UseComposerImageDropArgs = {
  disabled: boolean;
  onAttachImages?: (attachments: ChatAttachment[]) => void;
};

export function useComposerImageDrop({
  disabled,
  onAttachImages,
}: UseComposerImageDropArgs) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dropTargetRef = useRef<HTMLDivElement | null>(null);
  const lastClientPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    if (disabled) {
      return undefined;
    }
    unlisten = subscribeWindowDragDrop((event) => {
      if (!dropTargetRef.current) {
        return;
      }
      if (event.payload.type === "leave") {
        setIsDragOver(false);
        return;
      }
      const position = normalizeDragPosition(
        event.payload.position,
        lastClientPositionRef.current,
      );
      const rect = dropTargetRef.current.getBoundingClientRect();
      const isInside =
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom;
      if (event.payload.type === "over" || event.payload.type === "enter") {
        setIsDragOver(isInside);
        return;
      }
      if (event.payload.type === "drop") {
        setIsDragOver(false);
        if (!isInside) {
          return;
        }
        const attachments = (event.payload.paths ?? [])
          .map((path) => path.trim())
          .filter(Boolean)
          .filter((path) => isImagePath(path) || isTextPath(path))
          .map((path) =>
            isImagePath(path)
              ? createChatImageAttachment(path)
              : ({
                  kind: "text" as const,
                  name: path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "attachment.txt",
                  mimeType: null,
                  path,
                  truncated: false,
                  text: "",
                }),
          );
        if (attachments.length > 0) {
          onAttachImages?.(attachments.filter((attachment) => attachment.kind === "image"));
        }
      }
    });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [disabled, onAttachImages]);

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }
    if (isDragFileTransfer(event.dataTransfer?.types)) {
      lastClientPositionRef.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      setIsDragOver(true);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    handleDragOver(event);
  };

  const handleDragLeave = () => {
    if (isDragOver) {
      setIsDragOver(false);
      lastClientPositionRef.current = null;
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    setIsDragOver(false);
    lastClientPositionRef.current = null;
    const files = Array.from(event.dataTransfer?.files ?? []);
    const items = Array.from(event.dataTransfer?.items ?? []);
    const itemFiles = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const attachments = await Promise.all(
      [...files, ...itemFiles].map((file) => readDroppedFileAttachment(file)),
    );
    const validAttachments = attachments.filter(
      (attachment): attachment is ChatAttachment =>
        attachment !== null && !(attachment.kind === "text" && attachment.text.length === 0),
    );
    if (validAttachments.length === 0) {
      return;
    }
    onAttachImages?.(validAttachments);
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) {
      return;
    }
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) {
      return;
    }
    event.preventDefault();
    const files = imageItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) {
      return;
    }
    const dataUrls = await Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : "");
            reader.onerror = () => resolve("");
            reader.readAsDataURL(file);
          }),
      ),
    );
    const valid = dataUrls.filter(Boolean).map((source, index) =>
      createChatImageAttachment(source, {
        name: files[index]?.name ?? null,
        mimeType: files[index]?.type ?? null,
      }),
    );
    if (valid.length > 0) {
      onAttachImages?.(valid);
    }
  };

  return {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  };
}
