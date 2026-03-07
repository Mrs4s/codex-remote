import { convertFileSrc } from "@tauri-apps/api/core";
import type { ChatAttachment } from "@codex-remote/shared-types";
import {
  chatAttachmentKey,
  chatImageAttachmentName,
  isChatImageAttachment,
  isChatTextAttachment,
} from "@codex-remote/shared-types";
import Image from "lucide-react/dist/esm/icons/image";
import FileText from "lucide-react/dist/esm/icons/file-text";
import X from "lucide-react/dist/esm/icons/x";

type ComposerAttachmentsProps = {
  attachments: ChatAttachment[];
  disabled: boolean;
  onRemoveAttachment?: (attachment: ChatAttachment) => void;
};

function fileTitle(attachment: ChatAttachment) {
  if (isChatImageAttachment(attachment)) {
    return chatImageAttachmentName(attachment);
  }
  return attachment.name.trim() || "attachment.txt";
}

function attachmentPreviewSrc(attachment: ChatAttachment) {
  if (!isChatImageAttachment(attachment)) {
    return "";
  }
  if (attachment.source.startsWith("data:")) {
    return attachment.source;
  }
  if (attachment.source.startsWith("http://") || attachment.source.startsWith("https://")) {
    return attachment.source;
  }
  try {
    return convertFileSrc(attachment.source);
  } catch {
    return "";
  }
}

export function ComposerAttachments({
  attachments,
  disabled,
  onRemoveAttachment,
}: ComposerAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="composer-attachments">
      {attachments.map((attachment) => {
        const title = fileTitle(attachment);
        const titleAttr = isChatTextAttachment(attachment)
          ? attachment.path ?? attachment.name
          : attachment.source.startsWith("data:")
            ? "Pasted image"
            : attachment.source;
        const previewSrc = attachmentPreviewSrc(attachment);
        return (
          <div
            key={chatAttachmentKey(attachment)}
            className="composer-attachment"
            title={titleAttr}
          >
            {previewSrc && (
              <span className="composer-attachment-preview" aria-hidden>
                <img src={previewSrc} alt="" />
              </span>
            )}
            {previewSrc ? (
              <span className="composer-attachment-thumb" aria-hidden>
                <img src={previewSrc} alt="" />
              </span>
            ) : (
              <span className="composer-icon" aria-hidden>
                {isChatTextAttachment(attachment) ? (
                  <FileText size={14} />
                ) : (
                  <Image size={14} />
                )}
              </span>
            )}
            <span className="composer-attachment-name">
              {title}
              {isChatTextAttachment(attachment) && attachment.truncated ? " (truncated)" : ""}
            </span>
            <button
              type="button"
              className="composer-attachment-remove"
              onClick={() => onRemoveAttachment?.(attachment)}
              aria-label={`Remove ${title}`}
              disabled={disabled}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
