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
import type { CheckResult } from "../shared/checks";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agent } from "../shared/agent-roster";
import { detectAgents } from "../shared/detect-agents";
import { ConfigStore } from "./config-store";
import type { SecretStore } from "./secret-store";
import { ProviderResolver, readFromProvider } from "./provider-resolver";
import { PtyManager } from "./pty-manager";
import { probeRepository } from "./probe-repository";
import { discoverChecks } from "./check-discovery";
import { runCheck } from "./check-runner";
import { detectRuntime } from "./container";
import { repositoryState } from "./workspace-diff";
import { buildEvidencePacket } from "./packet";
import { readCodexUsage } from "./codex-usage";
import { applyMcpServers, importFromCodex, importFromWorkspace } from "./mcp-files";
import { readServers } from "../shared/mcp-config";
import { readTokenUsage } from "./token-usage";
import { DecisionLog, renderRecord } from "./decision-log";
import { writeAgentFiles } from "./agent-files";
import { installAgentHooks, watchAgentEvents } from "./agent-events";
import { extractClaims, type AgentClaim } from "../shared/claims";
import {
  assertAgentId,
  assertAgentModel,
  assertCheckId,
  assertDecision,
  assertDigest,
  assertNote,
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
  secretStore: SecretStore;
  ptyManager: PtyManager;
  trustedRendererUrl: string;
}>;

export function registerIpcHandlers(dependencies: Dependencies): () => void {
  const { configStore, mainWindow, providerResolver, ptyManager, secretStore, trustedRendererUrl } = dependencies;
  const decisionLog = new DecisionLog(app.getPath("userData"));
  // One watcher at a time: opening a second workspace must not leave the first
  // one's log still reporting into the room.
  let stopWatching: (() => void) | null = null;
  const channels = Object.values(IPC_CHANNELS).filter(
    (channel) => channel !== IPC_CHANNELS.terminalData && channel !== IPC_CHANNELS.terminalExit,
  );

  /**
   * Sends to the renderer only if there is still one to send to.
   *
   * `isDestroyed()` is checked on the window before its webContents is touched,
   * because reading `.webContents` off a destroyed window throws rather than
   * returning null. Both are checked because a long check can still be
   * streaming output at the moment the window goes away, which is a race the
   * check runner made ordinary rather than theoretical.
   */
  const sendToRenderer = (channel: string, payload: unknown) => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

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
  // The renderer never receives a credential. These three return the same
  // view -- protection, and masked descriptors -- and there is no channel that
  // returns a value at all.
  const secretsView = () =>
    Object.freeze({ ...secretStore.status(), stored: secretStore.descriptors() });
  handle(IPC_CHANNELS.secretsRead, () => secretsView());
  handle(IPC_CHANNELS.secretsPut, async (_event, name: unknown, value: unknown) => {
    if (typeof name !== "string" || typeof value !== "string") throw new TypeError("A credential needs a name");
    await secretStore.put(assertOpaqueId(name, "credential name"), value);
    return secretsView();
  });
  handle(IPC_CHANNELS.secretsRemove, async (_event, name: unknown) => {
    await secretStore.remove(assertOpaqueId(name, "credential name"));
    return secretsView();
  });
  handle(IPC_CHANNELS.mcpSave, (_event, servers: unknown) =>
    configStore.updateMcpServers(readServers(servers)),
  );
  handle(IPC_CHANNELS.mcpApply, async () => {
    const workspace = configStore.read().workspace;
    if (!workspace) throw new Error("No repository is open");
    const verified = await canonicalizeWorkspace(workspace.path);
    return applyMcpServers(verified.path, configStore.read().mcpServers);
  });
  handle(IPC_CHANNELS.mcpImport, async () => {
    const workspace = configStore.read().workspace;
    if (!workspace) throw new Error("No repository is open");
    const verified = await canonicalizeWorkspace(workspace.path);

    // Both sides, because a server configured in one is invisible in the other
    // and importing from a single file would look complete while being half.
    const [claude, codex] = await Promise.all([
      importFromWorkspace(verified.path),
      importFromCodex((args) => readFromProvider(providerResolver, "codex", args)),
    ]);

    // `.mcp.json` is read first and wins a tie: it belongs to this repository,
    // while Codex's config is one shared by every repository on the machine.
    const seen = new Set(claude.servers.map((server) => server.id));
    const servers = [...claude.servers, ...codex.servers.filter((server) => !seen.has(server.id))];
    const shadowed = codex.servers.filter((server) => seen.has(server.id)).map((server) => server.id);

    return {
      servers,
      problems: [
        ...claude.problems,
        ...codex.problems,
        ...shadowed.map((server) => ({
          server,
          detail: "Configured in both. This repository's .mcp.json was used, and Codex's copy was not read.",
        })),
      ],
    };
  });
  handle(IPC_CHANNELS.workspaceRead, () => configStore.read().workspace);
  handle(IPC_CHANNELS.workspaceChoose, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a repository",
      buttonLabel: "Open repository",
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
  handle(IPC_CHANNELS.agentsTeam, async () => {
    const config = configStore.read();
    if (!config.workspace) return null;

    // Re-checked rather than trusted from config: the directory may have been
    // moved or unmounted since it was authorized, and the probe is about to
    // read it and write agent files into it.
    const workspace = await assertWorkspaceStillAuthorized(config.workspace);
    const members = detectAgents(await probeRepository(workspace.path)).map((selection) => ({
      ...selection,
      model: config.agentModels[selection.id] ?? agent(selection.id).defaultModel,
    }));
    const result = await writeAgentFiles(
      workspace.path,
      members.map((member) => member.id),
      config.agentModels,
    );

    // Hooks are installed per workspace because the log path is absolute, and
    // the watcher is restarted for the same reason.
    const logPath = join(app.getPath("userData"), "activity", `${workspace.id}.jsonl`);
    try {
      await installAgentHooks(workspace.path, logPath);
      stopWatching?.();
      recentClaims.length = 0;
      stopWatching = watchAgentEvents(logPath, (event) => {
        // Claims are read here, in the main process, from the CLI's own hook
        // events -- the renderer never supplies them. What an agent said must
        // reach the packet through the same one-way glass as everything else.
        if (event.kind === "stop" && event.summary) {
          recentClaims.push(...extractClaims(event.summary, event.agentId, event.at));
          if (recentClaims.length > 200) recentClaims.splice(0, recentClaims.length - 200);
        }
        sendToRenderer(IPC_CHANNELS.agentsActivity, event);
      });
    } catch (error) {
      // A repository whose hook settings cannot be written still gets its
      // team; it just will not report activity, which is worth saying rather
      // than failing the whole open.
      console.warn(`Docket could not install activity hooks: ${(error as Error).message}`);
    }

    return { workspaceId: workspace.id, members, written: result.written, skipped: result.skipped };
  });
  handle(IPC_CHANNELS.agentsSetModel, (_event, agentId: unknown, model: unknown) =>
    configStore.updateAgentModel(assertAgentId(agentId), assertAgentModel(model)),
  );
  // Checks run one at a time per id, and the controller is kept so the renderer
  // can cancel one that hangs. A second run of the same check replaces the
  // first rather than racing it into the same output stream.
  const running = new Map<string, AbortController>();

  handle(IPC_CHANNELS.checksDiscover, async () => {
    const config = configStore.read();
    if (!config.workspace) return null;
    const workspace = await assertWorkspaceStillAuthorized(config.workspace);
    return discoverChecks(workspace.path);
  });

  handle(IPC_CHANNELS.checksRun, async (_event, checkId: unknown) => {
    const id = assertCheckId(checkId);
    const config = configStore.read();
    if (!config.workspace) throw new Error("No repository is open");

    // Re-authorized and re-discovered on every run. The renderer's copy may be
    // stale, and this is about to execute something out of that manifest: the
    // command has to come from the repository as it is now, not as it was when
    // the panel last rendered.
    const workspace = await assertWorkspaceStillAuthorized(config.workspace);
    const discovery = await discoverChecks(workspace.path);
    const check = discovery.checks.find((candidate) => candidate.id === id);
    if (!check) throw new Error(`No check named "${id}" in this repository`);

    const scripts = Object.fromEntries(
      discovery.checks.map((candidate) => [candidate.script, candidate.declaration]),
    );

    running.get(id)?.abort();
    const controller = new AbortController();
    running.set(id, controller);

    try {
      return await runCheck(workspace.path, check, scripts, {
        // Read here rather than passed from the renderer: this is the setting
        // that decides whether something runs with the user's own access, and
        // it must come from the store the user set, not from the caller.
        requireIsolation: config.requireIsolation,
        signal: controller.signal,
        onOutput: (chunk) => {
          sendToRenderer(IPC_CHANNELS.checksOutput, { checkId: id, chunk });
        },
      });
    } finally {
      if (running.get(id) === controller) running.delete(id);
    }
  });

  handle(IPC_CHANNELS.checksCancel, (_event, checkId: unknown) => {
    running.get(assertCheckId(checkId))?.abort();
  });

  handle(IPC_CHANNELS.checksIsolation, async () => {
    // Refreshed rather than cached: a runtime started after the app was
    // launched is the common case, and reporting the state from startup would
    // tell someone who just opened Docker that they still have nothing.
    const status = await detectRuntime(true);
    return {
      runtime: status.command,
      reason: status.reason,
      required: configStore.read().requireIsolation,
    };
  });

  handle(IPC_CHANNELS.checksSetRequireIsolation, (_event, required: unknown) => {
    if (typeof required !== "boolean") throw new TypeError("Invalid isolation requirement");
    return configStore.updateRequireIsolation(required);
  });

  /**
   * Assembles a packet from a fresh read of the repository.
   *
   * Shared by building one for the screen and sealing one into a record, so the
   * two can never drift apart. If sealing assembled its packet differently from
   * the one the reviewer read, the record would attest to something they never
   * saw -- which is the failure the record exists to prevent.
   */
  /** What agents said about checks in this session, oldest first, capped. */
  const recentClaims: AgentClaim[] = [];

  const buildPacket = async (workspacePath: string, intent: unknown, results: unknown) =>
    buildEvidencePacket({
      workspacePath,
      intent: typeof intent === "string" ? intent : "",
      results: parseResults(results),
      claims: [...recentClaims],
    });

  /**
   * What this repository's sessions have spent.
   *
   * Read fresh each time from the CLI's transcript rather than accumulated
   * here: the CLI is the one doing the spending, and a number Docket kept its
   * own running total of would drift from the only authoritative record.
   */
  handle(IPC_CHANNELS.usageRead, async () => {
    const config = configStore.read();
    if (!config.workspace) return null;
    const provider = config.selectedProvider ?? "claude";

    // Each CLI is read by the reader that understands its format. They count
    // differently enough that sharing one -- cumulative totals, cache inside
    // input rather than beside it -- would misreport every figure.
    if (provider === "codex") {
      const reading = await readCodexUsage(config.workspace.path);
      if (!reading.ok) return { ok: false as const, reason: reading.reason };
      const { window, limits, ...rest } = reading.usage;
      return {
        ok: true as const,
        usage: { ...rest, transcripts: reading.sessions, source: "codex" as const, window, limits },
      };
    }

    const reading = await readTokenUsage(config.workspace.path, undefined, provider);
    if (!reading.ok) return { ok: false as const, reason: reading.reason };
    return {
      ok: true as const,
      // Claude Code states no window size and no rate limit, so both are
      // absent here rather than defaulted -- which is what stops a percentage
      // from being drawn against a denominator nobody read.
      usage: {
        ...reading.usage,
        transcripts: reading.transcripts,
        source: "claude" as const,
        window: null,
        limits: null,
      },
    };
  });

  handle(IPC_CHANNELS.evidenceBuild, async (_event, intent: unknown, results: unknown) => {
    const config = configStore.read();
    if (!config.workspace) return null;
    const workspace = await assertWorkspaceStillAuthorized(config.workspace);
    return buildPacket(workspace.path, intent, results);
  });

  handle(IPC_CHANNELS.evidenceSetIntent, (_event, text: unknown) => {
    if (typeof text !== "string") throw new TypeError("Invalid intent");
    return configStore.updateIntent(text, Date.now());
  });

  handle(IPC_CHANNELS.decisionsRead, async () => {
    const config = configStore.read();
    if (!config.workspace) return null;
    const workspace = await assertWorkspaceStillAuthorized(config.workspace);
    const [log, current] = await Promise.all([
      decisionLog.read(workspace.id),
      repositoryState(workspace.path),
    ]);
    return { ...log, current };
  });

  handle(
    IPC_CHANNELS.decisionsSeal,
    async (_event, decision: unknown, note: unknown, intent: unknown, results: unknown) => {
      const config = configStore.read();
      if (!config.workspace) return null;
      const workspace = await assertWorkspaceStillAuthorized(config.workspace);

      // Persisted before the packet is built, so the intent inside the record
      // is the sentence that was on screen when the decision was made rather
      // than whatever the store happened to hold from an earlier blur.
      const text = typeof intent === "string" ? intent : "";
      await configStore.updateIntent(text, Date.now());

      const [packet, state] = await Promise.all([
        buildPacket(workspace.path, text, results),
        repositoryState(workspace.path),
      ]);

      return decisionLog.seal({
        workspaceId: workspace.id,
        head: state.head,
        treeDigest: state.treeDigest,
        decision: assertDecision(decision),
        note: assertNote(note),
        packet,
        sealedAt: Date.now(),
      });
    },
  );

  handle(IPC_CHANNELS.decisionsExport, async (_event, digest: unknown) => {
    const config = configStore.read();
    if (!config.workspace) return null;
    const workspace = await assertWorkspaceStillAuthorized(config.workspace);

    // Looked up in the log by digest rather than accepted from the renderer.
    // Exporting a record supplied by the caller would let the file say
    // something the log never recorded.
    const wanted = assertDigest(digest);
    const { records } = await decisionLog.read(workspace.id);
    const record = records.find((entry) => entry.digest === wanted);
    if (!record) throw new Error("No sealed record with that digest");

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save decision record",
      defaultPath: `docket-decision-${record.sequence}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return null;

    await writeFile(result.filePath, renderRecord(record), "utf8");
    return result.filePath;
  });

  handle(IPC_CHANNELS.setupComplete, () => configStore.completeSetup());
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
        !app.isPackaged && process.env.DOCKET_ALLOW_CLAUDE_LOCAL_PREVIEW === "1";
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
    stopWatching?.();
    stopWatching = null;
    // A check outliving the window would keep a build running with nowhere to
    // report, which is exactly the orphaned work the roadmap counts as a defect.
    for (const controller of running.values()) controller.abort();
    running.clear();
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

/**
 * Check results come back across IPC, so they are re-validated rather than
 * trusted. Only the fields the packet reads are kept, and anything malformed is
 * dropped instead of failing the whole packet: a reviewer is better served by a
 * packet reporting a check as unrun than by no packet at all.
 */
function parseResults(value: unknown): readonly CheckResult[] {
  if (!Array.isArray(value)) return [];
  const out: CheckResult[] = [];
  for (const entry of value.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.checkId !== "string") continue;
    if (!OUTCOMES.has(candidate.outcome as string)) continue;
    out.push({
      checkId: candidate.checkId,
      outcome: candidate.outcome as CheckResult["outcome"],
      exitCode: typeof candidate.exitCode === "number" ? candidate.exitCode : null,
      output: typeof candidate.output === "string" ? candidate.output.slice(0, 200_000) : "",
      outputTruncated: candidate.outputTruncated === true,
      durationMs: typeof candidate.durationMs === "number" ? candidate.durationMs : 0,
      argv: Array.isArray(candidate.argv) ? candidate.argv.filter((a) => typeof a === "string") : [],
      error: typeof candidate.error === "string" ? candidate.error : null,
      // Anything unrecognised is treated as uncontained. Guessing "container"
      // here would upgrade the strength of a piece of evidence on the word of
      // whatever sent it. "refused" is kept because it is the weakest of the
      // three -- nothing ran -- so honouring it can only understate.
      isolation: ISOLATIONS.has(candidate.isolation as string)
        ? (candidate.isolation as CheckResult["isolation"])
        : "host",
      isolationReason:
        typeof candidate.isolationReason === "string" ? candidate.isolationReason : null,
    });
  }
  return out;
}

const OUTCOMES = new Set(["passed", "failed", "errored", "timed-out"]);
const ISOLATIONS = new Set(["container", "host", "refused"]);

async function requireExecutable(resolver: ProviderResolver, provider: ProviderId) {
  const executable = await resolver.resolve(provider, true);
  if (!executable) throw new Error(`${provider} CLI is not installed`);
  return executable;
}
