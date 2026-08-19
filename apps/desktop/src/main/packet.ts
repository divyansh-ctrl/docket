/**
 * Assembling a packet, once, for every front end there will ever be.
 *
 * This used to live inside the IPC handlers, which meant it lived inside a
 * module that imports Electron, which meant a packet could only be built by a
 * running window. Nothing about reading a repository needs a window; the
 * dependency was an accident of where the code was first written, and it was
 * the single thing standing between this gate and a build machine.
 *
 * Now the desktop app and the `docket check` command call the same function
 * with the same arguments. That is not tidiness. A gate whose CI answer is
 * assembled by different code from its on-screen answer is a gate that can
 * tell two people two different things about one commit, and the packet's
 * whole claim is that it is the artifact a merge decision rests on.
 */
import { discoverChecks } from "./check-discovery";
import { addedLines, surveyChanges } from "./workspace-diff";
import { scanSecrets } from "../shared/secrets";
import { classifyPaths, declaresInstallHook } from "../shared/sensitive-paths";
import { findBlastRadius } from "./blast-radius";
import { assemblePacket, type EvidencePacket } from "../shared/evidence";
import type { CheckResult } from "../shared/checks";
import type { AgentClaim } from "../shared/claims";

export type PacketRequest = Readonly<{
  workspacePath: string;
  /** What the change is meant to do, in the author's words. May be empty. */
  intent: string;
  /** Results already obtained for this workspace, keyed by check id. */
  results: readonly CheckResult[];
  /** What agents said about the checks, to be compared against what ran. */
  claims: readonly AgentClaim[];
}>;

/**
 * Everything is re-read here rather than accumulated. A packet assembled from
 * a stale snapshot would describe a repository that no longer exists.
 */
export async function buildEvidencePacket(request: PacketRequest): Promise<EvidencePacket> {
  const { workspacePath } = request;

  const [discovery, change, added] = await Promise.all([
    discoverChecks(workspacePath),
    surveyChanges(workspacePath),
    addedLines(workspacePath),
  ]);

  const secrets = scanSecrets(added.lines);

  // Which manifests actually gained an install lifecycle script, decided from
  // the added lines. Every package.json edit would otherwise be reported, and
  // almost none of them adds a postinstall.
  const installHooks = [
    ...new Set(
      added.lines
        .filter((line) => line.path.endsWith("package.json") && declaresInstallHook(line.text))
        .map((line) => line.path),
    ),
  ];
  const governing = classifyPaths(
    change.files.map((file) => file.path),
    installHooks,
  );

  const reach = await findBlastRadius(
    workspacePath,
    change.symbols,
    change.files.map((file) => file.path),
  );

  const byId = new Map(request.results.map((result) => [result.checkId, result]));

  return assemblePacket({
    intent: request.intent.slice(0, 2000),
    // The same paths and symbols the reach search used, so the intent is held
    // against exactly what Docket observed rather than a second reading of it.
    changedFiles: change.files.map((file) => file.path),
    changedSymbols: change.symbols,
    symbolsTruncated: change.symbolsTruncated,
    symbolsUnread: change.symbolsUnread,
    secrets: added.truncated ? { ...secrets, truncated: true } : secrets,
    secretsUnread: added.unread,
    governing,
    committedUnavailable: discovery.committedUnavailable,
    ...(discovery.configError ? { configError: discovery.configError } : {}),
    change: {
      files: change.files.length,
      added: change.added,
      removed: change.removed,
      truncated: change.truncated,
      unavailable: change.unavailable,
    },
    checks: discovery.checks.map((check) => ({
      check,
      result: byId.get(check.id) ?? null,
      drift: discovery.drift.find((entry) => entry.checkId === check.id) ?? null,
    })),
    reach: {
      references: reach.references,
      contained: reach.contained,
      unavailable: reach.unavailable,
    },
    claims: request.claims,
  });
}
