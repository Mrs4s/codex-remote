import type {
  RpcMethod,
  RpcMethodMap,
  RpcResponse,
  SseEventMap,
} from "@codex-remote/shared-types";

type ClientOptions = {
  baseUrl: string;
  token: string;
};

export class CodexRemoteClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
  }

  async call<M extends RpcMethod>(
    method: M,
    params: RpcMethodMap[M]["params"],
  ): Promise<RpcMethodMap[M]["result"]> {
    const response = await fetch(`${this.baseUrl}/api/v1/rpc/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(params ?? {}),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as RpcResponse<RpcMethodMap[M]["result"]>;
    if ("error" in payload) {
      throw new Error(payload.error.message || "RPC request failed");
    }
    return payload.result;
  }

  subscribe<K extends keyof SseEventMap>(
    event: K,
    onEvent: (payload: SseEventMap[K]) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    const url = new URL(`${this.baseUrl}/api/v1/events`);
    url.searchParams.set("token", this.token);
    const source = new EventSource(url.toString());

    const handler = (message: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(message.data) as SseEventMap[K]);
      } catch (error) {
        onError?.(error);
      }
    };

    source.addEventListener(String(event), handler as EventListener);
    source.onerror = (error) => {
      onError?.(error);
    };

    return () => {
      source.removeEventListener(String(event), handler as EventListener);
      source.close();
    };
  }
}
