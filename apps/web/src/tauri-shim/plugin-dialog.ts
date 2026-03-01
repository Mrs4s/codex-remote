type DialogFilter = {
  name: string;
  extensions: string[];
};

type OpenOptions = {
  directory?: boolean;
  multiple?: boolean;
  filters?: DialogFilter[];
  title?: string;
};

type SaveOptions = {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
};

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function pickFiles(options: OpenOptions): Promise<string[] | null> {
  if (typeof document === "undefined") {
    return null;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = Boolean(options.multiple);
  if (!options.directory) {
    const extensions = (options.filters ?? [])
      .flatMap((filter) => filter.extensions ?? [])
      .map((ext) => `.${ext.replace(/^\./, "")}`);
    if (extensions.length > 0) {
      input.accept = extensions.join(",");
    }
  } else {
    input.setAttribute("webkitdirectory", "true");
  }

  return new Promise((resolve) => {
    input.onchange = async () => {
      const list = Array.from(input.files ?? []);
      if (list.length === 0) {
        resolve(null);
        return;
      }
      if (options.directory) {
        // Browser cannot expose absolute directory paths.
        const first = list[0];
        const folder = first?.webkitRelativePath?.split("/")?.[0] ?? "";
        resolve(folder ? [folder] : null);
        return;
      }
      const dataUrls = await Promise.all(list.map((file) => toDataUrl(file)));
      resolve(dataUrls);
    };
    input.click();
  });
}

export async function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  if (options.directory) {
    const value = window.prompt(options.title || "Enter workspace path");
    if (!value?.trim()) {
      return null;
    }
    if (options.multiple) {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return value.trim();
  }

  const files = await pickFiles(options);
  if (!files || files.length === 0) {
    return null;
  }
  if (options.multiple) {
    return files;
  }
  return files[0] ?? null;
}

export async function save(options: SaveOptions = {}): Promise<string | null> {
  const suggested = (options.defaultPath ?? "").trim();
  const fallback = suggested || "download.txt";
  const value = window.prompt(options.title || "Save as", fallback);
  if (!value?.trim()) {
    return null;
  }
  return value.trim();
}

export async function ask(
  prompt: string,
  _options?: {
    title?: string;
    kind?: "info" | "warning" | "error";
    okLabel?: string;
    cancelLabel?: string;
  },
): Promise<boolean> {
  return window.confirm(prompt);
}

export async function message(
  input: string,
  _options?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<void> {
  window.alert(input);
}
