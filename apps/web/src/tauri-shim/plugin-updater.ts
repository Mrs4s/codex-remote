export type DownloadEvent = {
  event: "Started" | "Progress" | "Finished";
  data: { contentLength?: number; chunkLength: number };
};

export type Update = {
  version: string;
  currentVersion?: string;
  body?: string;
  date?: string;
  downloadAndInstall: (
    onEvent?: (event: DownloadEvent) => void,
  ) => Promise<void>;
  close: () => Promise<void>;
};

export async function check(): Promise<Update | null> {
  return null;
}
