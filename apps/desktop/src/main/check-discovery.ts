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
import { CONFIG_FILE, declarationOf, parseRepoConfig, type RepoConfig } from "../shared/repo-config";
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
  // A repository that declares itself is taken at its word about what its
  // checks are. This is what serves projects that are not JavaScript: without
  // it, discovery reads npm scripts or finds nothing at all.
  const declared = await readConfig(workspaceRoot);
  if (declared && !declared.ok) {
    // A broken config is a finding, not a fallback. Carrying on with npm
    // discovery here would let one corrupted file disable the declared gate
    // while the packet said nothing about it.
    return { checks: [], drift: [], committedUnavailable: false, configError: declared.error };
  }
  if (declared?.config.checks.length) {
    return await fromConfig(workspaceRoot, declared.config);
  }

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

/** Reads `docket.json`, or null when the repository does not declare one. */
async function readConfig(root: string) {
  let source: string;
  try {
    source = await readFile(`${root}/${CONFIG_FILE}`, "utf8");
  } catch {
    return null;
  }
  if (source.length > MAX_MANIFEST_BYTES) {
    return { ok: false as const, error: `${CONFIG_FILE} is too large to read.` };
  }
  return parseRepoConfig(source);
}

/**
 * Turns a declared config into checks, and compares each declaration against
 * the committed one.
 *
 * Drift matters more here than anywhere else. Editing `docket.json` to turn
 * `["pytest", "-q"]` into `["true"]` is by far the cheapest way to make a gate
 * pass, and it leaves a green result behind. So the committed file is read and
 * parsed the same way, and each command compared.
 */
async function fromConfig(root: string, config: RepoConfig): Promise<CheckDiscovery> {
  const checks: DiscoveredCheck[] = config.checks.map((entry) => ({
    id: `config:${entry.kind}`,
    kind: entry.kind,
    label: entry.command.join(" "),
    runner: "command",
    script: entry.kind,
    manifestPath: CONFIG_FILE,
    declaration: declarationOf(entry),
    command: entry.command,
    ...(config.image ? { image: config.image } : {}),
  }));

  const committedSource = await readCommitted(root, CONFIG_FILE);
  if (committedSource === undefined) {
    return { checks, drift: [], committedUnavailable: true };
  }
  if (committedSource === null) {
    return {
      checks,
      drift: checks.map((check) => ({
        checkId: check.id,
        reason: "absent" as const,
        committed: null,
        working: check.declaration,
      })),
      committedUnavailable: false,
    };
  }

  const committed = parseRepoConfig(committedSource);
  const byKind = new Map(
    committed.ok ? committed.config.checks.map((entry) => [entry.kind, declarationOf(entry)]) : [],
  );

  const drift = checks.flatMap((check) => {
    const before = byKind.get(check.kind) ?? null;
    if (before === check.declaration) return [];
    return [
      {
        checkId: check.id,
        // A check the committed config never declared is `added`, the same
        // word npm discovery uses for a script that is not in HEAD.
        reason: (before === null ? "added" : "changed") as "added" | "changed",
        committed: before,
        working: check.declaration,
      },
    ];
  });

  return { checks, drift, committedUnavailable: false };
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

/**
 * A file as HEAD has it. `undefined` when Git could not answer at all --
 * which is unknown, not absent, and the difference is a finding.
 */
async function readCommitted(root: string, path: string): Promise<string | null | undefined> {
  let prefix: string;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-prefix"], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    prefix = stdout.trim();
  } catch {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${prefix}${path}`], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_MANIFEST_BYTES,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    return /exists on disk, but not in|does not exist in|unknown revision|path .* does not exist/i.test(text)
      ? null
      : undefined;
  }
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
  // `git show HEAD:<path>` resolves the path from the repository root, not from
  // the working directory. An opened workspace is very often a subdirectory --
  // any monorepo package -- and without this prefix the lookup silently reads
  // the wrong manifest, or none, and drift degrades to "unknown" for exactly
  // the repositories most likely to have it.
  let prefix: string;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-prefix"], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    prefix = stdout.trim();
  } catch {
    return undefined;
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["show", `HEAD:${prefix}${manifestPath}`], {
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
