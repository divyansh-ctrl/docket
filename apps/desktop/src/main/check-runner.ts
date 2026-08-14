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
 * and it is the honest reason per-unit container isolation is the next item on
 * the roadmap rather than a nice-to-have: today a check runs with the same
 * reach as the person who launched Docket.
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
import type { CheckOutcome, CheckResult, DiscoveredCheck } from "../shared/checks";

/** Long enough for a real suite, short enough that a hang is reported not waited on. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** Output kept per check. Enough to diagnose; bounded so a loop cannot exhaust memory. */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** After the cap, keep this much of the tail: failures print at the end. */
const TAIL_BYTES = 96 * 1024;

export type RunOptions = Readonly<{
  timeoutMs?: number;
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

  const runner = await resolveNpm();
  if (!runner.path) {
    return errored(check, [], started, runner.reason);
  }

  const argv = [runner.path, "run", check.script] as const;
  return await execute(workspaceRoot, check, argv, started, options);
}

function execute(
  cwd: string,
  check: DiscoveredCheck,
  argv: readonly string[],
  started: number,
  options: RunOptions,
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
      resolve(errored(check, argv, started, message(error)));
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

    child.on("error", (error) => finish(errored(check, argv, started, message(error))));

    child.on("close", (code) => {
      const { text, truncated } = assemble(chunks, bytes);
      const aborted = options.signal?.aborted ?? false;

      let outcome: CheckOutcome;
      if (timedOut) outcome = "timed-out";
      else if (aborted) outcome = "errored";
      else outcome = code === 0 ? "passed" : "failed";

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
            : null,
      });
    });
  });
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
