import { useCallback, useMemo, useState } from "react";
import type { ChatAttachment } from "@codex-remote/shared-types";
import { chatAttachmentKey } from "@codex-remote/shared-types";
import { pickChatAttachments } from "../../../services/tauri";

type UseComposerImagesArgs = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
};

export function useComposerImages({
  activeThreadId,
  activeWorkspaceId,
}: UseComposerImagesArgs) {
  const [imagesByThread, setImagesByThread] = useState<Record<string, ChatAttachment[]>>({});

  const draftKey = useMemo(
    () => activeThreadId ?? `draft-${activeWorkspaceId ?? "none"}`,
    [activeThreadId, activeWorkspaceId],
  );

  const activeImages = imagesByThread[draftKey] ?? [];

  const attachImages = useCallback(
    (attachments: ChatAttachment[]) => {
      if (attachments.length === 0) {
        return;
      }
      setImagesByThread((prev) => {
        const existing = prev[draftKey] ?? [];
        const mergedByKey = new Map<string, ChatAttachment>();
        [...existing, ...attachments].forEach((attachment) => {
          mergedByKey.set(chatAttachmentKey(attachment), attachment);
        });
        const merged = Array.from(mergedByKey.values());
        return { ...prev, [draftKey]: merged };
      });
    },
    [draftKey],
  );

  const pickImages = useCallback(async () => {
    const picked = await pickChatAttachments();
    if (picked.length === 0) {
      return;
    }
    attachImages(picked);
  }, [attachImages]);

  const removeImage = useCallback(
    (attachmentToRemove: ChatAttachment) => {
      setImagesByThread((prev) => {
        const existing = prev[draftKey] ?? [];
        const attachmentKey = chatAttachmentKey(attachmentToRemove);
        const next = existing.filter((entry) => chatAttachmentKey(entry) !== attachmentKey);
        if (next.length === 0) {
          const { [draftKey]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [draftKey]: next };
      });
    },
    [draftKey],
  );

  const clearActiveImages = useCallback(() => {
    setImagesByThread((prev) => {
      if (!(draftKey in prev)) {
        return prev;
      }
      const { [draftKey]: _, ...rest } = prev;
      return rest;
    });
  }, [draftKey]);

  const setImagesForThread = useCallback((threadId: string, images: ChatAttachment[]) => {
    setImagesByThread((prev) => ({ ...prev, [threadId]: images }));
  }, []);

  const removeImagesForThread = useCallback((threadId: string) => {
    setImagesByThread((prev) => {
      if (!(threadId in prev)) {
        return prev;
      }
      const { [threadId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
  };
}
