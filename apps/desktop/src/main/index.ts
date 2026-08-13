import { app, BrowserWindow, nativeTheme, session, shell, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigStore } from "./config-store";
import { registerIpcHandlers } from "./ipc-handlers";
import { ProviderResolver } from "./provider-resolver";
import { PtyManager } from "./pty-manager";
import { isAllowlistedDocsUrl, isTrustedRendererUrl } from "./security-policy";

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

  app.whenReady().then(createMainWindow).catch((error: unknown) => {
    console.error("AOS failed to start", safeErrorMessage(error));
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error: unknown) => console.error("AOS failed to open", safeErrorMessage(error)));
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

  const preloadPath = join(__dirname, "preload.js");
  const packagedRendererPath = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const trustedRendererUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL ?? pathToFileURL(packagedRendererPath).href;
  const window = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f4f2fa",
    show: false,
    title: "AOS",
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
  disposeIpc?.();
  disposeIpc = registerIpcHandlers({
    configStore,
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
  window.webContents.on("render-process-gone", () => {
    ptyManager.stopOwnedByWebContents(window.webContents.id, "window-closed");
  });
  window.on("closed", () => {
    ptyManager.stopOwnedByWebContents(window.webContents.id, "window-closed");
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
