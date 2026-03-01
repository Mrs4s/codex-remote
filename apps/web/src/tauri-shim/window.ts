export const Effect = {
  Acrylic: "acrylic",
  HudWindow: "hudWindow",
} as const;

export const EffectState = {
  Active: "active",
} as const;

type Unlisten = () => void;

type DragDropEventPayload = {
  type: "enter" | "over" | "leave" | "drop";
  position: { x: number; y: number };
  paths?: string[];
};

type DragDropEvent = {
  payload: DragDropEventPayload;
};

type WindowHandle = {
  label: string;
  listen: (
    event: string,
    callback: () => void,
  ) => Promise<Unlisten>;
  onResized: (callback: () => void) => Promise<Unlisten>;
  onDragDropEvent: (callback: (event: DragDropEvent) => void) => Promise<Unlisten>;
  isMaximized: () => Promise<boolean>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  startDragging: () => Promise<void>;
  setEffects: (effects: unknown) => Promise<void>;
  [key: string]: unknown;
};

const noopUnlisten: Unlisten = () => undefined;

const windowHandle: WindowHandle = {
  label: "main",
  async listen(event: string, callback: () => void): Promise<Unlisten> {
    if (typeof window === "undefined") {
      return noopUnlisten;
    }
    if (event === "tauri://focus") {
      window.addEventListener("focus", callback);
      return () => window.removeEventListener("focus", callback);
    }
    if (event === "tauri://blur") {
      window.addEventListener("blur", callback);
      return () => window.removeEventListener("blur", callback);
    }
    return noopUnlisten;
  },
  async onResized(_callback: () => void): Promise<Unlisten> {
    return noopUnlisten;
  },
  async onDragDropEvent(_callback: (event: DragDropEvent) => void): Promise<Unlisten> {
    return noopUnlisten;
  },
  async isMaximized(): Promise<boolean> {
    return false;
  },
  async minimize(): Promise<void> {
    return;
  },
  async toggleMaximize(): Promise<void> {
    return;
  },
  async close(): Promise<void> {
    return;
  },
  async startDragging(): Promise<void> {
    return;
  },
  async setEffects(_effects: unknown): Promise<void> {
    return;
  },
};

export function getCurrentWindow(): WindowHandle {
  return windowHandle;
}
