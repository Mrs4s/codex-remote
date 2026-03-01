import { downloadTextFile, rpcInvoke } from "./remote";

export function isTauri(): boolean {
  return false;
}

export function convertFileSrc(path: string): string {
  const value = (path ?? "").trim();
  if (!value) {
    return value;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  return value;
}

export async function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (command === "write_text_file") {
    const fileName =
      typeof args?.path === "string" && args.path.trim() ? args.path.trim() : "export.txt";
    const content = typeof args?.content === "string" ? args.content : "";
    downloadTextFile(fileName, content);
    return undefined as T;
  }

  if (command === "is_mobile_runtime") {
    return false as T;
  }
  if (command === "is_macos_debug_build") {
    return false as T;
  }
  if (command === "app_build_type") {
    return "release" as T;
  }

  const result = await rpcInvoke<T>(command, args ?? {});

  if (typeof window !== "undefined") {
    if (command === "get_app_settings" && result && typeof result === "object") {
      const settings = result as Record<string, unknown>;
      const host =
        typeof settings.remoteBackendHost === "string" ? settings.remoteBackendHost.trim() : "";
      const token =
        typeof settings.remoteBackendToken === "string" ? settings.remoteBackendToken.trim() : "";
      if (host) {
        window.localStorage.setItem("codex-remote.baseUrl", host);
      }
      if (token) {
        window.localStorage.setItem("codex-remote.token", token);
      }
    }

    if (
      command === "update_app_settings" &&
      args?.settings &&
      typeof args.settings === "object"
    ) {
      const settings = args.settings as Record<string, unknown>;
      const host =
        typeof settings.remoteBackendHost === "string" ? settings.remoteBackendHost.trim() : "";
      const token =
        typeof settings.remoteBackendToken === "string" ? settings.remoteBackendToken.trim() : "";
      if (host) {
        window.localStorage.setItem("codex-remote.baseUrl", host);
      }
      if (token) {
        window.localStorage.setItem("codex-remote.token", token);
      }
    }
  }

  return result;
}
