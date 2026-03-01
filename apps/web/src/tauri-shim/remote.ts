type RpcPayload = Record<string, unknown>;

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "http://127.0.0.1:8787";
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
  return normalizeBaseUrl(storageBase);
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
