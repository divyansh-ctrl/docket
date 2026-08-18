import type { AgentId, AgentModel } from "./agent-roster";
import type { CheckDiscovery, CheckResult } from "./checks";
import type { Decision, SealedRecord, Verification } from "./decision";
import type { EvidencePacket } from "./evidence";

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

/** What the open change is meant to do, bound to the workspace it describes. */
export type RecordedIntent = Readonly<{
  workspaceId: string;
  text: string;
  recordedAt: number;
}>;

export type DesktopConfig = Readonly<{
  selectedProvider: ProviderId;
  workspace: WorkspaceDescriptor | null;
  /** Per-agent model overrides. An absent entry means the agent's default. */
  agentModels: Readonly<Partial<Record<AgentId, AgentModel>>>;
  setupComplete: boolean;
  /** Null when nothing has been stated for the open workspace. */
  intent: RecordedIntent | null;
  /** When true, a check is refused rather than run uncontained. */
  requireIsolation: boolean;
}>;

/**
 * Every sealed decision for the open repository, plus the repository as it is
 * now. Both are needed together: a record only means something next to the
 * tree it is being compared against.
 */
export type DecisionView = Readonly<{
  records: readonly SealedRecord[];
  verification: Verification;
  /** Set when the log could not be read at all, as distinct from being empty. */
  unavailable: string | null;
  current: Readonly<{ head: string | null; treeDigest: string | null }>;
}>;

/** Whether checks can be contained right now, and what the user asked for. */
export type IsolationStatus = Readonly<{
  /** The runtime found, or null when there is none. */
  runtime: string | null;
  /** Why there is none, for the reader. Empty when one was found. */
  reason: string;
  /** The user's setting, not a description of what is available. */
  required: boolean;
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

/** One subagent lifecycle event, as reported by the CLI's own hooks. */
export type AgentActivity = Readonly<{
  kind: "start" | "stop";
  agentId: AgentId;
  runId: string;
  summary: string | null;
  at: number;
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

/** One chunk of a check's output, forwarded while the check is still running. */
export type CheckOutputEvent = Readonly<{
  checkId: string;
  chunk: string;
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
    /** Subagent starts and stops, for as long as a workspace is open. */
    onActivity(listener: (event: AgentActivity) => void): Unsubscribe;
  };
  checks: {
    /**
     * Finds the checks the open repository declares for itself, and whether
     * their definitions differ from the committed ones. Resolves null when no
     * workspace is open.
     */
    discover(): Promise<CheckDiscovery | null>;
    /** Runs one discovered check and resolves with what actually happened. */
    run(checkId: string): Promise<CheckResult>;
    /** Kills a running check and everything it spawned. */
    cancel(checkId: string): Promise<void>;
    /**
     * Whether a container runtime is usable right now. Probed rather than
     * remembered, so plugging in Docker mid-session is noticed.
     */
    isolation(): Promise<IsolationStatus>;
    /** Turns the fail-closed requirement on or off. */
    setRequireIsolation(required: boolean): Promise<DesktopConfig>;
    /** Output as it is produced, so a slow check is not a blank pane. */
    onOutput(listener: (event: CheckOutputEvent) => void): Unsubscribe;
  };
  evidence: {
    /**
     * Assembles the packet from what changed, what the checks proved, and what
     * else references it. `results` carries the runs from this session, since
     * the main process does not keep them. Resolves null with no workspace.
     */
    build(intent: string, results: readonly CheckResult[]): Promise<EvidencePacket | null>;
    /** Records what this change is meant to do. Empty text clears it. */
    setIntent(text: string): Promise<DesktopConfig>;
  };
  decisions: {
    /** Every sealed record for the open repository. Null with no workspace. */
    read(): Promise<DecisionView | null>;
    /**
     * Freezes a freshly built packet together with this answer and appends it.
     *
     * The packet is rebuilt here rather than taken from the renderer, so the
     * record describes the repository as it is at the moment of the decision.
     * `results` carries the runs from this session, which the main process does
     * not keep.
     */
    seal(
      decision: Decision,
      note: string,
      intent: string,
      results: readonly CheckResult[],
    ): Promise<SealedRecord | null>;
    /** Writes one record out as Markdown. Resolves null if the save is cancelled. */
    export(digest: string): Promise<string | null>;
  };
  setup: {
    /** Marks the tour finished or skipped. It does not reappear. */
    complete(): Promise<DesktopConfig>;
  };
  workspace: {
    choose(): Promise<WorkspaceDescriptor | null>;
    read(): Promise<WorkspaceDescriptor | null>;
    select(workspaceId: string): Promise<WorkspaceDescriptor>;
    /**
     * The application menu asking for the folder picker.
     *
     * Main sends rather than renderer polls, because the menu lives in the main
     * process and an accelerator has to work whether or not the header button
     * is reachable -- which is the whole reason this exists. The payload is
     * empty: it is a request, and the renderer already owns what to do with it.
     */
    onOpenRequest(listener: () => void): Unsubscribe;
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
  workspaceOpenRequest: "docket:workspace:open-request",
  agentsTeam: "docket:agents:team",
  agentsSetModel: "docket:agents:set-model",
  agentsActivity: "docket:agents:activity",
  checksDiscover: "docket:checks:discover",
  checksRun: "docket:checks:run",
  checksCancel: "docket:checks:cancel",
  checksOutput: "docket:checks:output",
  checksIsolation: "docket:checks:isolation",
  checksSetRequireIsolation: "docket:checks:set-require-isolation",
  evidenceBuild: "docket:evidence:build",
  evidenceSetIntent: "docket:evidence:set-intent",
  decisionsRead: "docket:decisions:read",
  decisionsSeal: "docket:decisions:seal",
  decisionsExport: "docket:decisions:export",
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
