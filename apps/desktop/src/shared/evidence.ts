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
import type { AgentClaim } from "./claims";
import { compareIntent, type IntentComparison } from "./intent";
import type { SecretScan } from "./secrets";
import type { SensitiveChange } from "./sensitive-paths";

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
  /**
   * The intent held against the paths and symbols that actually changed.
   *
   * Recorded as a comparison, never as a judgement. Whether a change does what
   * was asked is not something Docket can establish, so the strongest thing
   * here is a question about a named thing nothing touched.
   */
  intentCheck: IntentComparison;
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
  /**
   * What agents said about the checks, verbatim and attributed. Recorded as
   * input to be compared, never as evidence: the comparison's findings are
   * what carry weight, and every claim keeps its own words so the reader can
   * judge the reading.
   */
  claims: readonly AgentClaim[];
  /** What is actually left for a person. Empty means nothing is blocking. */
  findings: readonly PacketFinding[];
  /** True only when every declared check ran and passed with no unknowns. */
  clean: boolean;
}>;

type Inputs = Readonly<{
  intent: string;
  /** True when the symbol scan stopped at its cap. */
  symbolsTruncated?: boolean;
  /** New files whose contents could not be read for declarations. */
  symbolsUnread?: number;
  /** Credential shapes among the lines this change adds. */
  secrets?: SecretScan;
  /** New files whose contents could not be read for the secret scan. */
  secretsUnread?: number;
  /** Changed paths that govern how this change was verified. */
  governing?: readonly SensitiveChange[];
  /** Changed paths, for holding the intent against something observed. */
  changedFiles: readonly string[];
  /** Declaration names added or removed, same purpose. */
  changedSymbols: readonly string[];
  change: EvidencePacket["change"];
  checks: readonly PacketCheck[];
  reach: EvidencePacket["reach"];
  committedUnavailable: boolean;
  /** Why the repository's own docket.json could not be read, if it could not. */
  configError?: string;
  claims: readonly AgentClaim[];
}>;

/**
 * Turns observations into the short list a reviewer actually acts on.
 *
 * Ordering is by consequence, not by how easy each is to describe. A suite
 * whose definition was edited outranks a failing suite, because a red result is
 * information and a quietly weakened one is the absence of it.
 */
const KIND_PHRASE = {
  test: "the tests",
  lint: "the linter",
  typecheck: "the typecheck",
  build: "the build",
} as const;

export function assemblePacket(inputs: Inputs): EvidencePacket {
  const findings: PacketFinding[] = [];

  // The divergence case, first because it is the product. An agent said the
  // checks pass; Docket ran them; where those disagree is the one finding
  // this packet exists above all others to surface. Pushed ahead of drift so
  // the stable sort keeps it at the very top of the blocking group.
  let agreed = 0;
  for (const claim of inputs.claims) {
    const entry = inputs.checks.find((candidate) => candidate.check.kind === claim.kind);
    const result = entry?.result ?? null;
    const observed = result && isEvidence(result) ? (passed(result) ? "passed" : "failed") : null;

    if (observed === null) {
      if (claim.verdict === "passed") {
        findings.push({
          id: `claim-unverified:${claim.kind}`,
          severity: "attention",
          title: `An agent says ${KIND_PHRASE[claim.kind]} pass. Nothing here confirms it.`,
          detail: `The claim, verbatim: "${claim.text}". ${entry ? `${entry.check.label} has not produced a result in this session` : "This repository declares no such check"}, so the claim is unverified -- not contradicted, and not confirmed. Run the check and the packet will say which.`,
        });
      }
      continue;
    }

    if (observed === claim.verdict) {
      agreed += 1;
      continue;
    }

    if (claim.verdict === "passed") {
      findings.push({
        id: `divergence:${claim.kind}`,
        severity: "blocking",
        title: `An agent says ${KIND_PHRASE[claim.kind]} pass. They fail.`,
        detail: `The claim, verbatim: "${claim.text}". Observed: ${entry?.check.label ?? claim.kind} exited ${result?.exitCode ?? "non-zero"}. The disagreement between an agent's account and an observed run is exactly what this packet exists to catch -- read the check's output before anything else here.`,
      });
    } else {
      findings.push({
        id: `divergence-inverse:${claim.kind}`,
        severity: "attention",
        title: `An agent says ${KIND_PHRASE[claim.kind]} fail. They pass.`,
        detail: `The claim, verbatim: "${claim.text}". Observed: ${entry?.check.label ?? claim.kind} exited 0. Pleasant direction, same problem: the account and the observation disagree, and the reason is unexplained.`,
      });
    }
  }

  if (agreed > 0) {
    findings.push({
      id: "claims-agree",
      severity: "note",
      title:
        agreed === 1
          ? "One agent claim matched the observed result"
          : `${agreed} agent claims matched the observed results`,
      detail: "Recorded because the absence of divergence is a checked fact here, not a default. The claims and the runs they were compared against are all in this packet.",
    });
  }

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
    // Reported before the generic "did not finish", because the reason matters:
    // this check did not fail to run, it was deliberately not run, and the
    // reader is owed the difference along with the remedy.
    if (result.isolation === "refused") {
      findings.push({
        id: `refused:${check.id}`,
        severity: "attention",
        title: `${check.label} was not run: isolation was required and unavailable`,
        detail: `${result.isolationReason ?? "No container runtime was available."} You asked for contained runs, so Docket reported nothing rather than producing a weaker result than you asked for. Install a runtime, or turn the requirement off and accept a host run.`,
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

  // A repository declared its own checks and the declaration is unreadable.
  // Blocking, and above drift: with no parseable config there are no checks
  // at all, so every other finding is being made about a gate that did not
  // run. Left as a quiet "no checks found" this reads like a repository that
  // simply has none, which is the most useful lie an agent could arrange.
  if (inputs.configError) {
    findings.push({
      id: "config-unreadable",
      severity: "blocking",
      title: "This repository declares its own checks, and the declaration cannot be read",
      detail: `${inputs.configError} Until it parses, Docket has no checks to run here -- which is not the same as a repository with no checks, and must not be read as one.`,
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

  // What governs the verification, as opposed to what the change does. These
  // decide what the rest of this packet is worth, so they are stated near the
  // top of the reader's attention and never as an accusation: editing CI is
  // ordinary work, and a gate that blocked every branch touching a workflow
  // would be overridden within a week and then be stopping nothing.
  for (const change of inputs.governing ?? []) {
    findings.push({
      id: `governing:${change.categoryId}`,
      severity: change.severity,
      title:
        change.paths.length === 1
          ? `This change edits ${change.label}: ${change.paths[0]}`
          : `This change edits ${change.label} in ${change.paths.length} files`,
      detail: `${change.paths.join(", ")}. ${change.consequence}`,
    });
  }

  // Credential shapes in the added lines. Every word here is about the line
  // rather than about the world: Docket has not checked whether a key is live,
  // a fixture, or revoked, and saying "a secret was leaked" would assert all
  // three. What was observed is a shape, and the shape is what is reported.
  const secrets = inputs.secrets;
  const allNamed = secrets?.matches.filter((match) => match.confidence === "named") ?? [];
  const generic = secrets?.matches.filter((match) => match.confidence === "generic") ?? [];
  // Where it sits changes how loudly it is said, never whether it is said. A
  // shape in a test fixture is usually deliberate; a rule that went quiet in
  // test directories would be an instruction for where to hide a live one.
  const named = allNamed.filter((match) => !match.fixture);
  const fixtures = allNamed.filter((match) => match.fixture);

  if (fixtures.length > 0) {
    findings.push({
      id: `secret-fixture:${fixtures.length}`,
      severity: "attention",
      title:
        fixtures.length === 1
          ? "A credential-shaped string was added in a test or documentation file"
          : `${fixtures.length} credential-shaped strings were added in test or documentation files`,
      detail: `${fixtures
        .map((match) => `${match.path}:${match.line} matches ${match.label} (${match.preview})`)
        .join(". ")}. Reported at this level because of where these are, not because Docket checked them: a fixture is the usual reason for a key shape in a test, and it is also where someone would put a real one to get it past a scanner. The paths are above so you can tell which this is.`,
    });
  }

  if (named.length > 0) {
    findings.push({
      id: `secret-shapes:${named.map((match) => match.ruleId).join(",")}`,
      severity: "blocking",
      title:
        named.length === 1
          ? `This change adds ${named[0].label}`
          : `This change adds ${named.length} credential-shaped strings`,
      detail: `${named
        .map((match) => `${match.path}:${match.line} matches ${match.label} (${match.preview})`)
        .join(". ")}. These shapes identify their own issuer, so the match is near-certain -- but whether the value is live, a fixture, or already revoked is not something Docket checked, and the values are masked here rather than repeated into this packet.`,
    });
  }

  if (generic.length > 0) {
    findings.push({
      id: `secret-assignments:${generic.length}`,
      severity: "attention",
      title:
        generic.length === 1
          ? "A long value is assigned to a secret-sounding name"
          : `${generic.length} long values are assigned to secret-sounding names`,
      detail: `${generic
        .map((match) => `${match.path}:${match.line} (${match.preview})`)
        .join(". ")}. This is a guess about a variable name and a string long enough to be real -- weaker evidence than the shapes above, and reported apart from them for that reason. Obvious placeholders were excluded.`,
    });
  }

  if (secrets?.truncated) {
    findings.push({
      id: "secret-scan-truncated",
      severity: "attention",
      title: "The scan for credential shapes stopped at its limit",
      detail: "This change adds more lines than Docket scans. What is listed above is real; the rest was never looked at, so the absence of further findings here means nothing.",
    });
  }

  if ((inputs.secretsUnread ?? 0) > 0) {
    const count = inputs.secretsUnread ?? 0;
    findings.push({
      id: "secret-scan-unread",
      severity: "attention",
      title:
        count === 1
          ? "One new file could not be read for the credential scan"
          : `${count} new files could not be read for the credential scan`,
      detail: "Those files were not scanned. A clean result here covers what was read, and says nothing about what was not.",
    });
  }

  // A short symbol list has two innocent readings and one dangerous one: the
  // change declared little, the scan stopped early, or a file would not open.
  // Reach and the intent comparison both rest on this list, so which of the
  // three it is has to be readable rather than guessed at.
  if (inputs.symbolsTruncated) {
    findings.push({
      id: "symbols-truncated",
      severity: "note",
      title: "The scan for changed declarations stopped at its limit",
      detail: "This change declares more names than Docket follows. What is listed below is real; what is missing was never searched for, so the reach section is a floor rather than a total.",
    });
  }

  if ((inputs.symbolsUnread ?? 0) > 0) {
    const count = inputs.symbolsUnread ?? 0;
    findings.push({
      id: "symbols-unread",
      severity: "note",
      title:
        count === 1
          ? "One new file could not be read for declarations"
          : `${count} new files could not be read for declarations`,
      detail: "Whatever those files declare is absent from the reach section below. A short list because a file would not open is not the same as a change that declared nothing, and this packet will not let the two look alike.",
    });
  }

  // The intent, held against what changed. Every finding below is a note and
  // a question: a change can name a file it never touched for good reasons --
  // the work moved, the name is a component and not a path, the sentence was
  // about the goal rather than the diff. Docket cannot tell those apart, so it
  // asks rather than concludes. Marking any of this blocking would put a
  // string-matching heuristic in the same column as an observed test failure.
  // Defensive defaults, though the type requires both: a caller that cannot
  // say what changed should get a comparison recorded as skipped, not a thrown
  // packet. A packet is the artifact a merge decision rests on; it fails by
  // saying less, never by not existing.
  const intentCheck = compareIntent(
    inputs.intent,
    inputs.changedFiles ?? [],
    inputs.changedSymbols ?? [],
  );

  if (intentCheck.unmatched.length > 0) {
    const named = intentCheck.unmatched.map((term) => `\`${term}\``).join(", ");
    findings.push({
      id: `intent-unmatched:${intentCheck.unmatched.join(",")}`,
      severity: "note",
      title:
        intentCheck.unmatched.length === 1
          ? `The intent names ${named}; nothing in this change matches it`
          : `The intent names ${named}; nothing in this change matches them`,
      detail: `Held against the changed paths and the declaration names added or removed. This is a question, not a finding: the name may be a component rather than a path, the work may have landed somewhere else, or the intent may describe a goal the diff serves indirectly. Docket cannot tell which, and does not guess. What it can say is that the words and the diff do not line up.`,
    });
  }

  if (intentCheck.vague) {
    findings.push({
      id: "intent-vague",
      severity: "note",
      title: "The intent names nothing specific enough to check against the diff",
      detail: `Docket looked for terms shaped like paths or identifiers and found none, so the stated intent and the change were not compared. Said plainly rather than left silent, because a packet that says nothing here reads as one that checked and was satisfied.`,
    });
  }

  // Without a stated intent the checks can still show the code works. They
  // cannot show it does what was asked, and those are different questions: a
  // change can be green, well-tested, and the wrong change.
  if (inputs.intent.trim().length === 0 && inputs.change.files > 0) {
    findings.push({
      id: "no-intent",
      severity: "attention",
      title: "Nothing states what this change is for",
      detail: "The checks below can show the code works. Whether it does what was asked cannot be judged against an intent nobody wrote down.",
    });
  }

  // Reported once rather than per check: with no container runtime installed
  // every check is uncontained, and five identical findings would train the
  // reader to scroll past the section that matters.
  // Only runs that actually spawned something count. An empty argv means Docket
  // refused or failed before starting a process, and calling that "ran without
  // isolation" would describe a host run that never happened.
  const uncontained = inputs.checks.filter(
    (entry) =>
      entry.result !== null && entry.result.isolation === "host" && entry.result.argv.length > 0,
  );
  if (uncontained.length > 0) {
    const reason = uncontained.find((entry) => entry.result?.isolationReason)?.result
      ?.isolationReason;
    findings.push({
      id: "uncontained",
      severity: "note",
      title:
        uncontained.length === 1
          ? "One check ran without isolation"
          : `${uncontained.length} checks ran without isolation`,
      detail: `${reason ?? "No container runtime was available."} The results below are still real, but they were produced by scripts with the same access as you, so they carry the repository's trust rather than only its logic.`,
    });
  }

  // A contained run is not automatically the run a reviewer pictures. It can
  // have seen less of the repository than the repository is, or have installed
  // versions nobody pinned. Reported for the same reason as the line above:
  // "contained" is a claim, and a claim with a footnote has to carry it.
  const qualified = inputs.checks.filter(
    (entry) => entry.result?.isolation === "container" && entry.result.isolationReason,
  );
  if (qualified.length > 0) {
    findings.push({
      id: "contained-with-caveat",
      severity: "note",
      title:
        qualified.length === 1
          ? "One contained check came with a qualification"
          : `${qualified.length} contained checks came with a qualification`,
      detail: `${qualified[0]?.result?.isolationReason ?? ""} The result is real; what it covered is narrower than the word "contained" suggests on its own.`,
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
    inputs.intent.trim().length > 0 &&
    inputs.checks.length > 0 &&
    ran.length === inputs.checks.length &&
    ran.every((entry) => entry.result !== null && passed(entry.result)) &&
    !inputs.committedUnavailable &&
    inputs.change.unavailable === null &&
    !inputs.checks.some((entry) => entry.drift?.reason === "changed") &&
    !findings.some((finding) => finding.id.startsWith("divergence")) &&
    // A credential shape is an observed fact about an added line, not a
    // heuristic about intent, so unlike the intent comparison it does keep a
    // packet from reading clean. Named without a shared prefix: the fixture
    // finding was once called `secret-shapes-fixture`, and this test caught it
    // through `startsWith` and blocked on the very fixtures it exists to let
    // past.
    !findings.some((finding) => finding.id.startsWith("secret-shapes:"));

  return {
    intent: inputs.intent,
    intentCheck,
    change: inputs.change,
    checks: inputs.checks,
    reach: inputs.reach,
    claims: inputs.claims,
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
