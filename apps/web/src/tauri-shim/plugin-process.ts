export async function relaunch(): Promise<void> {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
