import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { AGENT_MODELS, type AgentId, type AgentModel, AGENT_ROSTER } from "../shared/agent-roster";
import { type McpServer, readServers } from "../shared/mcp-config";
import type {
  DesktopConfig,
  ProviderId,
  RecordedIntent,
  WorkspaceDescriptor,
} from "../shared/ipc-contract";

type StoredConfig = {
  schemaVersion: 3;
  selectedProvider: ProviderId;
  workspace: WorkspaceDescriptor | null;
  /** Per-agent model overrides. Absent means the agent keeps its default. */
  agentModels: Partial<Record<AgentId, AgentModel>>;
  /** True once the tour has been finished or skipped; it never reappears. */
  setupComplete: boolean;
  /**
   * What the open change is meant to accomplish, bound to the workspace it was
   * written for. The binding is the point: showing one repository's stated
   * intent beside another repository's diff would attach a purpose to a change
   * that never had it, which misleads a reviewer worse than no intent at all.
   */
  intent: RecordedIntent | null;
  /**
   * Whether a check may fall back to running on this machine when no container
   * runtime is available. False by default: most machines have no runtime, and
   * a gate that refuses to run for everyone on first launch gates nothing.
   */
  requireIsolation: boolean;
  /**
   * MCP servers Docket manages. Held here rather than read back from the two
   * CLI files because those disagree: a server can exist in one and not the
   * other, and neither can hold every field. This is the source of truth and
   * both files are projections of it.
   */
  mcpServers: readonly McpServer[];
};

const DEFAULT_CONFIG: StoredConfig = {
  schemaVersion: 3,
  selectedProvider: "codex",
  workspace: null,
  agentModels: {},
  setupComplete: false,
  intent: null,
  requireIsolation: false,
  mcpServers: [],
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
        schemaVersion: 3,
        selectedProvider: value.selectedProvider === "claude" ? "claude" : "codex",
        workspace: isStoredWorkspace(value.workspace) ? Object.freeze({ ...value.workspace }) : null,
        // Unknown agents and models are dropped rather than carried: a stale
        // override would otherwise be written into a real subagent file, where
        // an invalid model is only discovered at spawn time.
        agentModels: readAgentModels(value.agentModels),
        setupComplete: value.setupComplete === true,
        intent: readIntent(value.intent),
        // A stricter setting is never inferred from a malformed file: only an
        // explicit `true` turns it on, so a corrupt config cannot leave someone
        // unable to run a check with no visible reason why.
        requireIsolation: value.requireIsolation === true,
        // Same discipline as the agent models above: a server that does not
        // survive validation is dropped rather than carried, because a
        // half-understood one would be written into a real .mcp.json and
        // discovered when an agent could not start.
        mcpServers: readServers(value.mcpServers),
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
      requireIsolation: this.#config.requireIsolation,
      mcpServers: this.#config.mcpServers,
      // Only surfaced for the workspace it was written against.
      intent:
        this.#config.intent && this.#config.intent.workspaceId === this.#config.workspace?.id
          ? Object.freeze({ ...this.#config.intent })
          : null,
    });
  }

  async updateController(provider: ProviderId): Promise<DesktopConfig> {
    this.#config.selectedProvider = provider;
    await this.#save();
    return this.read();
  }

  async updateWorkspace(workspace: WorkspaceDescriptor): Promise<DesktopConfig> {
    // Opening a different repository drops the intent rather than carrying it:
    // it described a change that is not the one now on screen.
    if (this.#config.intent && this.#config.intent.workspaceId !== workspace.id) {
      this.#config.intent = null;
    }
    this.#config.workspace = Object.freeze({ ...workspace });
    await this.#save();
    return this.read();
  }

  /** Records the intent against the open workspace. Empty text clears it. */
  async updateIntent(text: string, recordedAt: number): Promise<DesktopConfig> {
    const workspace = this.#config.workspace;
    if (!workspace) throw new Error("No repository is open");

    const trimmed = text.trim().slice(0, MAX_INTENT_LENGTH);
    this.#config.intent = trimmed.length === 0
      ? null
      : Object.freeze({ workspaceId: workspace.id, text: trimmed, recordedAt });
    await this.#save();
    return this.read();
  }

  /** Turns the fail-closed isolation requirement on or off. */
  async updateRequireIsolation(required: boolean): Promise<DesktopConfig> {
    this.#config.requireIsolation = required;
    await this.#save();
    return this.read();
  }

  /** Replaces the managed set wholesale; the tab always sends the full list. */
  async updateMcpServers(servers: readonly McpServer[]): Promise<DesktopConfig> {
    this.#config.mcpServers = readServers(servers);
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

/** Long enough for a real brief, bounded so the config file stays a config file. */
const MAX_INTENT_LENGTH = 2000;

function readIntent(value: unknown): RecordedIntent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.workspaceId !== "string") return null;
  if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) return null;
  return Object.freeze({
    workspaceId: candidate.workspaceId,
    text: candidate.text.slice(0, MAX_INTENT_LENGTH),
    recordedAt: typeof candidate.recordedAt === "number" ? candidate.recordedAt : 0,
  });
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
