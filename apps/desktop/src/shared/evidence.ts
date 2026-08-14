/**
 * The evidence packet.
 *
 * This is the product. Everything else in the app exists to produce it: a
 * reviewer opens one thing, reads what changed, what was proven, what else is
 * affected, and what is left for them to decide.
 *
 * Two rules govern what may appear here, and they are the reason the type is
 * shaped this way rather than as a bag of optional strings.
 *
 * **Nothing asserted that was not observed.** Every field traces to something
 * Docket ran or read: Git for the diff, `git grep` for references, a real
 * process exit for a check. There is no field for what an agent said it did,
 * because an agent's account of its own work is the thing this replaces.
 *
 * **Absence is stated, never implied.** A check that did not run, a comparison
 * that could not be made, a search that was capped -- each has somewhere to say
 * so. A packet that looks complete because the gaps are invisible is worse than
 * no packet, since it converts missing evidence into apparent evidence.
 */
import type { CheckDrift, CheckResult, DiscoveredCheck } from "./checks";
import { isEvidence, passed } from "./checks";

export type PacketFinding = Readonly<{
  /** Stable enough to test against and to key a list on. */
  id: string;
  /** How much it should change the reader's mind, not how loud it looks. */
  severity: "blocking" | "attention" | "note";
  /** One line, stating the fact rather than an instruction. */
  title: string;
  /** Why it matters, in the reviewer's terms. */
  detail: string;
}>;

export type PacketCheck = Readonly<{
  check: DiscoveredCheck;
  /** Null when this check was never run in this session. */
  result: CheckResult | null;
  drift: CheckDrift | null;
}>;

export type EvidencePacket = Readonly<{
  /** What the reviewer said this change was for. Empty when they said nothing. */
  intent: string;
  change: Readonly<{
    files: number;
    added: number;
    removed: number;
    truncated: boolean;
    unavailable: string | null;
  }>;
  checks: readonly PacketCheck[];
  reach: Readonly<{
    /** Symbols referenced outside the changed files, widest first. */
    references: readonly Readonly<{ symbol: string; files: readonly string[]; truncated: boolean }>[];
    contained: readonly string[];
    unavailable: string | null;
  }>;
  /** What is actually left for a person. Empty means nothing is blocking. */
  findings: readonly PacketFinding[];
  /** True only when every declared check ran and passed with no unknowns. */
  clean: boolean;
}>;

type Inputs = Readonly<{
  intent: string;
  change: EvidencePacket["change"];
  checks: readonly PacketCheck[];
  reach: EvidencePacket["reach"];
  committedUnavailable: boolean;
}>;

/**
 * Turns observations into the short list a reviewer actually acts on.
 *
 * Ordering is by consequence, not by how easy each is to describe. A suite
 * whose definition was edited outranks a failing suite, because a red result is
 * information and a quietly weakened one is the absence of it.
 */
export function assemblePacket(inputs: Inputs): EvidencePacket {
  const findings: PacketFinding[] = [];

  for (const entry of inputs.checks) {
    if (entry.drift?.reason === "changed") {
      findings.push({
        id: `drift:${entry.check.id}`,
        severity: "blocking",
        title: `${entry.check.label} was edited since the last commit`,
        detail: `Committed as \`${entry.drift.committed}\`, now \`${entry.drift.working}\`. A result from this check cannot be compared against the one the repository agreed on, and a pass proves less than it appears to.`,
      });
    }
  }

  for (const entry of inputs.checks) {
    const { result, check } = entry;
    if (!result) {
      findings.push({
        id: `unrun:${check.id}`,
        severity: "attention",
        title: `${check.label} has not been run`,
        detail: "The repository declares this check. Until it runs, nothing here says whether it still passes.",
      });
      continue;
    }
    if (result.outcome === "failed") {
      findings.push({
        id: `failed:${check.id}`,
        severity: "blocking",
        title: `${check.label} failed`,
        detail: `Exited ${result.exitCode}. The output is attached in full.`,
      });
      continue;
    }
    if (!isEvidence(result)) {
      findings.push({
        id: `unproven:${check.id}`,
        severity: "attention",
        title: `${check.label} did not finish`,
        detail: `${result.error ?? "It did not run to completion."} This is not a failure and not a pass: it is an absence of evidence.`,
      });
    }
  }

  if (inputs.checks.length === 0) {
    findings.push({
      id: "no-checks",
      severity: "attention",
      title: "This repository declares no checks",
      detail: "There is no test, lint, typecheck, or build script to run, so nothing here is verified by the project's own tooling.",
    });
  }

  if (inputs.committedUnavailable && inputs.checks.length > 0) {
    findings.push({
      id: "drift-unknown",
      severity: "attention",
      title: "Docket could not tell whether the checks were modified",
      detail: "The committed versions could not be read, so a pass here is unverified rather than confirmed.",
    });
  }

  if (inputs.change.unavailable) {
    findings.push({
      id: "diff-unavailable",
      severity: "attention",
      title: "Docket could not read what changed",
      detail: inputs.change.unavailable,
    });
  }

  // Reach is a note, never blocking. Wide reach is a reason to read carefully,
  // not evidence that something is wrong, and marking it blocking would train
  // the reader to dismiss the level that does mean stop.
  const widest = inputs.reach.references[0];
  if (widest && widest.files.length >= 3) {
    findings.push({
      id: `reach:${widest.symbol}`,
      severity: "note",
      title: `\`${widest.symbol}\` is referenced in ${widest.files.length}${widest.truncated ? "+" : ""} files outside this change`,
      detail: "A small edit to something this widely referenced is not a small change. The referencing files are listed below.",
    });
  }

  const order = { blocking: 0, attention: 1, note: 2 } as const;
  findings.sort((left, right) => order[left.severity] - order[right.severity]);

  const ran = inputs.checks.filter((entry) => entry.result !== null);
  const clean =
    inputs.checks.length > 0 &&
    ran.length === inputs.checks.length &&
    ran.every((entry) => entry.result !== null && passed(entry.result)) &&
    !inputs.committedUnavailable &&
    inputs.change.unavailable === null &&
    !inputs.checks.some((entry) => entry.drift?.reason === "changed");

  return {
    intent: inputs.intent,
    change: inputs.change,
    checks: inputs.checks,
    reach: inputs.reach,
    findings,
    clean,
  };
}

/**
 * The one-line verdict, chosen so it can never overstate what was established.
 *
 * Severity is read before cleanliness, and a clean packet that still carries
 * notes says so. "Every declared check ran and passed" is true in that case but
 * reads as "nothing to see here", and a reviewer who stops at the summary would
 * never learn the change touches something referenced in a dozen files.
 */
export function verdict(packet: EvidencePacket): string {
  if (packet.findings.some((finding) => finding.severity === "blocking")) {
    return "Something here should stop a merge.";
  }
  if (packet.findings.some((finding) => finding.severity === "attention")) {
    return "Nothing is failing, but not everything is proven.";
  }

  const notes = packet.findings.length;
  if (packet.clean && notes > 0) {
    return `Every declared check ran and passed. ${notes === 1 ? "One note" : `${notes} notes`} to read first.`;
  }
  if (packet.clean) return "Every declared check ran and passed.";
  return "Nothing to report.";
}
