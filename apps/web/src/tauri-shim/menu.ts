type Action = () => void | Promise<void>;

type MenuItemOptions = {
  text?: string;
  enabled?: boolean;
  action?: Action;
};

type PredefinedMenuItemOptions = {
  item: string;
};

type MenuOptions = {
  items?: Array<MenuItem | PredefinedMenuItem>;
};

const MENU_STYLE_ID = "codex-web-menu-style";
const MENU_OVERLAY_CLASS = "codex-web-menu-overlay";
const MENU_SURFACE_CLASS = "codex-web-menu-surface";
const MENU_ITEM_CLASS = "codex-web-menu-item";
const MENU_SEPARATOR_CLASS = "codex-web-menu-separator";
const MENU_MARGIN = 8;

let activeMenuClose: (() => void) | null = null;

function ensureMenuStyles() {
  if (typeof document === "undefined") {
    return;
  }
  if (document.getElementById(MENU_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = MENU_STYLE_ID;
  style.textContent = `
.${MENU_OVERLAY_CLASS} {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
}
.${MENU_SURFACE_CLASS} {
  position: fixed;
  min-width: 180px;
  max-width: 320px;
  max-height: calc(100vh - ${MENU_MARGIN * 2}px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(23, 23, 29, 0.97);
  box-shadow:
    0 14px 32px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.3);
  color: rgba(245, 245, 245, 0.96);
  font-size: 13px;
  line-height: 1.35;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.${MENU_ITEM_CLASS} {
  border: 0;
  border-radius: 6px;
  padding: 6px 9px;
  text-align: left;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.${MENU_ITEM_CLASS}:hover {
  background: rgba(148, 163, 184, 0.18);
}
.${MENU_ITEM_CLASS}:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.55);
  outline-offset: 1px;
}
.${MENU_ITEM_CLASS}:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.${MENU_SEPARATOR_CLASS} {
  margin: 3px 2px;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
}
@media (prefers-color-scheme: light) {
  .${MENU_SURFACE_CLASS} {
    border-color: rgba(148, 163, 184, 0.45);
    background: rgba(255, 255, 255, 0.98);
    box-shadow:
      0 12px 28px rgba(15, 23, 42, 0.18),
      0 2px 6px rgba(15, 23, 42, 0.12);
    color: rgba(15, 23, 42, 0.96);
  }
  .${MENU_ITEM_CLASS}:hover {
    background: rgba(148, 163, 184, 0.22);
  }
  .${MENU_SEPARATOR_CLASS} {
    border-top-color: rgba(148, 163, 184, 0.4);
  }
}
`;
  document.head.appendChild(style);
}

function isMenuItem(entry: MenuItem | PredefinedMenuItem): entry is MenuItem {
  return entry instanceof MenuItem;
}

function asPoint(position: unknown): { x: number; y: number } | null {
  if (!position || typeof position !== "object") {
    return null;
  }
  const candidate = position as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return null;
  }
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    return null;
  }
  return { x: candidate.x, y: candidate.y };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export class MenuItem {
  text: string;
  enabled: boolean;
  action?: Action;

  constructor(options: MenuItemOptions = {}) {
    this.text = options.text ?? "";
    this.enabled = options.enabled ?? true;
    this.action = options.action;
  }

  static async new(options: MenuItemOptions): Promise<MenuItem> {
    return new MenuItem(options);
  }
}

export class PredefinedMenuItem {
  item: string;
  text = "";
  enabled = true;

  constructor(options: PredefinedMenuItemOptions) {
    this.item = options.item;
  }

  static async new(options: PredefinedMenuItemOptions): Promise<PredefinedMenuItem> {
    return new PredefinedMenuItem(options);
  }
}

export class Menu {
  items: Array<MenuItem | PredefinedMenuItem>;
  private closePopup: (() => void) | null = null;

  constructor(options: MenuOptions = {}) {
    this.items = options.items ?? [];
  }

  static async new(options: MenuOptions): Promise<Menu> {
    return new Menu(options);
  }

  async popup(position?: unknown, _window?: unknown): Promise<void> {
    if (typeof document === "undefined") {
      return;
    }
    ensureMenuStyles();
    activeMenuClose?.();
    this.close();

    const overlay = document.createElement("div");
    overlay.className = MENU_OVERLAY_CLASS;

    const surface = document.createElement("div");
    surface.className = MENU_SURFACE_CLASS;
    surface.setAttribute("role", "menu");
    overlay.appendChild(surface);

    const close = () => {
      if (this.closePopup !== close) {
        return;
      }
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("blur", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      overlay.remove();
      if (activeMenuClose === close) {
        activeMenuClose = null;
      }
      this.closePopup = null;
    };

    const invokeAndClose = async (action?: Action) => {
      close();
      if (!action) {
        return;
      }
      try {
        await action();
      } catch (error) {
        console.error("Failed to execute menu action", error);
      }
    };

    this.items.forEach((entry) => {
      if (isMenuItem(entry)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = MENU_ITEM_CLASS;
        button.textContent = entry.text || "Untitled";
        button.disabled = !entry.enabled;
        button.setAttribute("role", "menuitem");
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!entry.enabled) {
            return;
          }
          void invokeAndClose(entry.action);
        });
        surface.appendChild(button);
        return;
      }

      if (entry.item.toLowerCase() === "separator") {
        const separator = document.createElement("div");
        separator.className = MENU_SEPARATOR_CLASS;
        separator.setAttribute("role", "separator");
        surface.appendChild(separator);
      }
    });

    if (!surface.childElementCount) {
      return;
    }

    document.body.appendChild(overlay);

    const point = asPoint(position);
    const initialX = point?.x ?? window.innerWidth / 2;
    const initialY = point?.y ?? window.innerHeight / 2;
    const menuWidth = surface.offsetWidth;
    const menuHeight = surface.offsetHeight;
    const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - menuWidth - MENU_MARGIN);
    const maxTop = Math.max(MENU_MARGIN, window.innerHeight - menuHeight - MENU_MARGIN);
    const left = clamp(initialX, MENU_MARGIN, maxLeft);
    const top = clamp(initialY, MENU_MARGIN, maxTop);
    surface.style.left = `${left}px`;
    surface.style.top = `${top}px`;

    const handleWindowChange = () => {
      close();
    };

    const handlePointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || !surface.contains(target)) {
        close();
      }
    };

    const handleContextMenu = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || !surface.contains(target)) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("blur", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    this.closePopup = close;
    activeMenuClose = close;

    const firstEnabledItem = surface.querySelector<HTMLButtonElement>(
      `.${MENU_ITEM_CLASS}:not(:disabled)`,
    );
    firstEnabledItem?.focus();
    return;
  }

  close(): void {
    this.closePopup?.();
  }
}
