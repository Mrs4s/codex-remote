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
    const { value, recovered } = this.parseContainerWithRecovery<unknown>(
      raw,
      this.workspacesPath,
      "[",
      "]",
    );
    const parsed = Array.isArray(value) ? (value as WorkspaceEntry[]) : [];
    if (recovered) {
      await this.writeWorkspaces(parsed);
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  async writeWorkspaces(workspaces: WorkspaceEntry[]): Promise<void> {
    await fs.writeFile(this.workspacesPath, `${JSON.stringify(workspaces, null, 2)}\n`, "utf8");
  }

  async readSettings(): Promise<AppSettings> {
    const raw = await fs.readFile(this.settingsPath, "utf8");
    const { value, recovered } = this.parseContainerWithRecovery<unknown>(
      raw,
      this.settingsPath,
      "{",
      "}",
    );
    const parsed =
      value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AppSettings>) : {};
    const settings: AppSettings = {
      ...defaultAppSettings(),
      ...parsed,
      backendMode: "remote",
    };
    if (recovered) {
      await this.writeSettings(settings);
    }
    return settings;
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

  private parseContainerWithRecovery<T>(
    raw: string,
    filePath: string,
    openChar: "[" | "{",
    closeChar: "]" | "}",
  ): { value: T; recovered: boolean } {
    if (!raw.trim()) {
      const emptyValue = (openChar === "[" ? [] : {}) as T;
      return { value: emptyValue, recovered: true };
    }

    try {
      return { value: JSON.parse(raw) as T, recovered: false };
    } catch (error) {
      const extraction = this.extractFirstContainer(raw, openChar, closeChar);
      if (!extraction) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${filePath}: ${message}`);
      }

      try {
        const value = JSON.parse(extraction.content) as T;
        const recovered =
          raw.slice(0, extraction.start).trim().length > 0 || raw.slice(extraction.end).trim().length > 0;
        return { value, recovered };
      } catch (innerError) {
        const message = innerError instanceof Error ? innerError.message : String(innerError);
        throw new Error(`Invalid JSON in ${filePath}: ${message}`);
      }
    }
  }

  private extractFirstContainer(
    raw: string,
    openChar: "[" | "{",
    closeChar: "]" | "}",
  ): { content: string; start: number; end: number } | null {
    const start = raw.search(/\S/u);
    if (start < 0 || raw[start] !== openChar) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (char === "\\") {
          escaping = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === openChar) {
        depth += 1;
        continue;
      }
      if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return {
            content: raw.slice(start, index + 1),
            start,
            end: index + 1,
          };
        }
      }
    }

    return null;
  }
}
