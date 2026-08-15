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

export type CheckRunner = "npm";

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
}>;

/**
 * Where a check actually ran. `host` means it had the same access as the person
 * who launched Docket, which is weaker evidence than `container` and must never
 * be presented as equivalent.
 */
export type Isolation = "container" | "host";

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
