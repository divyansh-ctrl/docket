import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { AGENT_MODELS, type AgentId, type AgentModel, AGENT_ROSTER } from "../shared/agent-roster";
import type { DesktopConfig, ProviderId, WorkspaceDescriptor } from "../shared/ipc-contract";

type StoredConfig = {
  schemaVersion: 2;
  selectedProvider: ProviderId;
  workspace: WorkspaceDescriptor | null;
  /** Per-agent model overrides. Absent means the agent keeps its default. */
  agentModels: Partial<Record<AgentId, AgentModel>>;
  /** True once the tour has been finished or skipped; it never reappears. */
  setupComplete: boolean;
};

const DEFAULT_CONFIG: StoredConfig = {
  schemaVersion: 2,
  selectedProvider: "codex",
  workspace: null,
  agentModels: {},
  setupComplete: false,
};

const KNOWN_AGENT_IDS = new Set<string>(AGENT_ROSTER.map((entry) => entry.id));
const KNOWN_MODELS = new Set<string>(AGENT_MODELS);

export class ConfigStore {
  readonly #filePath: string;
  #config: StoredConfig = structuredClone(DEFAULT_CONFIG);

  constructor(userDataPath: string) {
    this.#filePath = join(userDataPath, "docket-config.json");
  }

  async load(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.#filePath, "utf8")) as Partial<StoredConfig>;
      this.#config = {
        schemaVersion: 2,
        selectedProvider: value.selectedProvider === "claude" ? "claude" : "codex",
        workspace: isStoredWorkspace(value.workspace) ? Object.freeze({ ...value.workspace }) : null,
        // Unknown agents and models are dropped rather than carried: a stale
        // override would otherwise be written into a real subagent file, where
        // an invalid model is only discovered at spawn time.
        agentModels: readAgentModels(value.agentModels),
        setupComplete: value.setupComplete === true,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Ignoring invalid Docket configuration");
      }
      this.#config = structuredClone(DEFAULT_CONFIG);
    }
  }

  read(): DesktopConfig {
    return Object.freeze({
      selectedProvider: this.#config.selectedProvider,
      workspace: this.#config.workspace ? Object.freeze({ ...this.#config.workspace }) : null,
      agentModels: Object.freeze({ ...this.#config.agentModels }),
      setupComplete: this.#config.setupComplete,
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

  async updateAgentModel(agentId: AgentId, model: AgentModel): Promise<DesktopConfig> {
    if (!KNOWN_AGENT_IDS.has(agentId)) throw new Error(`Unknown agent: ${agentId}`);
    if (!KNOWN_MODELS.has(model)) throw new Error(`Unknown model: ${model}`);
    this.#config.agentModels = { ...this.#config.agentModels, [agentId]: model };
    await this.#save();
    return this.read();
  }

  async completeSetup(): Promise<DesktopConfig> {
    this.#config.setupComplete = true;
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

function readAgentModels(value: unknown): Partial<Record<AgentId, AgentModel>> {
  if (!value || typeof value !== "object") return {};
  const result: Partial<Record<AgentId, AgentModel>> = {};
  for (const [key, model] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_AGENT_IDS.has(key)) continue;
    if (typeof model !== "string" || !KNOWN_MODELS.has(model)) continue;
    result[key as AgentId] = model as AgentModel;
  }
  return result;
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
