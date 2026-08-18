/**
 * `docket check` -- the gate, with no window.
 *
 * Everything the packet needs was already free of Electron; the only thing
 * standing between this product and a build machine was that the assembly
 * lived inside an IPC handler. This is the same code the app runs, called
 * from a shell instead of from a window, so the answer a build machine gets
 * and the answer on the desk are the same answer by construction rather than
 * by intention.
 *
 * The exit code carries the one distinction the whole product is about: a
 * packet that says "do not merge" and no packet at all are different
 * outcomes, and a gate that returns the same number for both has told you a
 * failure it never observed.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverChecks } from "../main/check-discovery";
import { runCheck } from "../main/check-runner";
import { parseAgentEvent } from "../main/agent-events";
import { buildEvidencePacket } from "../main/packet";
import { extractClaims, type AgentClaim } from "../shared/claims";
import { isEvidence, type CheckResult } from "../shared/checks";
import { verdict, type EvidencePacket } from "../shared/evidence";
import { parseArgs, USAGE, type Options } from "./args";

export const EXIT = Object.freeze({
  clean: 0,
  blocked: 1,
  /** The gate did not run. Never conflate this with `blocked`. */
  unusable: 2,
});

/** Reads an agent activity log into claims, so divergence is reachable here. */
export async function claimsFrom(logPath: string): Promise<readonly AgentClaim[]> {
  const raw = await readFile(logPath, "utf8");
  const claims: AgentClaim[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const event = parseAgentEvent(line);
    if (!event?.summary) continue;
    claims.push(...extractClaims(event.summary, event.agentId, event.at));
  }
  return claims;
}

/** The packet as a person reads it, which is the same order the app shows. */
export function render(packet: EvidencePacket): string {
  const lines: string[] = [];
  lines.push(verdict(packet));
  lines.push("");

  if (packet.findings.length === 0) {
    lines.push("No findings.");
  } else {
    packet.findings.forEach((finding, index) => {
      lines.push(`${index + 1}. [${finding.severity}] ${finding.title}`);
      if (finding.detail) lines.push(`   ${finding.detail}`);
    });
  }

  return lines.join("\n");
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    return EXIT.unusable;
  }
  const options: Options = parsed.options;
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.clean;
  }

  const workspace = resolve(options.workspace);

  let claims: readonly AgentClaim[] = [];
  if (options.claims) {
    try {
      claims = await claimsFrom(resolve(options.claims));
    } catch (error) {
      process.stderr.write(`Could not read the activity log: ${(error as Error).message}\n`);
      return EXIT.unusable;
    }
  }

  let discovery;
  try {
    discovery = await discoverChecks(workspace);
  } catch (error) {
    process.stderr.write(`Could not read ${workspace}: ${(error as Error).message}\n`);
    return EXIT.unusable;
  }

  // Checks run one at a time. In parallel they would compete for the same
  // node_modules and the same container volume, and a flake caused by the
  // gate itself is the most expensive kind of false finding there is.
  // The same mapping the app builds before running: script name to the exact
  // command line the manifest declares, so the runner re-validates against
  // the repository rather than trusting anything discovery handed forward.
  const scripts = Object.fromEntries(
    discovery.checks.map((candidate) => [candidate.script, candidate.declaration]),
  );

  const results: CheckResult[] = [];
  for (const check of discovery.checks) {
    if (!options.json) process.stderr.write(`running ${check.label}...\n`);
    const result = await runCheck(workspace, check, scripts, {
      requireIsolation: options.requireIsolation,
      ...(options.timeoutMs === null ? {} : { timeoutMs: options.timeoutMs }),
    });
    results.push(result);
  }

  // Isolation was demanded and not obtained. The packet would be honest about
  // this on every result, but the caller asked for a stronger thing than an
  // honest qualification: they asked not to be given a host result at all.
  if (options.requireIsolation && results.some((result) => !isEvidence(result))) {
    const refused = results.filter((result) => !isEvidence(result));
    process.stderr.write(
      `Isolation was required and ${refused.length} of ${results.length} checks could not run contained.\n` +
        refused.map((result) => `  ${result.checkId}: ${result.error ?? result.outcome}\n`).join("") +
        "No packet was produced. This is not a failing check -- it is no result at all.\n",
    );
    return EXIT.unusable;
  }

  const packet = await buildEvidencePacket({
    workspacePath: workspace,
    intent: options.intent,
    results,
    claims,
  });

  process.stdout.write(options.json ? `${JSON.stringify(packet, null, 2)}\n` : `${render(packet)}\n`);
  return packet.clean ? EXIT.clean : EXIT.blocked;
}
