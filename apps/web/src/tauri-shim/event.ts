import { createEventStream } from "./remote";

export type Event<T> = {
  payload: T;
};

export type EventCallback<T> = (event: Event<T>) => void;
export type UnlistenFn = () => void;

type ListenerEntry = {
  callbacks: Set<EventCallback<unknown>>;
  domHandler: ((message: MessageEvent<string>) => void) | null;
};

const listeners = new Map<string, ListenerEntry>();
let source: EventSource | null = null;

function ensureSource() {
  if (source) {
    return;
  }
  source = createEventStream();
  source.onerror = (error) => {
    console.warn("[tauri-shim:event] SSE connection error", error);
  };
}

function teardownSourceIfIdle() {
  const hasListeners = Array.from(listeners.values()).some((entry) => entry.callbacks.size > 0);
  if (!hasListeners && source) {
    source.close();
    source = null;
  }
}

export async function listen<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  ensureSource();
  if (!source) {
    return () => undefined;
  }

  let entry = listeners.get(event);
  if (!entry) {
    const callbacks = new Set<EventCallback<unknown>>();
    const domHandler = (message: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }
      for (const callback of callbacks) {
        try {
          callback({ payload });
        } catch (error) {
          console.error(`[tauri-shim:event] listener failed for ${event}`, error);
        }
      }
    };
    source.addEventListener(event, domHandler as EventListener);
    entry = { callbacks, domHandler };
    listeners.set(event, entry);
  }

  entry.callbacks.add(handler as EventCallback<unknown>);

  return () => {
    const current = listeners.get(event);
    if (!current) {
      return;
    }
    current.callbacks.delete(handler as EventCallback<unknown>);
    if (current.callbacks.size === 0) {
      if (source && current.domHandler) {
        source.removeEventListener(event, current.domHandler as EventListener);
      }
      listeners.delete(event);
      teardownSourceIfIdle();
    }
  };
}
