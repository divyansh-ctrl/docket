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

export interface AosDesktopApi {
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
  runtimeInfo: "aos:runtime:info",
  configRead: "aos:config:read",
  configUpdateController: "aos:config:update-controller",
  workspaceChoose: "aos:workspace:choose",
  workspaceRead: "aos:workspace:read",
  workspaceSelect: "aos:workspace:select",
  providersDetect: "aos:providers:detect",
  providerStatus: "aos:provider:status",
  providerLoginStart: "aos:provider:login:start",
  providerLoginCancel: "aos:provider:login:cancel",
  sessionStart: "aos:session:start",
  sessionInterrupt: "aos:session:interrupt",
  sessionStop: "aos:session:stop",
  terminalWrite: "aos:terminal:write",
  terminalResize: "aos:terminal:resize",
  terminalData: "aos:terminal:data",
  terminalExit: "aos:terminal:exit",
  externalOpenDocs: "aos:external:open-docs",
} as const;
