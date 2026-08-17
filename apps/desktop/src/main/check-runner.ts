/**
 * Runs a discovered check and records what actually happened.
 *
 * Docket never builds a shell string. It resolves a real package-manager
 * executable and spawns it with a fixed argument vector, `["run", <script>]`,
 * where the script name came from the repository's own manifest and is checked
 * against that manifest again here. Nothing an agent writes is ever passed to a
 * shell by Docket.
 *
 * The script body itself is a shell command, and npm will run it in a shell.
 * That is unavoidable when the thing being verified is a JavaScript repository,
 * which is why the shell is put inside a container when one is available: see
 * `container.ts`. Without a runtime the check still runs, on the host, with the
 * same reach as the person who launched Docket -- and the result says so, so a
 * reviewer is never told a contained run and an uncontained one are the same
 * evidence.
 *
 * A result is only evidence if the process actually ran. A spawn failure, a
 * missing runner, or a timeout are recorded as themselves and never collapsed
 * into "failed", because "the tests did not run" and "the tests failed" lead a
 * reviewer to opposite conclusions.
 */
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { userInfo } from "node:os";
import type { CheckOutcome, CheckResult, DiscoveredCheck, Isolation } from "../shared/checks";
import {
  canSeeWorkspace,
  containerArgv,
  containerName,
  dependenciesLoadable,
  ensureDependencies,
  gitUsable,
  killArgv,
  planDependencies,
  resolveMount,
  type Dependencies,
  type RuntimeName,
  detectRuntime,
} from "./container";

/** Distinguishes concurrent runs of the same check within one process. */
let runCounter = 0;

/**
 * Removes a container by name, best effort.
 *
 * Fire and forget: this runs while a check is being cancelled or timed out, and
 * a failure here is not something the reader of a packet can act on. The
 * container is already `--rm`, so the common case is that it has exited on its
 * own and this finds nothing.
 */
function removeContainer(runtime: RuntimeName, name: string): void {
  const [command, ...args] = killArgv(runtime, name);
  try {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: false });
    child.on("error", () => {
      // Runtime gone, or the container already removed. Nothing to report.
    });
  } catch {
    // Spawning the cleanup must never take down the run it is cleaning up after.
  }
}

/** Long enough for a real suite, short enough that a hang is reported not waited on. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** Output kept per check. Enough to diagnose; bounded so a loop cannot exhaust memory. */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** After the cap, keep this much of the tail: failures print at the end. */
const TAIL_BYTES = 96 * 1024;

export type RunOptions = Readonly<{
  timeoutMs?: number;
  /** Skips the runtime probe. Used by tests to force the host path. */
  forceHost?: boolean;
  /**
   * Refuse to run at all rather than fall back to the host.
   *
   * Off by default, and deliberately: most machines have no container runtime,
   * and a gate that refuses to run on first launch gates nothing. Turning it on
   * is a statement that a host result is not evidence you are willing to act
   * on, and Docket then reports nothing instead of reporting something weaker.
   */
  requireIsolation?: boolean;
  signal?: AbortSignal;
  /** Called with each chunk as it arrives, so the UI can stream rather than wait. */
  onOutput?: (chunk: string) => void;
}>;

export async function runCheck(
  workspaceRoot: string,
  check: DiscoveredCheck,
  manifestScripts: Readonly<Record<string, string>>,
  options: RunOptions = {},
): Promise<CheckResult> {
  const started = Date.now();

  // Re-validate against the manifest at call time. The discovery result may have
  // been sitting in the renderer, and a script name is the only part of the argv
  // that is not a constant.
  if (typeof manifestScripts[check.script] !== "string") {
    return errored(check, [], started, `No script named "${check.script}" in ${check.manifestPath}`);
  }

  const runtime = options.forceHost ? { command: null, reason: "Forced onto the host." } : await detectRuntime();

  // Why the contained path is not being taken. Null means it is.
  let blocked: string | null = runtime.command ? null : runtime.reason;

  // The repository, when the workspace is in one. A check declared by a
  // monorepo package routinely reads across the repository -- a sibling
  // manifest, a shared fixture, a config file at the root -- and mounting only
  // the package makes those files not exist, which surfaces as the
  // repository's own tests failing for a reason that is not in its code.
  const mount = runtime.command ? await resolveMount(workspaceRoot) : null;

  if (runtime.command && mount) {
    // Having a runtime is not the same as that runtime being able to see the
    // repository. A bind mount of a path it cannot reach does not fail -- it
    // mounts as an empty directory, and the check then reports the
    // repository's tests as failing when the container never saw them.
    const visible = await canSeeWorkspace(runtime.command, mount, check.manifestPath);
    if (!visible.ok) blocked = visible.reason;
  }

  if (runtime.command && mount && blocked === null) {
    // Seeing the repository is not the same as being able to run it. A linked
    // worktree's Git directory is outside the mount, so Git does not work
    // inside the container at all -- observed, not imagined, and it reaches a
    // reviewer as the repository's own tests failing.
    const git = await gitUsable(mount);
    if (!git.ok) blocked = git.reason;
  }

  // The dependencies the check will run against. Container-local when Docket
  // can install them there, which is the only arrangement that makes a
  // contained run equivalent to a host one: node_modules in the mount belongs
  // to this machine, and anything in it with a compiled component holds a
  // binary this container cannot load.
  let dependencies: Dependencies | undefined;

  if (runtime.command && mount && blocked === null) {
    const plan = await planDependencies(mount);
    if (plan.ok) {
      const ready = await ensureDependencies({
        runtime: runtime.command,
        mount,
        dependencies: plan.dependencies,
        user: hostUser(),
        name: containerName(`install-${check.id}`, `${process.pid}-${runCounter++}`),
        onOutput: options.onOutput,
      });
      if (ready.ok) dependencies = plan.dependencies;
      else blocked = ready.reason;
    } else {
      // No container-local install is possible here, so the run would be
      // against what this machine installed. That is fine when this machine
      // and the container agree, and only then.
      const loadable = await dependenciesLoadable(mount);
      blocked = loadable.ok ? null : `${plan.reason} ${loadable.reason}`;
    }
  }

  if (runtime.command && mount && blocked === null) {
    // npm inside the image, not the host's npm: the container has its own.
    const name = containerName(check.id, `${process.pid}-${runCounter++}`);
    const argv = containerArgv({
      runtime: runtime.command,
      mount,
      command: ["npm", "run", check.script],
      user: hostUser(),
      name,
      dependencies,
    });
    // Killing the client leaves the container running under the daemon, so
    // cancellation has to reach the container by name as well.
    const onKill = () => removeContainer(runtime.command as RuntimeName, name);
    // Contained, and still not always the run a reviewer would assume. A
    // narrowed mount saw less of the repository than the repository is; an
    // unpinned install ran against versions nobody chose. Both travel with the
    // result rather than being flattened into a green tick.
    const caveats = [mount.narrowed, dependencies?.caveat ?? ""].filter(Boolean).join(" ");
    return await execute(
      workspaceRoot,
      check,
      argv,
      started,
      options,
      "container",
      caveats || null,
      onKill,
    );
  }

  // Fail closed. Reached when isolation was asked for and is not available --
  // no runtime, or a runtime that cannot see this repository.
  if (options.requireIsolation) {
    return errored(
      check,
      [],
      started,
      `${blocked} You have required checks to run contained, so this one was not run.`,
      "refused",
      blocked,
    );
  }

  const runner = await resolveNpm();
  if (!runner.path) {
    return errored(check, [], started, runner.reason, "host", blocked);
  }

  const argv = [runner.path, "run", check.script] as const;
  return await execute(workspaceRoot, check, argv, started, options, "host", blocked);
}

/**
 * uid:gid of the current user, so files a check writes into the mounted
 * workspace are owned by them rather than by root. Windows has no such ids and
 * does not reach this path yet.
 */
function hostUser(): string | undefined {
  try {
    const { uid, gid } = userInfo();
    return uid >= 0 && gid >= 0 ? `${uid}:${gid}` : undefined;
  } catch {
    return undefined;
  }
}

function execute(
  cwd: string,
  check: DiscoveredCheck,
  argv: readonly string[],
  started: number,
  options: RunOptions,
  isolation: Isolation,
  isolationReason: string | null,
  onKill?: () => void,
): Promise<CheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<CheckResult>((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        // Never a shell. The repository's script gets one from npm; Docket does
        // not add a second one it would have to escape for.
        shell: false,
        windowsHide: true,
        // Own process group, so cancelling kills the whole tree. npm spawns a
        // shell which spawns the real runner; signalling npm alone leaves those
        // grandchildren alive, holding the output pipe open until they finish
        // on their own. A timeout that waits for the hang it is meant to stop
        // is not a timeout.
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          // Makes runners non-interactive and stops watch modes from hanging a
          // check forever. Repositories already expect this in CI.
          CI: "1",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(errored(check, argv, started, message(error), isolation, isolationReason));
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let timedOut = false;

    const collect = (data: Buffer) => {
      bytes += data.length;
      chunks.push(data);
      options.onOutput?.(data.toString("utf8"));
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    /** Kills the process group when there is one, else just the child. */
    const killTree = () => {
      // The container first, if there is one. Signalling only the client leaves
      // the work running with nowhere to report, which is the defect this
      // whole kill path exists to avoid.
      onKill?.();
      const pid = child.pid;
      if (pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-pid, "SIGKILL");
          return;
        } catch {
          // Group already gone, or never created. Fall through to the child.
        }
      }
      child.kill("SIGKILL");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    const onAbort = () => killTree();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    child.on("error", (error) =>
      finish(errored(check, argv, started, message(error), isolation, isolationReason)),
    );

    child.on("close", (code) => {
      const { text, truncated } = assemble(chunks, bytes);
      const aborted = options.signal?.aborted ?? false;

      // A non-zero exit is only a failure if the thing that exited was the
      // code. "The tests did not run" and "the tests failed" lead a reviewer to
      // opposite conclusions, and that rule does not stop at the container wall.
      let environment: string | null = null;
      let outcome: CheckOutcome;
      if (timedOut) outcome = "timed-out";
      else if (aborted) outcome = "errored";
      else if (code === 0) outcome = "passed";
      else {
        environment = environmentFailure(text);
        outcome = environment ? "errored" : "failed";
      }

      finish({
        checkId: check.id,
        outcome,
        exitCode: code,
        output: text,
        outputTruncated: truncated,
        durationMs: Date.now() - started,
        argv,
        error: timedOut
          ? `Killed after ${Math.round(timeoutMs / 1000)}s without finishing`
          : aborted
            ? "Cancelled"
            : environment,
        isolation,
        isolationReason,
      });
    });
  });
}

/**
 * Signatures of a run that failed for the environment's reasons rather than the
 * code's.
 *
 * Every entry was observed, not imagined: these are the messages this
 * repository's own suite produced when it was run inside a container against
 * dependencies installed on the host, in an image with no Git and no account
 * entry for the uid it was given.
 *
 * The patterns are narrow, and the direction of the remaining risk is the
 * reason this is worth doing at all. A false positive calls a real failure
 * "did not run", which costs the reviewer a finding but asserts nothing untrue
 * -- the packet says there is no evidence, and it is right that there is none
 * it can vouch for. A false negative tells a reviewer their code is broken when
 * it is not. Only one of those is a lie, so the classification leans toward the
 * other one, and quotes the line it matched so the reader can check the call.
 */
const ENVIRONMENT_SIGNATURES: readonly Readonly<{ pattern: RegExp; explain: string }>[] =
  Object.freeze([
    {
      // node-pty's loader, prebuild-install's, and Node's own dlopen each phrase
      // this differently, so each phrasing is listed rather than generalised.
      pattern:
        /Failed to load native module|invalid ELF header|ERR_DLOPEN_FAILED|is not a valid Win32 application|incompatible architecture/,
      explain:
        "A compiled dependency could not be loaded, which means the installed dependencies were built for a different platform than the one this ran on.",
    },
    {
      pattern: /was compiled against a different Node\.js version/,
      explain:
        "A compiled dependency was built for a different version of Node.js than the one this ran on.",
    },
    {
      // `spawn git ENOENT` is the one that bites first: a check shelling out to
      // Git is ordinary, and an image without Git fails fifteen tests at once.
      pattern: /\bspawn \S+ ENOENT\b/,
      explain: "A program this check runs is not installed where it ran.",
    },
    {
      // What a shell prints for the same thing: `sh: 1: git: not found`.
      pattern: /^.*: (?:command )?not found[ \t]*$/m,
      explain: "A program this check runs is not installed where it ran.",
    },
    {
      pattern: /uv_os_get_passwd returned ENOENT/,
      explain:
        "The user this ran as has no account entry, so the home directory could not be resolved.",
    },
  ]);

/**
 * Whether this output says the environment broke rather than the code.
 *
 * Returns the reason, quoting the line that decided it, or null when nothing
 * matched. Read from the output as the reader will see it, truncation included,
 * so a claim here is always one the reader can verify against the same text.
 */
export function environmentFailure(output: string): string | null {
  for (const { pattern, explain } of ENVIRONMENT_SIGNATURES) {
    const match = pattern.exec(output);
    if (!match) continue;

    const line = (output.slice(0, match.index).split("\n").pop() ?? "") + match[0];
    return `${explain} This is not a result about the code, so it is recorded as no evidence rather than as a failure. The output says: ${line.trim().slice(0, 200)}`;
  }
  return null;
}

/**
 * Keeps the head and the tail and drops the middle. A truncated tail would hide
 * the failure summary, which is the part the reviewer opened this to read.
 */
function assemble(chunks: readonly Buffer[], bytes: number): { text: string; truncated: boolean } {
  const joined = Buffer.concat(chunks as Buffer[], bytes);
  if (joined.length <= MAX_OUTPUT_BYTES) {
    return { text: joined.toString("utf8"), truncated: false };
  }

  const head = joined.subarray(0, MAX_OUTPUT_BYTES - TAIL_BYTES).toString("utf8");
  const tail = joined.subarray(joined.length - TAIL_BYTES).toString("utf8");
  const dropped = joined.length - MAX_OUTPUT_BYTES;
  return {
    text: `${head}\n\n[Docket dropped ${dropped} bytes of output here]\n\n${tail}`,
    truncated: true,
  };
}

function errored(
  check: DiscoveredCheck,
  argv: readonly string[],
  started: number,
  reason: string,
  isolation: Isolation = "host",
  isolationReason: string | null = null,
): CheckResult {
  return {
    checkId: check.id,
    outcome: "errored",
    exitCode: null,
    output: "",
    outputTruncated: false,
    durationMs: Date.now() - started,
    argv,
    error: reason,
    isolation,
    isolationReason,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ResolvedRunner = Readonly<{ path: string | null; reason: string }>;

let cached: ResolvedRunner | null = null;

/**
 * Finds npm on PATH.
 *
 * On Windows npm is a `.cmd` shim, which Node refuses to spawn without
 * `shell: true`. Turning the shell on to work around that would put a shell
 * back in Docket's own command construction, so this reports the platform as
 * unsupported instead. A missing feature is recoverable; a shell injection in
 * the thing that is supposed to be the safe runner is not.
 */
export async function resolveNpm(refresh = false): Promise<ResolvedRunner> {
  if (!refresh && cached) return cached;

  if (process.platform === "win32") {
    cached = {
      path: null,
      reason: "Running checks is not supported on Windows yet: npm is a .cmd shim that cannot be launched without a shell.",
    };
    return cached;
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, "npm");
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, fsConstants.X_OK);
      cached = { path: candidate, reason: "" };
      return cached;
    } catch {
      // Not here, or not executable. Keep looking.
    }
  }

  cached = { path: null, reason: "npm was not found on PATH" };
  return cached;
}

/** Test seam: forget the resolved runner so PATH changes take effect. */
export function resetRunnerCache(): void {
  cached = null;
}
