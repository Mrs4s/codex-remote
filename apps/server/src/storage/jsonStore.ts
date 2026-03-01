import fs from "node:fs/promises";
import path from "node:path";
import { defaultAppSettings, type AppSettings, type WorkspaceEntry } from "../types/domain.js";

export class JsonStore {
  private readonly workspacesPath: string;
  private readonly settingsPath: string;

  constructor(private readonly dataDir: string) {
    this.workspacesPath = path.join(dataDir, "workspaces.json");
    this.settingsPath = path.join(dataDir, "settings.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.ensureFile(this.workspacesPath, "[]\n");
    await this.ensureFile(this.settingsPath, `${JSON.stringify(defaultAppSettings(), null, 2)}\n`);
  }

  async readWorkspaces(): Promise<WorkspaceEntry[]> {
    const raw = await fs.readFile(this.workspacesPath, "utf8");
    const parsed = JSON.parse(raw) as WorkspaceEntry[];
    return Array.isArray(parsed) ? parsed : [];
  }

  async writeWorkspaces(workspaces: WorkspaceEntry[]): Promise<void> {
    await fs.writeFile(this.workspacesPath, `${JSON.stringify(workspaces, null, 2)}\n`, "utf8");
  }

  async readSettings(): Promise<AppSettings> {
    const raw = await fs.readFile(this.settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaultAppSettings(),
      ...parsed,
      backendMode: "remote",
    };
  }

  async writeSettings(settings: AppSettings): Promise<void> {
    await fs.writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  private async ensureFile(filePath: string, defaultContent: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, defaultContent, "utf8");
    }
  }
}
