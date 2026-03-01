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
  text = "";
  enabled = true;

  static async new(_options: PredefinedMenuItemOptions): Promise<PredefinedMenuItem> {
    return new PredefinedMenuItem();
  }
}

export class Menu {
  items: Array<MenuItem | PredefinedMenuItem>;

  constructor(options: MenuOptions = {}) {
    this.items = options.items ?? [];
  }

  static async new(options: MenuOptions): Promise<Menu> {
    return new Menu(options);
  }

  async popup(_position?: unknown, _window?: unknown): Promise<void> {
    return;
  }

  close(): void {
    return;
  }
}
