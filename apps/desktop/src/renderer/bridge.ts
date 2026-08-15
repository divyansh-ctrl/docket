import type {
  AgentActivity,
  DocketDesktopApi,
  DesktopConfig,
  LoginRequest,
  ProviderDetection,
  ProviderId,
  ProviderStatus,
  RuntimeInfo,
  SessionStartRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResult,
  WorkspaceDescriptor,
} from "../shared/ipc-contract";
import { agent } from "../shared/agent-roster";
import { detectAgents } from "../shared/detect-agents";

export type {
  DesktopConfig,
  LoginRequest,
  ProviderId,
  TerminalStartResult,
  WorkspaceDescriptor,
} from "../shared/ipc-contract";

export type ProviderState =
  | "missing"
  | "installed_unauthenticated"
  | "authenticating"
  | "authenticated"
  | "expired"
  | "error";

export type ProviderViewStatus = ProviderStatus & {
  state: ProviderState;
  message?: string;
};

let previewConfig: DesktopConfig = {
  selectedProvider: "codex",
  workspace: null,
  agentModels: {},
  setupComplete: false,
  intent: null,
  requireIsolation: false,
};

/**
 * The preview has no filesystem, so it stands in a plausible repository and
 * runs the real detection over it. Exercising the actual rules is the point:
 * a preview that returned a hand-written team would hide exactly the bug that
 * matters, which is a signal that stops matching.
 */
const PREVIEW_FILES = [
  "package.json",
  "app/routes/session.tsx",
  "app/styles/tokens.css",
  "src/auth/refresh.ts",
  "src/dispatch/lease.ts",
  "prisma/schema.prisma",
  "tests/auth/rotation.test.ts",
  ".github/workflows/ci.yml",
  "docs/migration-v2.md",
  "README.md",
];
const PREVIEW_DEPENDENCIES = ["react", "prisma", "vitest", "jsonwebtoken"];

let previewStatuses: Record<ProviderId, ProviderStatus> = {
  codex: {
    provider: "codex",
    available: true,
    version: "browser-preview",
    executableSource: "known-location",
    authenticated: false,
    authLabel: "Simulated — no credential",
    authMethod: null,
    productionRecommended: true,
  },
  claude: {
    provider: "claude",
    available: true,
    version: "browser-preview",
    executableSource: "known-location",
    authenticated: false,
    authLabel: "Simulated — no credential",
    authMethod: null,
    productionRecommended: true,
  },
};

const previewDataListeners = new Set<(event: TerminalDataEvent) => void>();
const previewExitListeners = new Set<(event: TerminalExitEvent) => void>();
const previewTimers = new Map<string, number[]>();
const previewSessionIds = new Set<string>();

function previewDetection(status: ProviderStatus): ProviderDetection {
  return {
    provider: status.provider,
    available: status.available,
    version: status.version,
    executableSource: status.executableSource,
  };
}

function previewCommand(request: LoginRequest) {
  if (request.provider === "codex") return "codex login";
  return request.method === "console"
    ? "Claude Console connection"
    : "claude auth login · local preview only";
}

function startPreviewLogin(request: LoginRequest): TerminalStartResult {
  const terminalId = `browser-preview-${request.provider}-${Date.now()}`;
  const command = previewCommand(request);
  const provider = request.provider;
  const messages = [
    "[BROWSER PREVIEW — NO PROVIDER PROCESS OR CREDENTIAL]\r\n",
    `Purpose-bound demonstration: ${command}\r\n`,
    request.provider === "claude" && request.method === "console"
      ? "Claude Console is the production-recommended third-party connection path.\r\n"
      : "This flow is simulated and cannot authenticate an account.\r\n",
    "Preview flow complete. Nothing was created, stored, or sent.\r\n",
  ];

  const timers = messages.map((data, index) =>
    window.setTimeout(() => {
      previewDataListeners.forEach((listener) => listener({ terminalId, data }));
      if (index === messages.length - 1) {
        previewStatuses = {
          ...previewStatuses,
          [provider]: {
            ...previewStatuses[provider],
            authenticated: true,
            authLabel: "Preview only — simulated",
            authMethod: null,
          },
        };
        previewExitListeners.forEach((listener) =>
          listener({
            terminalId,
            exitCode: 0,
            signal: null,
            reason: "exited",
          }),
        );
      }
    }, 240 + index * 620),
  );
  previewTimers.set(terminalId, timers);
  return { terminalId, provider, purpose: "login" };
}

const browserPreviewApi: DocketDesktopApi = {
  platform: "darwin",
  runtime: {
    async info(): Promise<RuntimeInfo> {
      return {
        platform: "darwin",
        arch: "browser-preview",
        packaged: false,
        version: "browser-preview",
      };
    },
  },
  config: {
    async read() {
      return previewConfig;
    },
    async updateController(provider) {
      previewConfig = { ...previewConfig, selectedProvider: provider };
      return previewConfig;
    },
  },
  agents: {
    async team() {
      if (!previewConfig.workspace) return null;
      const members = detectAgents({ files: PREVIEW_FILES, dependencies: PREVIEW_DEPENDENCIES }).map(
        (selection) => ({
          ...selection,
          model: previewConfig.agentModels[selection.id] ?? agent(selection.id).defaultModel,
        }),
      );
      // Nothing is written in the preview; the repository is imaginary.
      return { workspaceId: previewConfig.workspace.id, members, written: [], skipped: [] };
    },
    onActivity(listener) {
      // The preview has no CLI, so it replays a short sequence shaped exactly
      // like the hook payloads. Without it the live presence path could only
      // be exercised by building and running Electron against a real session.
      const script: Array<[number, AgentActivity]> = [
        [600, { kind: "start", agentId: "lead", runId: "p1", summary: null, at: Date.now() }],
        [1800, { kind: "start", agentId: "engineer", runId: "p2", summary: null, at: Date.now() }],
        [3200, { kind: "stop", agentId: "lead", runId: "p1", summary: "Split into three units.", at: Date.now() }],
        [4400, { kind: "start", agentId: "tests", runId: "p3", summary: null, at: Date.now() }],
        [6000, { kind: "stop", agentId: "engineer", runId: "p2", summary: "4 files changed in src/auth.", at: Date.now() }],
        [7600, { kind: "stop", agentId: "tests", runId: "p3", summary: "42 of 42 passing.", at: Date.now() }],
      ];
      const timers = script.map(([delay, event]) => window.setTimeout(() => listener(event), delay));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    },
    async setModel(agentId, model) {
      previewConfig = {
        ...previewConfig,
        agentModels: { ...previewConfig.agentModels, [agentId]: model },
      };
      return previewConfig;
    },
  },
  checks: {
    // The preview has no repository and no process to run, so it reports
    // nothing rather than inventing a green suite. A fake passing check is the
    // one thing this product cannot afford to show.
    async discover() {
      return null;
    },
    async run() {
      throw new Error("The browser preview cannot run checks: there is no repository and no process.");
    },
    async cancel() {
      // Nothing runs here, so there is nothing to stop.
    },
    async isolation() {
      // No process, so there is nothing to contain. Reported as no runtime
      // rather than as a container, for the same reason the preview reports no
      // checks: the honest answer is the one that cannot be mistaken for proof.
      return {
        runtime: null,
        reason: "The browser preview has no process to contain and no runtime to detect.",
        required: previewConfig.requireIsolation,
      };
    },
    async setRequireIsolation(required) {
      previewConfig = { ...previewConfig, requireIsolation: required };
      return previewConfig;
    },
    onOutput() {
      return () => {};
    },
  },
  evidence: {
    // No repository, no diff, no checks: there is nothing to assemble a packet
    // from, and inventing one would be the exact failure the packet exists to
    // prevent.
    async build() {
      return null;
    },
    async setIntent() {
      previewConfig = { ...previewConfig, intent: null };
      return previewConfig;
    },
  },
  decisions: {
    // A record seals a packet, and the preview has no packet to seal. An empty
    // log is the honest answer; a demonstration record would be a signed
    // attestation about a repository that does not exist.
    async read() {
      return null;
    },
    async seal() {
      return null;
    },
    async export() {
      return null;
    },
  },
  setup: {
    async complete() {
      previewConfig = { ...previewConfig, setupComplete: true };
      return previewConfig;
    },
  },
  workspace: {
    async choose() {
      const workspace: WorkspaceDescriptor = {
        id: "browser-preview-workspace",
        name: "relay-engineering",
        path: "/Browser preview/relay-engineering",
      };
      previewConfig = { ...previewConfig, workspace };
      return workspace;
    },
    async read() {
      return previewConfig.workspace;
    },
    async select(workspaceId) {
      if (!previewConfig.workspace || previewConfig.workspace.id !== workspaceId) {
        throw new Error("The browser preview recognizes only its simulated workspace.");
      }
      return previewConfig.workspace;
    },
  },
  providers: {
    async detect() {
      return [previewDetection(previewStatuses.codex), previewDetection(previewStatuses.claude)];
    },
    async status(provider) {
      return previewStatuses[provider];
    },
    login: {
      async start(request) {
        return startPreviewLogin(request);
      },
      async cancel(terminalId) {
        previewTimers.get(terminalId)?.forEach((timer) => window.clearTimeout(timer));
        previewTimers.delete(terminalId);
        previewExitListeners.forEach((listener) =>
          listener({
            terminalId,
            exitCode: 130,
            signal: null,
            reason: "stopped",
          }),
        );
      },
    },
  },
  sessions: {
    async start(request: SessionStartRequest) {
      const terminalId = `browser-preview-session-${request.provider}-${Date.now()}`;
      previewSessionIds.add(terminalId);
      window.setTimeout(() => {
        if (!previewSessionIds.has(terminalId)) return;
        previewDataListeners.forEach((listener) =>
          listener({
            terminalId,
            data:
              "\u001b[1;33m[BROWSER PREVIEW — NEW SESSION SIMULATION ONLY]\u001b[0m\r\n" +
              `No ${request.provider} process was started; no existing conversation was attached or resumed.\r\n`,
          }),
        );
      }, 260);
      return {
        terminalId,
        provider: request.provider,
        purpose: "session",
      };
    },
    async interrupt() {
      return;
    },
    async stop(terminalId) {
      if (!previewSessionIds.delete(terminalId)) return;
      window.setTimeout(() => {
        previewExitListeners.forEach((listener) =>
          listener({
            terminalId,
            exitCode: 0,
            signal: null,
            reason: "stopped",
          }),
        );
      }, 180);
    },
  },
  terminal: {
    async write(terminalId, data) {
      previewDataListeners.forEach((listener) => listener({ terminalId, data }));
    },
    async resize() {
      return;
    },
    onData(listener) {
      previewDataListeners.add(listener);
      return () => previewDataListeners.delete(listener);
    },
    onExit(listener) {
      previewExitListeners.add(listener);
      return () => previewExitListeners.delete(listener);
    },
  },
  external: {
    async openDocs() {
      return;
    },
  },
};

export const isBrowserPreview = typeof window.docketDesktop === "undefined";

// One authoritative API shape is used in both Electron and the explicit browser preview.
export const desktopApi: DocketDesktopApi = isBrowserPreview ? browserPreviewApi : window.docketDesktop;

const terminalHistoryLimit = 64_000;
const terminalHistoryCountLimit = 8;
const terminalHistory = new Map<string, string>();
const terminalExits = new Map<string, TerminalExitEvent>();
const terminalDataListeners = new Map<string, Set<(event: TerminalDataEvent) => void>>();
const anyTerminalDataListeners = new Set<(event: TerminalDataEvent) => void>();
const anyTerminalExitListeners = new Set<(event: TerminalExitEvent) => void>();

function trimTerminalMaps() {
  while (terminalHistory.size > terminalHistoryCountLimit) {
    const oldest = terminalHistory.keys().next().value as string | undefined;
    if (!oldest) break;
    terminalHistory.delete(oldest);
    terminalExits.delete(oldest);
  }
  while (terminalExits.size > terminalHistoryCountLimit) {
    const oldest = terminalExits.keys().next().value as string | undefined;
    if (!oldest) break;
    terminalExits.delete(oldest);
  }
}

desktopApi.terminal.onData((event) => {
  const current = terminalHistory.get(event.terminalId) ?? "";
  terminalHistory.delete(event.terminalId);
  terminalHistory.set(
    event.terminalId,
    `${current}${event.data}`.slice(-terminalHistoryLimit),
  );
  trimTerminalMaps();
  terminalDataListeners.get(event.terminalId)?.forEach((listener) => listener(event));
  anyTerminalDataListeners.forEach((listener) => listener(event));
});

desktopApi.terminal.onExit((event) => {
  terminalExits.delete(event.terminalId);
  terminalExits.set(event.terminalId, event);
  trimTerminalMaps();
  anyTerminalExitListeners.forEach((listener) => listener(event));
});

export const terminalEvents = {
  subscribeData(terminalId: string, listener: (event: TerminalDataEvent) => void) {
    const listeners = terminalDataListeners.get(terminalId) ?? new Set();
    listeners.add(listener);
    terminalDataListeners.set(terminalId, listeners);
    const history = terminalHistory.get(terminalId);
    if (history) listener({ terminalId, data: history });
    return () => {
      const current = terminalDataListeners.get(terminalId);
      current?.delete(listener);
      if (!current?.size) terminalDataListeners.delete(terminalId);
    };
  },
  onData(listener: (event: TerminalDataEvent) => void) {
    anyTerminalDataListeners.add(listener);
    return () => anyTerminalDataListeners.delete(listener);
  },
  onExit(listener: (event: TerminalExitEvent) => void) {
    anyTerminalExitListeners.add(listener);
    return () => anyTerminalExitListeners.delete(listener);
  },
  takeEarlyExit(terminalId: string) {
    const event = terminalExits.get(terminalId) ?? null;
    terminalExits.delete(terminalId);
    return event;
  },
  clear(terminalId: string) {
    terminalHistory.delete(terminalId);
    terminalExits.delete(terminalId);
    terminalDataListeners.delete(terminalId);
  },
};

export function toProviderViewStatus(status: ProviderStatus): ProviderViewStatus {
  return {
    ...status,
    state: !status.available
      ? "missing"
      : status.authenticated
        ? "authenticated"
        : "installed_unauthenticated",
    message: isBrowserPreview
      ? "Browser preview only. No executable was inspected and no credential exists."
      : undefined,
  };
}

export async function readProviderStatuses(): Promise<Record<ProviderId, ProviderViewStatus>> {
  await desktopApi.providers.detect();
  const [codex, claude] = await Promise.all([
    desktopApi.providers.status("codex"),
    desktopApi.providers.status("claude"),
  ]);
  return {
    codex: toProviderViewStatus(codex),
    claude: toProviderViewStatus(claude),
  };
}
