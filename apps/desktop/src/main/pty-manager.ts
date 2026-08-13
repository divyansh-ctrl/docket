import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { spawn, type IPty } from "node-pty";
import type {
  ProviderId,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalPurpose,
  TerminalStartResult,
} from "../shared/ipc-contract";
import { providerEnvironment, PLATFORM_CONTEXT } from "./provider-resolver";
import { isWindows } from "./platform-layout";
import { assertAllowlistedCommand } from "./security-policy";
import {
  assertOpaqueId,
  assertTerminalInput,
  assertTerminalSize,
  createTerminalId,
} from "./validation";

const MAX_PTY_DATA_CHUNK_BYTES = 64 * 1024;
const MAX_GLOBAL_TERMINALS = 8;
const MAX_OWNER_TERMINALS = 2;
const OUTPUT_FLUSH_INTERVAL_MS = 16;
const MAX_OUTPUT_BUFFER_BYTES = 256 * 1024;
const KILL_GRACE_MS = 2_500;
const ATTACH_TIMEOUT_MS = 30_000;
const OUTPUT_RATE_BYTES_PER_SECOND = 512 * 1024;
const OUTPUT_RATE_BURST_BYTES = 256 * 1024;

type TerminalOwner = Readonly<{
  webContentsId: number;
  frameRoutingId: number;
}>;

type SpawnTerminal = Readonly<{
  provider: ProviderId;
  purpose: TerminalPurpose;
  executable: string;
  executableDirectory: string;
  runtimeDirectory: string | null;
  /**
   * Arguments placed before the provider's own arguments, used when the
   * provider must run under a resolved interpreter. These are produced by the
   * resolver, never by the renderer, and are excluded from the command
   * allowlist check, which still governs the provider arguments themselves.
   */
  launchPrefix?: readonly string[];
  args: readonly string[];
  cwd: string;
  owner: TerminalOwner;
  cols?: number;
  rows?: number;
}>;

type ManagedTerminal = {
  id: string;
  provider: ProviderId;
  purpose: TerminalPurpose;
  owner: TerminalOwner;
  pty: IPty;
  exitReason: TerminalExitEvent["reason"];
  outputBuffer: string;
  outputTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  attachTimer: NodeJS.Timeout | null;
  attached: boolean;
  expired: boolean;
  pendingExit: TerminalExitEvent | null;
  outputBudget: OutputRateBudget;
};

export type OutputRateBudget = {
  tokens: number;
  lastRefillAt: number;
  droppedBytes: number;
};

export class PtyManager extends EventEmitter {
  readonly #terminals = new Map<string, ManagedTerminal>();
  readonly #spawnPty: typeof spawn;

  constructor(spawnPty: typeof spawn = spawn) {
    super();
    this.#spawnPty = spawnPty;
  }

  start(options: SpawnTerminal): TerminalStartResult {
    assertAllowlistedCommand(options.provider, options.purpose, options.args);
    this.#assertCapacity(options.owner, options.purpose);
    const size = assertTerminalSize(options.cols ?? 100, options.rows ?? 30);
    const terminalId = createTerminalId();
    const pty = this.#spawnPty(options.executable, [...(options.launchPrefix ?? []), ...options.args], {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd: options.cwd,
      env: providerEnvironment(options.executableDirectory, options.runtimeDirectory) as Record<string, string>,
    });

    const terminal: ManagedTerminal = {
      id: terminalId,
      provider: options.provider,
      purpose: options.purpose,
      owner: options.owner,
      pty,
      exitReason: "exited",
      outputBuffer: "",
      outputTimer: null,
      killTimer: null,
      attachTimer: null,
      attached: false,
      expired: false,
      pendingExit: null,
      outputBudget: createOutputRateBudget(performance.now()),
    };
    this.#terminals.set(terminalId, terminal);
    terminal.attachTimer = setTimeout(() => this.#expireUnattached(terminal), ATTACH_TIMEOUT_MS);
    terminal.attachTimer.unref();

    pty.onData((data) => {
      terminal.outputBuffer = boundedAppend(terminal.outputBuffer, data);
      if (terminal.attached) {
        terminal.outputTimer ??= setTimeout(() => this.#flushOutput(terminal), OUTPUT_FLUSH_INTERVAL_MS);
      }
    });
    pty.onExit(({ exitCode, signal }) => {
      if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
      if (terminal.killTimer) clearTimeout(terminal.killTimer);
      terminal.pendingExit = Object.freeze({
        terminalId,
        exitCode,
        signal: signal ?? null,
        reason: terminal.exitReason,
      });
      if (terminal.expired) {
        this.#cleanup(terminal);
      } else if (terminal.attached) {
        this.#finalizeExit(terminal);
      }
    });

    return Object.freeze({ terminalId, provider: options.provider, purpose: options.purpose });
  }

  write(owner: TerminalOwner, terminalId: unknown, data: unknown): void {
    const terminal = this.#ownedTerminal(owner, terminalId);
    this.#attach(terminal);
    if (terminal.pendingExit) throw new Error("Terminal has already exited");
    terminal.pty.write(assertTerminalInput(data));
  }

  resize(owner: TerminalOwner, terminalId: unknown, cols: unknown, rows: unknown): void {
    const terminal = this.#ownedTerminal(owner, terminalId);
    const size = assertTerminalSize(cols, rows);
    this.#attach(terminal);
    if (!terminal.pendingExit) terminal.pty.resize(size.cols, size.rows);
  }

  interrupt(owner: TerminalOwner, terminalId: unknown): void {
    const terminal = this.#ownedTerminal(owner, terminalId);
    this.#attach(terminal);
    if (terminal.pendingExit) throw new Error("Terminal has already exited");
    terminal.pty.write("\u0003");
  }

  stop(
    owner: TerminalOwner,
    terminalId: unknown,
    reason: TerminalExitEvent["reason"] = "stopped",
  ): void {
    const terminal = this.#ownedTerminal(owner, terminalId);
    this.#attach(terminal);
    if (terminal.pendingExit) return;
    terminal.exitReason = reason;
    this.#terminate(terminal);
  }

  stopOwnedByWebContents(
    webContentsId: number,
    reason: TerminalExitEvent["reason"] = "window-closed",
  ): void {
    for (const terminal of this.#terminals.values()) {
      if (terminal.owner.webContentsId !== webContentsId) continue;
      terminal.exitReason = reason;
      this.#terminate(terminal);
    }
  }

  stopAll(reason: TerminalExitEvent["reason"] = "app-quit"): void {
    for (const terminal of this.#terminals.values()) {
      terminal.exitReason = reason;
      this.#terminate(terminal);
    }
  }

  forceStopAll(reason: TerminalExitEvent["reason"] = "app-quit"): void {
    for (const terminal of this.#terminals.values()) {
      terminal.exitReason = reason;
      if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
      if (terminal.killTimer) clearTimeout(terminal.killTimer);
      if (terminal.attachTimer) clearTimeout(terminal.attachTimer);
      killPty(terminal.pty, "SIGKILL");
    }
  }

  /**
   * Asks the process to exit, then escalates. Windows has no graceful signal
   * to send, so the first request is already terminal and no escalation timer
   * is armed.
   */
  #terminate(terminal: ManagedTerminal): void {
    killPty(terminal.pty, "SIGTERM");
    if (!SUPPORTS_SIGNALS) return;
    terminal.killTimer ??= setTimeout(() => {
      if (this.#terminals.has(terminal.id)) killPty(terminal.pty, "SIGKILL");
    }, KILL_GRACE_MS);
    terminal.killTimer.unref();
  }

  #ownedTerminal(owner: TerminalOwner, terminalId: unknown): ManagedTerminal {
    const id = assertOpaqueId(terminalId, "terminal id");
    const terminal = this.#terminals.get(id);
    if (
      !terminal ||
      terminal.expired ||
      terminal.owner.webContentsId !== owner.webContentsId ||
      terminal.owner.frameRoutingId !== owner.frameRoutingId
    ) {
      throw new Error("Terminal is not owned by this window");
    }
    return terminal;
  }

  #assertCapacity(owner: TerminalOwner, purpose: TerminalPurpose): void {
    if (this.#terminals.size >= MAX_GLOBAL_TERMINALS) throw new Error("Terminal capacity reached");
    const owned = [...this.#terminals.values()].filter(
      (terminal) => terminal.owner.webContentsId === owner.webContentsId,
    );
    if (owned.length >= MAX_OWNER_TERMINALS) throw new Error("Window terminal capacity reached");
    if (owned.some((terminal) => terminal.purpose === purpose)) {
      throw new Error(`A ${purpose} terminal is already active for this window`);
    }
  }

  #flushOutput(terminal: ManagedTerminal, final = false): void {
    if (!terminal.attached || terminal.expired) return;
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    terminal.outputTimer = null;
    const data = terminal.outputBuffer;
    terminal.outputBuffer = "";
    const limited = consumeOutputRateBudget(
      terminal.outputBudget,
      data,
      performance.now(),
      final,
    );
    const output = [limited.markerBefore, limited.allowed, limited.markerAfter]
      .filter((value): value is string => Boolean(value));
    for (const value of output) {
      for (const chunk of boundedChunks(value)) {
      const event: TerminalDataEvent = Object.freeze({ terminalId: terminal.id, data: chunk });
      this.emit("data", terminal.owner, event);
      }
    }
  }

  #attach(terminal: ManagedTerminal): void {
    if (terminal.attached) return;
    terminal.attached = true;
    if (terminal.attachTimer) clearTimeout(terminal.attachTimer);
    terminal.attachTimer = null;
    this.#flushOutput(terminal, true);
    if (terminal.pendingExit) this.#finalizeExit(terminal);
  }

  #finalizeExit(terminal: ManagedTerminal): void {
    const event = terminal.pendingExit;
    if (!event) return;
    this.#flushOutput(terminal);
    this.#cleanup(terminal);
    this.emit("exit", terminal.owner, event);
  }

  #expireUnattached(terminal: ManagedTerminal): void {
    terminal.attachTimer = null;
    if (terminal.attached || !this.#terminals.has(terminal.id)) return;
    terminal.expired = true;
    terminal.outputBuffer = "";
    if (terminal.pendingExit) {
      this.#cleanup(terminal);
      return;
    }
    terminal.exitReason = "stopped";
    this.#terminate(terminal);
  }

  #cleanup(terminal: ManagedTerminal): void {
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    if (terminal.killTimer) clearTimeout(terminal.killTimer);
    if (terminal.attachTimer) clearTimeout(terminal.attachTimer);
    terminal.outputTimer = null;
    terminal.killTimer = null;
    terminal.attachTimer = null;
    this.#terminals.delete(terminal.id);
  }
}

const SUPPORTS_SIGNALS = !isWindows(PLATFORM_CONTEXT);

/**
 * node-pty throws "Signals not supported on windows" when kill() is given a
 * signal, and it throws from inside a deferred callback, so the rejection
 * would surface as an unhandled error in the main process rather than at the
 * call site.
 */
export function killPty(pty: Pick<IPty, "kill">, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    if (SUPPORTS_SIGNALS) pty.kill(signal);
    else pty.kill();
  } catch {
    // The process has already exited.
  }
}

export function createOutputRateBudget(now: number): OutputRateBudget {
  return {
    tokens: OUTPUT_RATE_BURST_BYTES,
    lastRefillAt: now,
    droppedBytes: 0,
  };
}

export function consumeOutputRateBudget(
  budget: OutputRateBudget,
  data: string,
  now: number,
  final = false,
): Readonly<{ allowed: string; markerBefore: string; markerAfter: string }> {
  const elapsed = Math.max(0, now - budget.lastRefillAt);
  budget.lastRefillAt = now;
  budget.tokens = Math.min(
    OUTPUT_RATE_BURST_BYTES,
    budget.tokens + (elapsed * OUTPUT_RATE_BYTES_PER_SECOND) / 1_000,
  );

  const previouslyDropped = budget.droppedBytes;
  budget.droppedBytes = 0;
  const allowed = utf8Prefix(data, Math.floor(budget.tokens));
  const allowedBytes = Buffer.byteLength(allowed, "utf8");
  budget.tokens = Math.max(0, budget.tokens - allowedBytes);
  const newlyDropped = Math.max(0, Buffer.byteLength(data, "utf8") - allowedBytes);
  budget.droppedBytes = Math.min(Number.MAX_SAFE_INTEGER, newlyDropped);

  const markerBefore = previouslyDropped > 0
    ? `\r\n[AOS throttled ${previouslyDropped} terminal output bytes]\r\n`
    : "";
  const markerAfter = final && budget.droppedBytes > 0
    ? `\r\n[AOS throttled ${budget.droppedBytes} terminal output bytes before exit]\r\n`
    : "";
  if (final) budget.droppedBytes = 0;
  return Object.freeze({ allowed, markerBefore, markerAfter });
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || value.length === 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, midpoint), "utf8") <= maxBytes) low = midpoint;
    else high = midpoint - 1;
  }
  if (
    low > 0 &&
    low < value.length &&
    /[\uD800-\uDBFF]/.test(value[low - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(value[low] ?? "")
  ) {
    low -= 1;
  }
  return value.slice(0, low);
}

function boundedChunks(data: string): string[] {
  if (Buffer.byteLength(data, "utf8") <= MAX_PTY_DATA_CHUNK_BYTES) return [data];
  const chunks: string[] = [];
  let remaining = data;
  while (remaining.length > 0) {
    let end = Math.min(remaining.length, MAX_PTY_DATA_CHUNK_BYTES / 2);
    while (end < remaining.length && Buffer.byteLength(remaining.slice(0, end), "utf8") < MAX_PTY_DATA_CHUNK_BYTES) {
      end = Math.min(remaining.length, end * 2);
    }
    while (end > 1 && Buffer.byteLength(remaining.slice(0, end), "utf8") > MAX_PTY_DATA_CHUNK_BYTES) {
      end = Math.floor(end / 2);
    }
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return chunks;
}

function boundedAppend(current: string, incoming: string): string {
  const combined = current + incoming;
  if (Buffer.byteLength(combined, "utf8") <= MAX_OUTPUT_BUFFER_BYTES) return combined;
  const marker = "\r\n[AOS limited excessive terminal output]\r\n";
  let suffix = combined.slice(-Math.floor(MAX_OUTPUT_BUFFER_BYTES / 2));
  while (Buffer.byteLength(suffix, "utf8") > MAX_OUTPUT_BUFFER_BYTES - Buffer.byteLength(marker)) {
    suffix = suffix.slice(Math.floor(suffix.length / 8));
  }
  return marker + suffix;
}
