type RpcPayload = Record<string, unknown>;

function getDefaultBaseUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return window.location.origin.replace(/\/$/, "");
    }
  }
  return "http://127.0.0.1:8787";
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return getDefaultBaseUrl();
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/$/, "");
  }
  return `http://${trimmed.replace(/\/$/, "")}`;
}

export function getRemoteBaseUrl(): string {
  const envBase = String(import.meta.env.VITE_CODEX_REMOTE_BASE_URL ?? "").trim();
  if (envBase) {
    return normalizeBaseUrl(envBase);
  }

  const storageBase =
    typeof window !== "undefined"
      ? window.localStorage.getItem("codex-remote.baseUrl") ?? ""
      : "";

  if (storageBase) {
    const normalizedStorage = normalizeBaseUrl(storageBase);
    const defaultBase = getDefaultBaseUrl();
    if (defaultBase !== "http://127.0.0.1:8787" && isLoopbackUrl(normalizedStorage)) {
      return defaultBase;
    }
    return normalizedStorage;
  }

  return getDefaultBaseUrl();
}

export function getRemoteToken(): string {
  const envToken = String(import.meta.env.VITE_CODEX_REMOTE_TOKEN ?? "").trim();
  if (envToken) {
    return envToken;
  }
  const storageToken =
    typeof window !== "undefined"
      ? window.localStorage.getItem("codex-remote.token") ?? ""
      : "";
  return (storageToken || "change-me").trim();
}

export function setRemoteToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = token.trim();
  if (!trimmed) {
    window.localStorage.removeItem("codex-remote.token");
    return;
  }
  window.localStorage.setItem("codex-remote.token", trimmed);
}

export async function rpcInvoke<T>(method: string, payload: RpcPayload = {}): Promise<T> {
  const baseUrl = getRemoteBaseUrl();
  const token = getRemoteToken();
  const response = await fetch(`${baseUrl}/api/v1/rpc/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // Keep parsed null when backend returns non-json error.
  }

  if (!response.ok) {
    const message =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof (parsed.error as Record<string, unknown>).message === "string"
        ? ((parsed.error as Record<string, unknown>).message as string)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error) {
    const message =
      typeof (parsed.error as Record<string, unknown>).message === "string"
        ? ((parsed.error as Record<string, unknown>).message as string)
        : "RPC request failed";
    throw new Error(message);
  }

  if (parsed && typeof parsed === "object" && "result" in parsed) {
    return (parsed as { result: T }).result;
  }

  throw new Error("Invalid RPC response");
}

export function downloadTextFile(fileName: string, content: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function createEventStream(): EventSource {
  const baseUrl = getRemoteBaseUrl();
  const token = getRemoteToken();
  const url = new URL(`${baseUrl}/api/v1/events`);
  url.searchParams.set("token", token);
  return new EventSource(url.toString());
}
