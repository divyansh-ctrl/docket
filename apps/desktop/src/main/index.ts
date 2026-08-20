import { app, BrowserWindow, Menu, nativeTheme, safeStorage, session, shell, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigStore } from "./config-store";
import { registerIpcHandlers } from "./ipc-handlers";
import { SecretStore } from "./secret-store";
import { ProviderResolver } from "./provider-resolver";
import { PtyManager } from "./pty-manager";
import { isAllowlistedDocsUrl, isTrustedRendererUrl } from "./security-policy";
import { IPC_CHANNELS } from "../shared/ipc-contract";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let disposeIpc: (() => void) | null = null;
const ptyManager = new PtyManager();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(buildApplicationMenu).then(createMainWindow).catch((error: unknown) => {
    console.error("Docket failed to start", safeErrorMessage(error));
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * The application menu, which exists for one reason: opening a repository must
 * not depend on hitting a button.
 *
 * Before this there was no menu at all, so Electron supplied its default and
 * File held nothing but "Close Window". The only way to authorize a workspace
 * was a single control in the top-left of the header -- no accelerator, no menu
 * item, and nothing at all once the setup sheet had ticked that step. One
 * floating overlay parked over that corner, which is where overlays live, and
 * the app became unusable with no way back.
 *
 * Everything here is a request to the focused window. The main process does not
 * open the picker itself, because the renderer owns what happens afterwards --
 * reloading the team, reseeding the room -- and splitting that across the wall
 * would give two paths for one action.
 */
function buildApplicationMenu(): void {
  const openRepository = () => {
    // Both guards, for the same reason the streaming sends carry both: a menu
    // item stays clickable for a moment after its window has gone.
    const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return;
    target.webContents.send(IPC_CHANNELS.workspaceOpenRequest);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? ([{ role: "appMenu" }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Repository…",
          accelerator: "CmdOrCtrl+O",
          click: openRepository,
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error: unknown) => console.error("Docket failed to open", safeErrorMessage(error)));
  }
});

app.on("before-quit", () => {
  disposeIpc?.();
  disposeIpc = null;
  ptyManager.forceStopAll("app-quit");
});

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const preloadPath = join(__dirname, "preload.cjs");
  const packagedRendererPath = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const trustedRendererUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL ?? pathToFileURL(packagedRendererPath).href;
  const window = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f4f2fa",
    show: false,
    title: "Docket",
    autoHideMenuBar: true,
    ...windowChrome(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  mainWindow = window;

  const configStore = new ConfigStore(app.getPath("userData"));
  await configStore.load();
  // Constructed after `ready`: on Linux the backend is `unknown` until then,
  // and a store that reported "unknown" once would keep saying so.
  const secretStore = new SecretStore(app.getPath("userData"), safeStorage);
  await secretStore.load();
  disposeIpc?.();
  disposeIpc = registerIpcHandlers({
    configStore,
    secretStore,
    mainWindow: window,
    providerResolver: new ProviderResolver(),
    ptyManager,
    trustedRendererUrl,
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowlistedDocsUrl(url)) void shell.openExternal(url, { activate: true });
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  // Captured while the window is alive. Electron's "closed" fires *after* the
  // window and its webContents are destroyed, so reading `window.webContents`
  // inside that handler throws "Object has been destroyed" -- which surfaced as
  // a crash dialog on every close, and left the PTY sessions it was supposed to
  // stop still running. The id is a number and outlives the object.
  const webContentsId = window.webContents.id;

  window.webContents.on("render-process-gone", () => {
    ptyManager.stopOwnedByWebContents(webContentsId, "window-closed");
  });
  window.on("closed", () => {
    ptyManager.stopOwnedByWebContents(webContentsId, "window-closed");
    disposeIpc?.();
    disposeIpc = null;
    if (mainWindow === window) mainWindow = null;
  });
  window.once("ready-to-show", () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(packagedRendererPath);
  }
}

/**
 * Title bar treatment per platform. "hiddenInset" is a macOS style: applying
 * it on Windows produces a frameless window with no minimise, maximise, or
 * close buttons, so Windows gets a hidden title bar with the native overlay
 * controls instead, and Linux keeps its normal window frame.
 */
function windowChrome(): BrowserWindowConstructorOptions {
  if (process.platform === "darwin") return { titleBarStyle: "hiddenInset" };
  if (process.platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: nativeTheme.shouldUseDarkColors ? "#17151f" : "#f4f2fa",
        symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e6f0" : "#0f172a",
        height: 42,
      },
    };
  }
  return { icon: join(__dirname, "../../assets/icon.png") };
}

function safeErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 500);
  return "Unknown startup error";
}
