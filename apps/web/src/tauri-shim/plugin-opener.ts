export async function openUrl(url: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function revealItemInDir(path: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
  }
  const encoded = path.startsWith("file://") ? path : `file://${path}`;
  window.open(encoded, "_blank", "noopener,noreferrer");
}
