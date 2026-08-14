/**
 * Finds the checks a repository already defines for itself, and notices when
 * they have been edited.
 *
 * Discovery is deliberately conservative. It reads `package.json` scripts and
 * matches their names against a small table, because a script called `test` is
 * the repository telling you how it wants to be tested. It does not guess from
 * dependencies, and it does not invent a command that the repository never
 * declared -- a check Docket made up proves nothing about this project.
 *
 * The second job matters more than the first. Every declaration is compared
 * against the one committed in HEAD, because the cheapest way for an agent to
 * make a suite pass is to change what the suite runs. That edit is invisible in
 * a green result and obvious in a diff, so Docket reads the diff.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  CHECK_KIND_ORDER,
  type CheckDiscovery,
  type CheckDrift,
  type CheckKind,
  type DiscoveredCheck,
} from "../shared/checks";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;
/** A manifest larger than this is not a manifest worth parsing. */
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

/**
 * Script names that mean a given kind of check, most specific first. Matching is
 * exact on the name or on the part before a colon, so `test:unit` counts as a
 * test while `pretest` and `test:watch` do not: a watcher never terminates, and
 * a lifecycle hook is not a check a person would run to decide anything.
 */
const SCRIPT_NAMES: Readonly<Record<CheckKind, readonly string[]>> = Object.freeze({
  typecheck: ["typecheck", "type-check", "types", "tsc"],
  lint: ["lint", "eslint"],
  test: ["test", "tests"],
  build: ["build", "compile"],
});

/** Names that look like checks but never terminate or never assert anything. */
const NEVER_A_CHECK = new Set(["watch", "dev", "serve", "start", "coverage:watch"]);

export async function discoverChecks(workspaceRoot: string): Promise<CheckDiscovery> {
  const manifestPath = "package.json";
  const working = await readScripts(workspaceRoot, manifestPath);
  if (!working) {
    return { checks: [], drift: [], committedUnavailable: false };
  }

  const checks = classify(working, manifestPath);

  const committed = await readCommittedScripts(workspaceRoot, manifestPath);
  if (committed === undefined) {
    // Unknown, not clean. Saying "no drift" here would be a claim Docket cannot
    // support, and this whole module exists to avoid unsupported claims.
    return { checks, drift: [], committedUnavailable: true };
  }

  return { checks, drift: compare(checks, committed), committedUnavailable: false };
}

/** Reads and parses the `scripts` block, or null when there is not a usable one. */
async function readScripts(
  root: string,
  manifestPath: string,
): Promise<Readonly<Record<string, string>> | null> {
  let source: string;
  try {
    source = await readFile(`${root}/${manifestPath}`, "utf8");
  } catch {
    return null;
  }
  if (source.length > MAX_MANIFEST_BYTES) return null;
  return parseScripts(source);
}

export function parseScripts(source: string): Readonly<Record<string, string>> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    // A manifest that does not parse cannot be trusted to describe anything.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const scripts = (parsed as Record<string, unknown>).scripts;
  if (!scripts || typeof scripts !== "object") return null;

  const out: Record<string, string> = {};
  for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof body === "string") out[name] = body;
  }
  return out;
}

function classify(
  scripts: Readonly<Record<string, string>>,
  manifestPath: string,
): readonly DiscoveredCheck[] {
  const found: DiscoveredCheck[] = [];

  for (const kind of CHECK_KIND_ORDER) {
    const names = SCRIPT_NAMES[kind];
    // One check per kind: running both `test` and `test:unit` usually runs the
    // same assertions twice, and the reviewer learns nothing from the second.
    const name = names.find((candidate) => matchingScript(scripts, candidate));
    if (!name) continue;

    const script = matchingScript(scripts, name);
    if (!script) continue;

    found.push({
      id: `npm:${script}`,
      kind,
      label: `npm run ${script}`,
      runner: "npm",
      script,
      manifestPath,
      declaration: scripts[script],
    });
  }

  return found;
}

/** Exact name, else the first `name:suffix` variant that is not a watcher. */
function matchingScript(
  scripts: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  if (typeof scripts[name] === "string") return name;

  const prefix = `${name}:`;
  return Object.keys(scripts)
    .filter((key) => key.startsWith(prefix))
    .find((key) => !NEVER_A_CHECK.has(key.slice(prefix.length)));
}

/**
 * Reads the manifest as committed in HEAD. Returns undefined when that cannot
 * be established -- not a repository, no commits yet, or Git unavailable -- and
 * null when HEAD exists but does not contain the manifest.
 */
async function readCommittedScripts(
  root: string,
  manifestPath: string,
): Promise<Readonly<Record<string, string>> | null | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["show", `HEAD:${manifestPath}`], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_MANIFEST_BYTES,
      windowsHide: true,
    }));
  } catch (error) {
    // Distinguish "HEAD has no such file" from "there is no HEAD to ask".
    // Only the first is a fact about the repository; the second is ignorance.
    const message = error instanceof Error ? error.message : "";
    if (/exists on disk, but not in|does not exist in|unknown revision|path .* does not exist/i.test(message)) {
      return null;
    }
    return undefined;
  }

  return parseScripts(stdout) ?? null;
}

function compare(
  checks: readonly DiscoveredCheck[],
  committed: Readonly<Record<string, string>> | null,
): readonly CheckDrift[] {
  const drift: CheckDrift[] = [];

  for (const check of checks) {
    if (committed === null) {
      drift.push({ checkId: check.id, reason: "absent", committed: null, working: check.declaration });
      continue;
    }

    const before = committed[check.script];
    if (typeof before !== "string") {
      drift.push({ checkId: check.id, reason: "added", committed: null, working: check.declaration });
      continue;
    }
    if (before !== check.declaration) {
      drift.push({ checkId: check.id, reason: "changed", committed: before, working: check.declaration });
    }
  }

  return drift;
}
