import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { ProviderId, WorkspaceDescriptor } from "../shared/ipc-contract";
import { PLATFORM_CONTEXT } from "./provider-resolver";
import { isWindows, pathsEqual } from "./platform-layout";

// Directories that sit directly under the filesystem root and are too broad to
// hand to a coding agent as a workspace.
const BROAD_ROOT_DIRECTORIES: Record<string, readonly string[]> = {
  darwin: ["Applications", "Library", "System", "Users", "Volumes", "private", "usr", "bin", "sbin", "etc", "opt", "var"],
  linux: ["bin", "boot", "dev", "etc", "home", "lib", "lib64", "media", "mnt", "opt", "proc", "root", "run", "sbin", "srv", "sys", "usr", "var"],
  win32: ["Windows", "Program Files", "Program Files (x86)", "ProgramData", "Users", "$Recycle.Bin"],
};

const PROVIDERS = new Set<ProviderId>(["codex", "claude"]);
const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
const MIN_COLS = 20;
const MAX_COLS = 400;
const MIN_ROWS = 5;
const MAX_ROWS = 200;

export function assertProviderId(value: unknown): ProviderId {
  if (typeof value !== "string" || !PROVIDERS.has(value as ProviderId)) {
    throw new TypeError("Unsupported provider");
  }
  return value as ProviderId;
}

export function assertOpaqueId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9-]{8,128}$/i.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

export function assertTerminalInput(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Terminal input must be text");
  if (Buffer.byteLength(value, "utf8") > MAX_TERMINAL_INPUT_BYTES) {
    throw new RangeError("Terminal input is too large");
  }
  return value;
}

export function assertTerminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) throw new TypeError("Invalid terminal size");
  const normalizedCols = cols as number;
  const normalizedRows = rows as number;
  if (
    normalizedCols < MIN_COLS ||
    normalizedCols > MAX_COLS ||
    normalizedRows < MIN_ROWS ||
    normalizedRows > MAX_ROWS
  ) {
    throw new RangeError("Terminal size is outside allowed bounds");
  }
  return { cols: normalizedCols, rows: normalizedRows };
}

export async function canonicalizeWorkspace(path: string): Promise<WorkspaceDescriptor> {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || !isAbsolute(path)) {
    throw new TypeError("Workspace must be an absolute directory path");
  }

  const canonicalPath = await realpath(resolve(path));
  // parse().root handles both "/" and a Windows drive root such as "C:\",
  // where realpath("/") would silently resolve against the current drive.
  const canonicalRoot = parse(canonicalPath).root;
  if (pathsEqual(canonicalPath, canonicalRoot, PLATFORM_CONTEXT)) {
    throw new TypeError("The filesystem root cannot be a workspace");
  }
  const canonicalHome = await realpath(homedir());
  if (pathsEqual(canonicalPath, canonicalHome, PLATFORM_CONTEXT)) {
    throw new TypeError("The user home cannot be a workspace");
  }

  if (isBroadSystemDirectory(canonicalPath, canonicalRoot)) {
    throw new TypeError("A broad system directory cannot be a workspace");
  }

  const workspaceStat = await stat(canonicalPath);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    throw new TypeError("Workspace must resolve to a directory");
  }

  await access(canonicalPath, fsConstants.R_OK | fsConstants.W_OK);

  const id = createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24);
  return Object.freeze({ id, name: basename(canonicalPath), path: canonicalPath });
}

export async function assertWorkspaceStillAuthorized(
  workspace: WorkspaceDescriptor,
): Promise<WorkspaceDescriptor> {
  const current = await canonicalizeWorkspace(workspace.path);
  if (current.id !== workspace.id) throw new Error("Workspace authorization is no longer valid");
  return current;
}

export function isBroadSystemDirectory(canonicalPath: string, canonicalRoot: string): boolean {
  if (!pathsEqual(dirname(canonicalPath), canonicalRoot, PLATFORM_CONTEXT)) return false;
  const name = basename(canonicalPath);
  const broad = BROAD_ROOT_DIRECTORIES[PLATFORM_CONTEXT.platform] ?? [];
  return isWindows(PLATFORM_CONTEXT)
    ? broad.some((entry) => entry.toLowerCase() === name.toLowerCase())
    : broad.includes(name);
}

export function isPathWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

export function createTerminalId(): string {
  return randomUUID();
}
