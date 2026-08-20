import { execFile } from "node:child_process";
import { assertAllowlistedRead } from "./security-policy";
import { constants as fsConstants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { ProviderDetection, ProviderId, ProviderStatus } from "../shared/ipc-contract";
import {
  NVM_VERSION_PATTERN,
  isAllowedExecutableDirectory,
  isNvmBinDirectory,
  isTrustedProviderLayout as isTrustedLayout,
  isWithinCanonicalPrefix,
  isWindows,
  nvmRoot,
  pathsEqual,
  providerEnvironment as buildProviderEnvironment,
  providerLayout,
  safeProviderEnvironment as buildSafeEnvironment,
  type PlatformContext,
} from "./platform-layout";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

type ResolvedExecutable = Readonly<{
  path: string;
  invocationPath: string;
  executableDirectory: string;
  runtimeDirectory: string | null;
  /**
   * Arguments inserted before the provider's own arguments. Used on Windows,
   * where the Codex launcher is a batch shim that cannot be executed directly:
   * a trusted node.exe runs the resolved script instead, so no shell is spawned.
   */
  launchPrefix: readonly string[];
  source: "path" | "known-location";
}>;

// Only the three shipped platforms have layouts. Any other POSIX host is
// treated as Linux so running from source degrades rather than crashing.
export const PLATFORM_CONTEXT: PlatformContext = Object.freeze({
  platform: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
  home: homedir(),
});

// Node runtimes trusted to execute the Codex script.
const WINDOWS_NODE_DIRECTORIES = [
  join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs"),
];

export class ProviderResolver {
  readonly #cache = new Map<ProviderId, ResolvedExecutable | null>();

  async resolve(provider: ProviderId, refresh = false): Promise<ResolvedExecutable | null> {
    if (!refresh && this.#cache.has(provider)) return this.#cache.get(provider) ?? null;

    for (const candidate of await candidatesFor(provider)) {
      const resolvedExecutable = await inspectCandidate(
        provider,
        candidate.invocationPath,
        candidate.source,
      );
      if (resolvedExecutable) {
        this.#cache.set(provider, resolvedExecutable);
        return resolvedExecutable;
      }
    }

    this.#cache.set(provider, null);
    return null;
  }

  async detect(provider: ProviderId): Promise<ProviderDetection> {
    const executable = await this.resolve(provider, true);
    if (!executable) return unavailableDetection(provider);

    const version = await runBounded(executable, ["--version"]);
    return Object.freeze({
      provider,
      available: version.ok,
      version: version.ok ? firstLine(version.stdout) : null,
      executableSource: executable.source,
    });
  }

  async status(provider: ProviderId): Promise<ProviderStatus> {
    const detection = await this.detect(provider);
    if (!detection.available) {
      return Object.freeze({
        ...detection,
        authenticated: false,
        authLabel: "CLI not found",
        authMethod: null,
        productionRecommended: provider === "codex",
      });
    }

    const executable = await this.resolve(provider);
    if (!executable) throw new Error("Provider executable disappeared");

    const auth = await runBounded(
      executable,
      provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
    );
    const claudeAuth = provider === "claude" ? parseClaudeAuthStatus(auth.stdout) : null;
    const authenticated = provider === "claude" ? Boolean(auth.ok && claudeAuth?.loggedIn) : auth.ok;

    return Object.freeze({
      ...detection,
      authenticated,
      authLabel: provider === "claude"
        ? claudeAuthLabel(authenticated, claudeAuth?.authMethod ?? null)
        : authenticated
          ? "Authenticated by installed CLI"
          : "Authentication required",
      authMethod: provider === "claude"
        ? claudeAuthMethod(claudeAuth?.authMethod ?? null)
        : authenticated
          ? "codex"
          : null,
      productionRecommended: provider === "codex" || claudeAuthMethod(claudeAuth?.authMethod ?? null) === "claude-console",
    });
  }
}

export function parseClaudeAuthStatus(
  value: string,
): Readonly<{ loggedIn: boolean; authMethod: string | null }> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.loggedIn !== "boolean") return null;
    return Object.freeze({
      loggedIn: candidate.loggedIn,
      authMethod: typeof candidate.authMethod === "string"
        ? candidate.authMethod.slice(0, 80).toLowerCase()
        : null,
    });
  } catch {
    return null;
  }
}

function claudeAuthMethod(
  method: string | null,
): ProviderStatus["authMethod"] {
  if (!method) return null;
  if (method.includes("claudeai") || method.includes("subscription")) {
    return "claude-subscription";
  }
  if (method.includes("console")) return "claude-console";
  return "unknown";
}

function claudeAuthLabel(authenticated: boolean, method: string | null): string {
  if (!authenticated) return "Authentication required";
  const normalized = claudeAuthMethod(method);
  if (normalized === "claude-console") return "Authenticated · Console method reported by CLI";
  if (normalized === "claude-subscription") {
    return "Authenticated · Claude subscription · local preview only";
  }
  return "Authenticated · method unverified by CLI";
}

async function candidatesFor(provider: ProviderId): Promise<ResolvedExecutable[]> {
  const layout = providerLayout(provider, PLATFORM_CONTEXT);
  const candidates: ResolvedExecutable[] = [];

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory || !isAllowedExecutableDirectory(provider, directory, PLATFORM_CONTEXT)) continue;
    candidates.push(...candidatesInDirectory(directory, layout.fileNames, "path"));
  }
  for (const directory of await knownBinDirectories(provider)) {
    candidates.push(...candidatesInDirectory(directory, layout.fileNames, "known-location"));
  }
  return dedupeCandidates(candidates);
}

async function inspectCandidate(
  provider: ProviderId,
  candidate: string,
  source: ResolvedExecutable["source"],
): Promise<ResolvedExecutable | null> {
  const layout = providerLayout(provider, PLATFORM_CONTEXT);
  if (
    !isAbsolute(candidate) ||
    !layout.fileNames.some((name) => basename(candidate).toLowerCase() === name.toLowerCase()) ||
    !isAllowedExecutableDirectory(provider, dirname(candidate), PLATFORM_CONTEXT)
  ) {
    return null;
  }

  try {
    // X_OK is meaningless on Windows, where executability comes from the file
    // extension rather than a permission bit.
    await access(candidate, isWindows(PLATFORM_CONTEXT) ? fsConstants.F_OK : fsConstants.X_OK);
    const canonicalPath = await realpath(candidate);
    const fileStat = await stat(canonicalPath);
    if (!fileStat.isFile()) return null;
    if (!isTrustedLayout(provider, candidate, canonicalPath, PLATFORM_CONTEXT)) return null;

    const executableDirectory = dirname(candidate);
    if (!layout.script) {
      return Object.freeze({
        path: canonicalPath,
        invocationPath: candidate,
        executableDirectory,
        runtimeDirectory: null,
        launchPrefix: Object.freeze([]),
        source,
      });
    }

    const runtimeDirectory = await resolveNodeRuntimeDirectory(candidate);
    if (!runtimeDirectory) return null;

    if (!isWindows(PLATFORM_CONTEXT)) {
      // The launcher is an executable script with a shebang, so it is spawned
      // directly with the trusted node runtime ahead of it on PATH.
      return Object.freeze({
        path: canonicalPath,
        invocationPath: candidate,
        executableDirectory,
        runtimeDirectory,
        launchPrefix: Object.freeze([]),
        source,
      });
    }

    const scriptPath = join(executableDirectory, layout.script.relativePath);
    const canonicalScript = await realpath(scriptPath).catch(() => null);
    if (!canonicalScript || !(await stat(canonicalScript)).isFile()) return null;
    if (!layout.containmentRoots.some((root) => isWithinCanonicalPrefix(root, canonicalScript, PLATFORM_CONTEXT))) {
      return null;
    }
    return Object.freeze({
      path: join(runtimeDirectory, "node.exe"),
      invocationPath: candidate,
      executableDirectory,
      runtimeDirectory,
      launchPrefix: Object.freeze([canonicalScript]),
      source,
    });
  } catch {
    return null;
  }
}

/**
 * Run a read-only provider command and return its output.
 *
 * The argument vector is allowlisted exactly as a session spawn is, for the
 * same reason: this reaches a real executable, and the only difference is that
 * it does not get a terminal.
 */
export async function readFromProvider(
  resolver: ProviderResolver,
  provider: ProviderId,
  args: readonly string[],
): Promise<{ ok: boolean; stdout: string; reason: string | null }> {
  assertAllowlistedRead(provider, args);
  const executable = await resolver.resolve(provider);
  if (!executable) {
    return { ok: false, stdout: "", reason: `${provider} was not found on this machine.` };
  }
  const result = await runBounded(executable, [...args]);
  return result.ok
    ? { ok: true, stdout: result.stdout, reason: null }
    : { ok: false, stdout: "", reason: `${provider} did not answer \`${args.join(" ")}\`.` };
}

async function runBounded(executable: ResolvedExecutable, args: string[]) {
  try {
    const { stdout } = await execFileAsync(executable.path, [...executable.launchPrefix, ...args], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      env: providerEnvironment(executable.executableDirectory, executable.runtimeDirectory),
    });
    return { ok: true as const, stdout };
  } catch {
    return { ok: false as const, stdout: "" };
  }
}

export function safeProviderEnvironment(): NodeJS.ProcessEnv {
  return buildSafeEnvironment(PLATFORM_CONTEXT);
}

export function providerEnvironment(
  executableDirectory: string,
  runtimeDirectory: string | null = null,
): NodeJS.ProcessEnv {
  return buildProviderEnvironment(executableDirectory, runtimeDirectory, PLATFORM_CONTEXT);
}

export function isTrustedProviderLayout(
  provider: ProviderId,
  invocationPath: string,
  canonicalPath: string,
): boolean {
  return isTrustedLayout(provider, invocationPath, canonicalPath, PLATFORM_CONTEXT);
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0]?.slice(0, 160) ?? "unknown";
}

function dedupeCandidates(candidates: ResolvedExecutable[]): ResolvedExecutable[] {
  const seen = new Set<string>();
  return candidates.filter(({ path }) => !seen.has(path) && seen.add(path));
}

function candidatesInDirectory(
  directory: string,
  fileNames: readonly string[],
  source: ResolvedExecutable["source"],
): ResolvedExecutable[] {
  return fileNames.map((fileName) => {
    const invocationPath = join(directory, fileName);
    return {
      path: invocationPath,
      invocationPath,
      executableDirectory: directory,
      runtimeDirectory: null,
      launchPrefix: Object.freeze([]),
      source,
    };
  });
}

async function knownBinDirectories(provider: ProviderId): Promise<string[]> {
  const layout = providerLayout(provider, PLATFORM_CONTEXT);
  const directories = [...layout.directories];
  if (provider === "codex" && !isWindows(PLATFORM_CONTEXT)) {
    directories.push(...(await nvmBinDirectories()));
  }
  return directories.filter((directory) =>
    isAllowedExecutableDirectory(provider, directory, PLATFORM_CONTEXT),
  );
}

function compareNodeVersions(left: string, right: string): number {
  const leftParts = left.slice(1).split(/[.-]/).map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = right.slice(1).split(/[.-]/).map((value) => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

async function resolveNodeRuntimeDirectory(invocationPath: string): Promise<string | null> {
  const preferred = isWindows(PLATFORM_CONTEXT) ? WINDOWS_NODE_DIRECTORIES : [dirname(invocationPath)];
  const directories = [...preferred, ...(await nvmBinDirectories())];
  for (const directory of [...new Set(directories)]) {
    if (await isTrustedNodeRuntime(directory)) return directory;
  }
  return null;
}

async function isTrustedNodeRuntime(directory: string): Promise<boolean> {
  const nodeName = isWindows(PLATFORM_CONTEXT) ? "node.exe" : "node";
  const nodePath = join(directory, nodeName);
  try {
    await access(nodePath, isWindows(PLATFORM_CONTEXT) ? fsConstants.F_OK : fsConstants.X_OK);
    const canonicalNode = await realpath(nodePath);
    const nodeStat = await stat(canonicalNode);
    if (!nodeStat.isFile() || basename(canonicalNode).toLowerCase() !== nodeName) return false;
    if (isWindows(PLATFORM_CONTEXT)) {
      return WINDOWS_NODE_DIRECTORIES.some((candidate) =>
        pathsEqual(candidate, directory, PLATFORM_CONTEXT),
      );
    }
    if (isNvmBinDirectory(directory, PLATFORM_CONTEXT)) {
      return pathsEqual(canonicalNode, join(directory, "node"), PLATFORM_CONTEXT);
    }
    for (const prefix of ["/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"]) {
      if (pathsEqual(directory, join(prefix, "bin"), PLATFORM_CONTEXT)) {
        return isWithinCanonicalPrefix(join(prefix, "Cellar", "node"), canonicalNode, PLATFORM_CONTEXT);
      }
    }
    if (pathsEqual(directory, "/usr/bin", PLATFORM_CONTEXT)) {
      return isWithinCanonicalPrefix("/usr", canonicalNode, PLATFORM_CONTEXT);
    }
    return false;
  } catch {
    return false;
  }
}

async function nvmBinDirectories(): Promise<string[]> {
  if (isWindows(PLATFORM_CONTEXT)) return [];
  const root = nvmRoot(PLATFORM_CONTEXT);
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && NVM_VERSION_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareNodeVersions)
      .reverse()
      .map((version) => join(root, version, "bin"));
  } catch {
    return [];
  }
}

function unavailableDetection(provider: ProviderId): ProviderDetection {
  return Object.freeze({
    provider,
    available: false,
    version: null,
    executableSource: null,
  });
}
