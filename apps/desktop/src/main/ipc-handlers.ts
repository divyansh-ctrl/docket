import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import type {
  LoginRequest,
  ProviderId,
  SessionStartRequest,
  TerminalDataEvent,
  TerminalExitEvent,
} from "../shared/ipc-contract";
import { IPC_CHANNELS } from "../shared/ipc-contract";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ConfigStore } from "./config-store";
import { ProviderResolver } from "./provider-resolver";
import { PtyManager } from "./pty-manager";
import {
  assertOpaqueId,
  assertProviderId,
  assertWorkspaceStillAuthorized,
  canonicalizeWorkspace,
} from "./validation";
import { isTrustedRendererUrl, parseAllowlistedDocsUrl } from "./security-policy";

type Dependencies = Readonly<{
  configStore: ConfigStore;
  mainWindow: BrowserWindow;
  providerResolver: ProviderResolver;
  ptyManager: PtyManager;
  trustedRendererUrl: string;
}>;

export function registerIpcHandlers(dependencies: Dependencies): () => void {
  const { configStore, mainWindow, providerResolver, ptyManager, trustedRendererUrl } = dependencies;
  const channels = Object.values(IPC_CHANNELS).filter(
    (channel) => channel !== IPC_CHANNELS.terminalData && channel !== IPC_CHANNELS.terminalExit,
  );

  const handle = <T extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: T) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertTrustedSender(event, mainWindow.webContents, trustedRendererUrl);
      return listener(event, ...(args as T));
    });
  };

  handle(IPC_CHANNELS.runtimeInfo, () => ({
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    version: app.getVersion(),
  }));
  handle(IPC_CHANNELS.configRead, () => configStore.read());
  handle(IPC_CHANNELS.configUpdateController, (_event, provider: unknown) =>
    configStore.updateController(assertProviderId(provider)),
  );
  handle(IPC_CHANNELS.workspaceRead, () => configStore.read().workspace);
  handle(IPC_CHANNELS.workspaceChoose, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose an AOS workspace",
      buttonLabel: "Authorize workspace",
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: false,
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const workspace = await canonicalizeWorkspace(result.filePaths[0]);
    await configStore.updateWorkspace(workspace);
    return workspace;
  });
  handle(IPC_CHANNELS.workspaceSelect, async (_event, workspaceId: unknown) => {
    const id = assertOpaqueId(workspaceId, "workspace id");
    const workspace = configStore.read().workspace;
    if (!workspace || workspace.id !== id) throw new Error("Workspace is not authorized");
    return assertWorkspaceStillAuthorized(workspace);
  });
  handle(IPC_CHANNELS.providersDetect, () =>
    Promise.all([providerResolver.detect("codex"), providerResolver.detect("claude")]),
  );
  handle(IPC_CHANNELS.providerStatus, (_event, provider: unknown) =>
    providerResolver.status(assertProviderId(provider)),
  );
  handle(IPC_CHANNELS.providerLoginStart, async (event, value: unknown) => {
    const request = parseLoginRequest(value);
    const executable = await requireExecutable(providerResolver, request.provider);
    const cwd = join(app.getPath("sessionData"), "login-cwd");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    const args = loginArgs(request);
    return ptyManager.start({
      provider: request.provider,
      purpose: "login",
      executable: executable.path,
      executableDirectory: executable.executableDirectory,
      runtimeDirectory: executable.runtimeDirectory,
      launchPrefix: executable.launchPrefix,
      args,
      cwd,
      owner: ownerFor(event),
    });
  });
  handle(IPC_CHANNELS.providerLoginCancel, (event, terminalId: unknown) => {
    ptyManager.stop(ownerFor(event), terminalId);
  });
  handle(IPC_CHANNELS.sessionStart, async (event, value: unknown) => {
    const request = parseSessionRequest(value);
    const workspace = configStore.read().workspace;
    if (!workspace || workspace.id !== request.workspaceId) throw new Error("Workspace is not authorized");
    const verifiedWorkspace = await assertWorkspaceStillAuthorized(workspace);
    if (request.provider === "claude") {
      const status = await providerResolver.status("claude");
      const explicitlyAllowedLocalPreview =
        !app.isPackaged && process.env.AOS_ALLOW_CLAUDE_LOCAL_PREVIEW === "1";
      if (status.authMethod !== "claude-console" && !explicitlyAllowedLocalPreview) {
        throw new Error(
          status.authMethod === "claude-subscription"
            ? "Claude subscription sessions are local-preview only and disabled in this distributable app"
            : "Claude Console authentication could not be verified; reconnect with Claude Console before starting",
        );
      }
    }
    const executable = await requireExecutable(providerResolver, request.provider);
    return ptyManager.start({
      provider: request.provider,
      purpose: "session",
      executable: executable.path,
      executableDirectory: executable.executableDirectory,
      runtimeDirectory: executable.runtimeDirectory,
      launchPrefix: executable.launchPrefix,
      args: [],
      cwd: verifiedWorkspace.path,
      owner: ownerFor(event),
      cols: request.cols,
      rows: request.rows,
    });
  });
  handle(IPC_CHANNELS.sessionInterrupt, (event, terminalId: unknown) => {
    ptyManager.interrupt(ownerFor(event), terminalId);
  });
  handle(IPC_CHANNELS.sessionStop, (event, terminalId: unknown) => {
    ptyManager.stop(ownerFor(event), terminalId);
  });
  handle(IPC_CHANNELS.terminalWrite, (event, terminalId: unknown, data: unknown) => {
    ptyManager.write(ownerFor(event), terminalId, data);
  });
  handle(
    IPC_CHANNELS.terminalResize,
    (event, terminalId: unknown, cols: unknown, rows: unknown) => {
      ptyManager.resize(ownerFor(event), terminalId, cols, rows);
    },
  );
  handle(IPC_CHANNELS.externalOpenDocs, async (_event, value: unknown) => {
    const url = parseAllowlistedDocsUrl(value);
    await shell.openExternal(url.toString(), { activate: true });
  });

  const onTerminalData = (
    owner: { webContentsId: number; frameRoutingId: number },
    payload: TerminalDataEvent,
  ) => sendToOwner(mainWindow.webContents, owner, IPC_CHANNELS.terminalData, payload);
  const onTerminalExit = (
    owner: { webContentsId: number; frameRoutingId: number },
    payload: TerminalExitEvent,
  ) => sendToOwner(mainWindow.webContents, owner, IPC_CHANNELS.terminalExit, payload);
  ptyManager.on("data", onTerminalData);
  ptyManager.on("exit", onTerminalExit);

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
    ptyManager.off("data", onTerminalData);
    ptyManager.off("exit", onTerminalExit);
  };
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expected: WebContents,
  trustedRendererUrl: string,
): void {
  const frame = event.senderFrame;
  if (
    event.sender.id !== expected.id ||
    !frame ||
    frame !== expected.mainFrame ||
    frame.top !== frame ||
    !isTrustedRendererUrl(frame.url, trustedRendererUrl)
  ) {
    throw new Error("Rejected IPC from an untrusted renderer");
  }
}

function ownerFor(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (!frame) throw new Error("Renderer frame is unavailable");
  return Object.freeze({ webContentsId: event.sender.id, frameRoutingId: frame.routingId });
}

function sendToOwner(
  webContents: WebContents,
  owner: { webContentsId: number; frameRoutingId: number },
  channel: string,
  payload: unknown,
): void {
  if (webContents.isDestroyed() || webContents.id !== owner.webContentsId) return;
  const mainFrame = webContents.mainFrame;
  if (mainFrame.isDestroyed() || mainFrame.routingId !== owner.frameRoutingId) return;
  mainFrame.send(channel, payload);
}

function parseLoginRequest(value: unknown): LoginRequest {
  if (!value || typeof value !== "object") throw new TypeError("Invalid login request");
  const candidate = value as Record<string, unknown>;
  const provider = assertProviderId(candidate.provider);
  if (provider === "codex" && candidate.method === "browser") return { provider, method: "browser" };
  if (
    provider === "claude" &&
    (candidate.method === "console" || candidate.method === "local-preview")
  ) {
    return { provider, method: candidate.method };
  }
  throw new TypeError("Unsupported login method");
}

function loginArgs(request: LoginRequest): readonly string[] {
  if (request.provider === "codex") return ["login"];
  if (request.method === "console") return ["auth", "login", "--console"];
  return ["auth", "login", "--claudeai"];
}

function parseSessionRequest(value: unknown): SessionStartRequest {
  if (!value || typeof value !== "object") throw new TypeError("Invalid session request");
  const candidate = value as Record<string, unknown>;
  return {
    provider: assertProviderId(candidate.provider),
    workspaceId: assertOpaqueId(candidate.workspaceId, "workspace id"),
    cols: candidate.cols === undefined ? undefined : Number(candidate.cols),
    rows: candidate.rows === undefined ? undefined : Number(candidate.rows),
  };
}

async function requireExecutable(resolver: ProviderResolver, provider: ProviderId) {
  const executable = await resolver.resolve(provider, true);
  if (!executable) throw new Error(`${provider} CLI is not installed`);
  return executable;
}
