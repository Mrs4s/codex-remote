import { useCallback } from "react";
import type { MouseEvent } from "react";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { OpenAppTarget } from "../../../types";
import { isAbsolutePath, joinWorkspacePath } from "../../../utils/platformPaths";

function resolveFilePath(path: string, workspacePath?: string | null) {
  const trimmed = path.trim();
  if (!workspacePath) {
    return trimmed;
  }
  if (isAbsolutePath(trimmed)) {
    return trimmed;
  }
  return joinWorkspacePath(workspacePath, trimmed);
}

function stripLineSuffix(path: string) {
  const match = path.match(/^(.*?)(?::\d+(?::\d+)?)?$/);
  return match ? match[1] : path;
}

function buildFileLink(path: string) {
  return path.startsWith("/") ? `file://${path}` : path;
}

export function useFileLinkOpener(
  workspacePath: string | null,
  _openTargets: OpenAppTarget[],
  _selectedOpenAppId: string,
) {
  const openFileLink = useCallback(
    async (rawPath: string) => {
      const resolvedPath = resolveFilePath(stripLineSuffix(rawPath), workspacePath);
      const link = buildFileLink(resolvedPath);
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // Clipboard failures are non-fatal here.
      }
    },
    [workspacePath],
  );

  const showFileLinkMenu = useCallback(
    async (event: MouseEvent, rawPath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const resolvedPath = resolveFilePath(stripLineSuffix(rawPath), workspacePath);
      const link = buildFileLink(resolvedPath);
      const items = [
        await MenuItem.new({
          text: "Copy File Link",
          action: async () => {
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              // Clipboard failures are non-fatal here.
            }
          },
        }),
        await MenuItem.new({
          text: "Copy File Path",
          action: async () => {
            try {
              await navigator.clipboard.writeText(resolvedPath);
            } catch {
              // Clipboard failures are non-fatal here.
            }
          },
        }),
      ];

      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [workspacePath],
  );

  return { openFileLink, showFileLinkMenu };
}
