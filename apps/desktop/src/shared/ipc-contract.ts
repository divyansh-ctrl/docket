import type { AgentId, AgentModel } from "./agent-roster";

export type ProviderId = "codex" | "claude";

export type ClaudeLoginMethod = "console" | "local-preview";

export type LoginRequest =
  | { provider: "codex"; method: "browser" }
  | { provider: "claude"; method: ClaudeLoginMethod };

export type TerminalPurpose = "login" | "session";

export type WorkspaceDescriptor = Readonly<{
  id: string;
  name: string;
  path: string;
}>;

export type DesktopConfig = Readonly<{
  selectedProvider: ProviderId;
  workspace: WorkspaceDescriptor | null;
  /** Per-agent model overrides. An absent entry means the agent's default. */
  agentModels: Readonly<Partial<Record<AgentId, AgentModel>>>;
  setupComplete: boolean;
}>;

export type AgentTeamMember = Readonly<{
  id: AgentId;
  /** Why this agent is on the team, in the user's language. */
  reason: string;
  /** The paths or packages that justified it. Empty for core agents. */
  evidence: readonly string[];
  /** Resolved: the override if set, otherwise the agent's default. */
  model: AgentModel;
}>;

export type AgentTeam = Readonly<{
  workspaceId: string;
  members: readonly AgentTeamMember[];
  /** Agent files Docket wrote into the repository. */
  written: readonly string[];
  /** Files left alone because a person wrote them. */
  skipped: readonly string[];
}>;

export type ProviderDetection = Readonly<{
  provider: ProviderId;
  available: boolean;
  version: string | null;
  executableSource: "path" | "known-location" | null;
}>;

export type ProviderStatus = ProviderDetection &
  Readonly<{
    authenticated: boolean;
    authLabel: string;
    authMethod: "codex" | "claude-console" | "claude-subscription" | "unknown" | null;
    productionRecommended: boolean;
  }>;

export type TerminalStartResult = Readonly<{
  terminalId: string;
  provider: ProviderId;
  purpose: TerminalPurpose;
}>;

export type TerminalDataEvent = Readonly<{
  terminalId: string;
  data: string;
}>;

export type TerminalExitEvent = Readonly<{
  terminalId: string;
  exitCode: number;
  signal: number | null;
  reason: "exited" | "stopped" | "window-closed" | "app-quit";
}>;

export type SessionStartRequest = Readonly<{
  provider: ProviderId;
  workspaceId: string;
  cols?: number;
  rows?: number;
}>;

export type RuntimeInfo = Readonly<{
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  version: string;
}>;

export type Unsubscribe = () => void;

export interface DocketDesktopApi {
  /**
   * Available synchronously so the window chrome can reserve space for the
   * platform's native controls on the first paint, before any IPC resolves.
   */
  platform: NodeJS.Platform;
  runtime: {
    info(): Promise<RuntimeInfo>;
  };
  config: {
    read(): Promise<DesktopConfig>;
    updateController(provider: ProviderId): Promise<DesktopConfig>;
  };
  agents: {
    /**
     * Detects the team for the current workspace and writes their role files.
     * Resolves null when no workspace is open.
     */
    team(): Promise<AgentTeam | null>;
    setModel(agentId: AgentId, model: AgentModel): Promise<DesktopConfig>;
  };
  setup: {
    /** Marks the tour finished or skipped. It does not reappear. */
    complete(): Promise<DesktopConfig>;
  };
  workspace: {
    choose(): Promise<WorkspaceDescriptor | null>;
    read(): Promise<WorkspaceDescriptor | null>;
    select(workspaceId: string): Promise<WorkspaceDescriptor>;
  };
  providers: {
    detect(): Promise<ProviderDetection[]>;
    status(provider: ProviderId): Promise<ProviderStatus>;
    login: {
      start(request: LoginRequest): Promise<TerminalStartResult>;
      cancel(terminalId: string): Promise<void>;
    };
  };
  sessions: {
    start(request: SessionStartRequest): Promise<TerminalStartResult>;
    interrupt(terminalId: string): Promise<void>;
    stop(terminalId: string): Promise<void>;
  };
  terminal: {
    write(terminalId: string, data: string): Promise<void>;
    resize(terminalId: string, cols: number, rows: number): Promise<void>;
    onData(listener: (event: TerminalDataEvent) => void): Unsubscribe;
    onExit(listener: (event: TerminalExitEvent) => void): Unsubscribe;
  };
  external: {
    openDocs(url: string): Promise<void>;
  };
}

export const IPC_CHANNELS = {
  runtimeInfo: "docket:runtime:info",
  configRead: "docket:config:read",
  configUpdateController: "docket:config:update-controller",
  workspaceChoose: "docket:workspace:choose",
  workspaceRead: "docket:workspace:read",
  workspaceSelect: "docket:workspace:select",
  agentsTeam: "docket:agents:team",
  agentsSetModel: "docket:agents:set-model",
  setupComplete: "docket:setup:complete",
  providersDetect: "docket:providers:detect",
  providerStatus: "docket:provider:status",
  providerLoginStart: "docket:provider:login:start",
  providerLoginCancel: "docket:provider:login:cancel",
  sessionStart: "docket:session:start",
  sessionInterrupt: "docket:session:interrupt",
  sessionStop: "docket:session:stop",
  terminalWrite: "docket:terminal:write",
  terminalResize: "docket:terminal:resize",
  terminalData: "docket:terminal:data",
  terminalExit: "docket:terminal:exit",
  externalOpenDocs: "docket:external:open-docs",
} as const;
