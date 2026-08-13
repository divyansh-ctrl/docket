import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { DesktopConfig, ProviderId, WorkspaceDescriptor } from "../shared/ipc-contract";

type StoredConfig = {
  schemaVersion: 1;
  selectedProvider: ProviderId;
  workspace: WorkspaceDescriptor | null;
};

const DEFAULT_CONFIG: StoredConfig = {
  schemaVersion: 1,
  selectedProvider: "codex",
  workspace: null,
};

export class ConfigStore {
  readonly #filePath: string;
  #config: StoredConfig = { ...DEFAULT_CONFIG };

  constructor(userDataPath: string) {
    this.#filePath = join(userDataPath, "aos-config.json");
  }

  async load(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.#filePath, "utf8")) as Partial<StoredConfig>;
      this.#config = {
        schemaVersion: 1,
        selectedProvider: value.selectedProvider === "claude" ? "claude" : "codex",
        workspace: isStoredWorkspace(value.workspace) ? Object.freeze({ ...value.workspace }) : null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Ignoring invalid AOS desktop configuration");
      }
      this.#config = { ...DEFAULT_CONFIG };
    }
  }

  read(): DesktopConfig {
    return Object.freeze({
      selectedProvider: this.#config.selectedProvider,
      workspace: this.#config.workspace ? Object.freeze({ ...this.#config.workspace }) : null,
    });
  }

  async updateController(provider: ProviderId): Promise<DesktopConfig> {
    this.#config.selectedProvider = provider;
    await this.#save();
    return this.read();
  }

  async updateWorkspace(workspace: WorkspaceDescriptor): Promise<DesktopConfig> {
    this.#config.workspace = Object.freeze({ ...workspace });
    await this.#save();
    return this.read();
  }

  async #save(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.#filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.#config, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.#filePath);
  }
}

function isStoredWorkspace(value: unknown): value is WorkspaceDescriptor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.path === "string" &&
    // isAbsolute rather than a leading slash, so Windows paths such as
    // C:\Users\me\project survive a restart instead of being discarded.
    isAbsolute(candidate.path)
  );
}
