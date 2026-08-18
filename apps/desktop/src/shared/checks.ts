/**
 * What a check is, and what running one proves.
 *
 * A check is a command the repository already defines for itself -- its tests,
 * its linter, its type checker, its build. Docket does not invent them and does
 * not ask an agent what they are. It reads them out of the repository's own
 * manifest and runs them, because the whole point is to stop taking an agent's
 * word for whether the work holds up.
 *
 * The `declaration` field carries the script body exactly as declared. It is
 * what makes drift detectable: if an agent edits `"test": "vitest"` down to
 * `"test": "true"`, the check still passes, still reports green, and proves
 * nothing. Comparing the working tree's declaration against the committed one
 * turns that from an invisible success into a visible finding.
 */

export type CheckKind = "test" | "lint" | "typecheck" | "build";

/** Order checks are shown and run in: cheapest signal first, build last. */
export const CHECK_KIND_ORDER: readonly CheckKind[] = Object.freeze([
  "typecheck",
  "lint",
  "test",
  "build",
]);

/**
 * How a check is invoked.
 *
 * `npm` is a script name out of `package.json`. `command` is an argv array a
 * repository declared for itself in `docket.json`, which is how a project
 * that is not JavaScript gets served at all.
 */
export type CheckRunner = "npm" | "command";

export type DiscoveredCheck = Readonly<{
  /** Stable across runs, so a result can be matched back to its check. */
  id: string;
  kind: CheckKind;
  /** How the user would say it: "npm run test". */
  label: string;
  runner: CheckRunner;
  /** The script name passed to the runner. Never a shell fragment. */
  script: string;
  /** Manifest this came from, relative to the workspace root. */
  manifestPath: string;
  /** The script body as declared in the working tree. */
  declaration: string;
  /**
   * argv, when `runner` is `command`. Never a shell string: the repository
   * writes a list of arguments and Docket passes that list, so nothing in it
   * can become a second command.
   */
  command?: readonly string[];
  /**
   * The image this check must run in, when the repository named one.
   *
   * A check that names an image does not fall back to the host. The point of
   * naming `python:3.12-bookworm` is that the check needs that environment;
   * running it against whatever this machine happens to have is a different
   * check, and reporting its result as this one's would be a false statement
   * about what was verified.
   */
  image?: string;
}>;

/**
 * Why a declaration differs from the committed one. `absent` means the manifest
 * is not in HEAD at all, which is normal for a new repository and is reported
 * rather than treated as tampering.
 */
export type DriftReason = "changed" | "added" | "absent";

export type CheckDrift = Readonly<{
  checkId: string;
  reason: DriftReason;
  /** What HEAD declares. Null when the script or manifest is not in HEAD. */
  committed: string | null;
  /** What the working tree declares now. */
  working: string;
}>;

export type CheckDiscovery = Readonly<{
  checks: readonly DiscoveredCheck[];
  drift: readonly CheckDrift[];
  /**
   * True when the committed declarations could not be read at all -- no Git, no
   * commits, or a read failure. Drift is unknown rather than absent, and the
   * evidence must say so instead of implying the checks are unmodified.
   */
  committedUnavailable: boolean;
  /**
   * Why the repository's own `docket.json` could not be read.
   *
   * Null when there is no config or it parsed. A broken one is reported here
   * rather than being ignored: silently falling back to npm discovery would
   * let one corrupted file disable a declared gate with nothing said about
   * it, which is the quiet failure this product is built to make loud.
   */
  configError?: string;
}>;

/**
 * Where a check actually ran. `host` means it had the same access as the person
 * who launched Docket, which is weaker evidence than `container` and must never
 * be presented as equivalent.
 *
 * `refused` is not a place: it means the check did not run at all, because
 * isolation was required and none was available. It is a separate value rather
 * than `host` with an error, since recording a run on the host that never
 * happened is the one thing the isolation field exists to prevent.
 */
export type Isolation = "container" | "host" | "refused";

export type CheckOutcome =
  | "passed"
  | "failed"
  /** Could not be started: runner missing, unsupported platform, spawn error. */
  | "errored"
  | "timed-out";

export type CheckResult = Readonly<{
  checkId: string;
  outcome: CheckOutcome;
  /** Null when the process never produced one, as on a spawn failure. */
  exitCode: number | null;
  /** Combined stdout and stderr, in the order the process emitted it. */
  output: string;
  /** True when output hit the cap and the middle was dropped. */
  outputTruncated: boolean;
  durationMs: number;
  /** The exact argv Docket ran, so the reader can reproduce it by hand. */
  argv: readonly string[];
  /** Populated only for `errored`; explains what stopped it. */
  error: string | null;
  /** Where it ran. */
  isolation: Isolation;
  /** Why it was not contained. Null when it was. */
  isolationReason: string | null;
}>;

/** A check passed only if it ran to completion and exited zero. */
export function passed(result: CheckResult): boolean {
  return result.outcome === "passed";
}

/**
 * Whether this run is worth anything as evidence. A check that never ran proves
 * nothing, and must never be summarized as though it did.
 */
export function isEvidence(result: CheckResult): boolean {
  return result.outcome === "passed" || result.outcome === "failed";
}
