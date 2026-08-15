/**
 * Running a check inside a container instead of on the machine.
 *
 * A check is the repository's own script, and npm runs it in a shell. Until
 * now that shell had everything the person who launched Docket has: their SSH
 * keys, their cloud credentials, their whole filesystem, and the network. The
 * roadmap calls a Git worktree "not a security boundary" and this is the
 * sentence that makes it true -- the worktree isolates the *changes*, not the
 * process making them.
 *
 * Three decisions shape this module.
 *
 * **The runtime is optional.** Requiring Docker Desktop is the named weakness
 * of the closest comparable product, and a gate nobody can install gates
 * nothing. When no runtime is present the check still runs, on the host, and
 * says so.
 *
 * **Saying so is the point.** An unisolated run is weaker evidence than an
 * isolated one, and the difference has to reach the packet rather than being
 * flattened into a green tick. Every result carries how it ran and why.
 *
 * **Nothing here builds a shell string.** The runtime is spawned with a fixed
 * argument vector, exactly like the host path.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5_000;

/** Runtimes that accept the Docker CLI surface this module uses. */
const CANDIDATES = ["docker", "podman"] as const;
export type RuntimeName = (typeof CANDIDATES)[number];

export type RuntimeStatus = Readonly<{
  /** Null when nothing usable was found. */
  command: RuntimeName | null;
  /** Why there is no runtime, for the reader rather than for a log. */
  reason: string;
}>;

/**
 * The image checks run in.
 *
 * Pinned by digest-less tag deliberately for now: discovery only understands
 * npm scripts, so a Node image is the only coherent default, and a repository
 * needing something else is better served by an explicit setting later than by
 * a guess now. Alpine is avoided because native modules commonly fail on musl,
 * and a check that fails for the runner's reasons is worse than no check.
 */
export const DEFAULT_IMAGE = "node:22-bookworm-slim";

/** Where the workspace is mounted. Fixed, so the argv stays constant-shaped. */
const WORKDIR = "/workspace";

export type ContainerOptions = Readonly<{
  runtime: RuntimeName;
  workspaceRoot: string;
  image?: string;
  /** Passed straight through as the command; never joined into a string. */
  command: readonly string[];
  /** Host uid:gid, so files the check writes are not left owned by root. */
  user?: string;
  memory?: string;
  cpus?: string;
}>;

/**
 * Builds the argument vector for one containerised check.
 *
 * Exported separately from running it so the flags can be asserted in a test
 * on a machine with no container runtime, which is most machines in CI.
 */
export function containerArgv(options: ContainerOptions): readonly string[] {
  const {
    runtime,
    workspaceRoot,
    image = DEFAULT_IMAGE,
    command,
    user,
    memory = "4g",
    cpus = "2",
  } = options;

  return [
    runtime,
    "run",
    "--rm",
    // Default-deny egress. The single most valuable flag here: a check has no
    // reason to reach the network, and a compromised dependency's first move
    // is to phone home with whatever it found.
    "--network",
    "none",
    // Drop every capability, then refuse to regain any. A build script has no
    // business changing system time or raw-socketing.
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    // A fork bomb in a postinstall script should exhaust the container, not
    // the laptop.
    "--pids-limit",
    "512",
    "--memory",
    memory,
    "--cpus",
    cpus,
    ...(user ? ["--user", user] : []),
    // Only the workspace is visible. Not the home directory, not the SSH keys,
    // not the credential files the provider CLIs keep.
    "--volume",
    `${workspaceRoot}:${WORKDIR}`,
    "--workdir",
    WORKDIR,
    // The host environment is not inherited. These two are set for the same
    // reason as on the host path: non-interactive, uncoloured output.
    "--env",
    "CI=1",
    "--env",
    "NO_COLOR=1",
    image,
    ...command,
  ];
}

let cached: RuntimeStatus | null = null;

/**
 * Finds a usable container runtime, or explains why there is none.
 *
 * The binary existing is not enough: Docker Desktop can be installed and not
 * running, which is the common case on a laptop and produces a confusing
 * failure at run time rather than a clear one here. `info` is the cheapest
 * command that actually talks to the daemon.
 */
export async function detectRuntime(refresh = false): Promise<RuntimeStatus> {
  if (!refresh && cached) return cached;

  for (const command of CANDIDATES) {
    try {
      await execFileAsync(command, ["info"], { timeout: PROBE_TIMEOUT_MS, windowsHide: true });
      cached = { command, reason: "" };
      return cached;
    } catch {
      // Not installed, or installed and not running. Either way, not usable.
    }
  }

  cached = {
    command: null,
    reason:
      "No container runtime is available, so checks run directly on this machine with the same access you have. Install Docker or Podman to contain them.",
  };
  return cached;
}

/** Test seam: forget the probe so a changed environment is seen. */
export function resetRuntimeCache(): void {
  cached = null;
}
