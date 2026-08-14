import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentActivity,
  DocketDesktopApi,
  LoginRequest,
  ProviderId,
  SessionStartRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  Unsubscribe,
} from "../shared/ipc-contract";
import { IPC_CHANNELS } from "../shared/ipc-contract";
import type { AgentId, AgentModel } from "../shared/agent-roster";

function subscribe<T>(channel: string, listener: (event: T) => void): Unsubscribe {
  const wrappedListener = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrappedListener);
  return () => ipcRenderer.removeListener(channel, wrappedListener);
}

const api: DocketDesktopApi = Object.freeze({
  platform: process.platform,
  runtime: Object.freeze({
    info: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInfo),
  }),
  config: Object.freeze({
    read: () => ipcRenderer.invoke(IPC_CHANNELS.configRead),
    updateController: (provider: ProviderId) =>
      ipcRenderer.invoke(IPC_CHANNELS.configUpdateController, provider),
  }),
  agents: Object.freeze({
    team: () => ipcRenderer.invoke(IPC_CHANNELS.agentsTeam),
    setModel: (agentId: AgentId, model: AgentModel) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentsSetModel, agentId, model),
    onActivity: (listener: (event: AgentActivity) => void) =>
      subscribe(IPC_CHANNELS.agentsActivity, listener),
  }),
  setup: Object.freeze({
    complete: () => ipcRenderer.invoke(IPC_CHANNELS.setupComplete),
  }),
  workspace: Object.freeze({
    choose: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceChoose),
    read: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceRead),
    select: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect, workspaceId),
  }),
  providers: Object.freeze({
    detect: () => ipcRenderer.invoke(IPC_CHANNELS.providersDetect),
    status: (provider: ProviderId) => ipcRenderer.invoke(IPC_CHANNELS.providerStatus, provider),
    login: Object.freeze({
      start: (request: LoginRequest) =>
        ipcRenderer.invoke(IPC_CHANNELS.providerLoginStart, request),
      cancel: (terminalId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.providerLoginCancel, terminalId),
    }),
  }),
  sessions: Object.freeze({
    start: (request: SessionStartRequest) => ipcRenderer.invoke(IPC_CHANNELS.sessionStart, request),
    interrupt: (terminalId: string) => ipcRenderer.invoke(IPC_CHANNELS.sessionInterrupt, terminalId),
    stop: (terminalId: string) => ipcRenderer.invoke(IPC_CHANNELS.sessionStop, terminalId),
  }),
  terminal: Object.freeze({
    write: (terminalId: string, data: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalResize, terminalId, cols, rows),
    onData: (listener: (event: TerminalDataEvent) => void) =>
      subscribe(IPC_CHANNELS.terminalData, listener),
    onExit: (listener: (event: TerminalExitEvent) => void) =>
      subscribe(IPC_CHANNELS.terminalExit, listener),
  }),
  external: Object.freeze({
    openDocs: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.externalOpenDocs, url),
  }),
});

contextBridge.exposeInMainWorld("docketDesktop", api);
