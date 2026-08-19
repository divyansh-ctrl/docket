/**
 * What actually changed in the workspace, read from Git rather than from an
 * agent's account of its own work.
 *
 * Two things are collected. The file list, with real line counts, answers "what
 * did this touch." The changed symbols answer "what did it touch that other
 * code depends on", which is what blast radius is computed from.
 *
 * Symbol extraction is a documented heuristic, not a parser. It reads added and
 * removed lines looking for declaration shapes in the languages this is likely
 * to meet. A parser per language is the right long-term answer; a heuristic
 * that admits it is one beats a parser that only exists for TypeScript, because
 * the reviewer is told what was searched for either way.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;
/** Beyond this a diff is a rewrite, and a per-file list stops informing. */
const MAX_FILES = 400;
/** Symbols are searched for one by one, so this bounds the work that follows. */
const MAX_SYMBOLS = 60;
/** A new file is read to find its declarations; beyond this only the head is. */
const MAX_FILE_BYTES = 512 * 1024;
/** Added lines are held in memory to be scanned, so the count is bounded. */
const MAX_ADDED_LINES = 20_000;

export type ChangedFile = Readonly<{
  path: string;
  added: number;
  removed: number;
  status: "modified" | "added" | "deleted" | "untracked";
}>;

export type WorkspaceDiff = Readonly<{
  files: readonly ChangedFile[];
  /** Declaration names added or removed. Heuristic; see the module comment. */
  symbols: readonly string[];
  /** True when the symbol scan stopped at its cap, so the list is partial. */
  symbolsTruncated: boolean;
  /**
   * New files whose contents could not be read, so their declarations are
   * missing from the list above. Counted rather than swallowed: a symbol list
   * that is short because a file would not open is not the same as a change
   * that declared nothing.
   */
  symbolsUnread: number;
  added: number;
  removed: number;
  /** True when the file list was cut at the cap. */
  truncated: boolean;
  /** Set when Git could not be consulted, so the caller can say so plainly. */
  unavailable: string | null;
}>;

const EMPTY: WorkspaceDiff = Object.freeze({
  files: [],
  symbols: [],
  symbolsTruncated: false,
  symbolsUnread: 0,
  added: 0,
  removed: 0,
  truncated: false,
  unavailable: null,
});

export async function surveyChanges(root: string): Promise<WorkspaceDiff> {
  try {
    await git(root, ["rev-parse", "--git-dir"]);
  } catch {
    return { ...EMPTY, unavailable: "This workspace is not a Git repository, so Docket cannot tell what changed." };
  }

  let hasCommit = true;
  try {
    await git(root, ["rev-parse", "HEAD"]);
  } catch {
    hasCommit = false;
  }

  const files = hasCommit ? await trackedChanges(root) : [];
  const untracked = await untrackedFiles(root);
  const all = [...files, ...untracked].slice(0, MAX_FILES);

  // Both sources, because a change that adds a file declares things too. The
  // tracked diff is the only one this used to read, which meant a brand-new
  // module contributed no symbols at all -- and nothing said so, so a new
  // widely-used export looked exactly like a change that touched nothing.
  // Untracked files are taken from the capped list rather than from Git again,
  // so the symbols always describe the files this packet actually reports.
  const scanned = hasCommit ? await changedSymbols(root) : { names: [], unread: 0 };
  const fresh = await untrackedSymbols(
    root,
    all.filter((file) => file.status === "untracked").map((file) => file.path),
    scanned.names.length,
  );

  const names = [...new Set([...scanned.names, ...fresh.names])].slice(0, MAX_SYMBOLS);

  return {
    files: all,
    symbols: names,
    symbolsTruncated: scanned.names.length + fresh.names.length >= MAX_SYMBOLS,
    symbolsUnread: scanned.unread + fresh.unread,
    added: all.reduce((total, file) => total + file.added, 0),
    removed: all.reduce((total, file) => total + file.removed, 0),
    truncated: files.length + untracked.length > MAX_FILES,
    unavailable: hasCommit ? null : "This repository has no commits yet, so there is nothing to compare against.",
  };
}

export type RepositoryState = Readonly<{
  /** Commit HEAD points at. Null in a repository with no commits. */
  head: string | null;
  /**
   * Digest of the working tree's difference from HEAD, or null when it could
   * not be computed. Null is a real answer and must not be read as "clean".
   */
  treeDigest: string | null;
}>;

/**
 * A fingerprint of the code as it is right now.
 *
 * This is what binds a sealed decision to the thing it was a decision about. A
 * commit alone is not enough, because the interesting case is an uncommitted
 * working tree -- which is exactly the state an agent leaves behind, and
 * exactly the state a reviewer is looking at when they decide.
 *
 * It covers the tracked diff against HEAD and the names of untracked files.
 * Not the contents of untracked files: hashing them means reading every
 * unignored file in the tree, and a new file appearing or disappearing is
 * already enough to say the tree moved. What it covers is stated here so a
 * reader of a record knows what "unchanged" was checked against.
 */
export async function repositoryState(root: string): Promise<RepositoryState> {
  let head: string | null = null;
  try {
    head = (await git(root, ["rev-parse", "HEAD"])).trim() || null;
  } catch {
    // No commits, or not a repository. Reported as null, never as a digest.
  }

  try {
    const [diff, untracked] = await Promise.all([
      head ? git(root, ["diff", "--no-color", "HEAD"]) : Promise.resolve(""),
      git(root, ["ls-files", "--others", "--exclude-standard"]),
    ]);
    // The separator keeps a diff that happens to end in a filename-shaped line
    // from colliding with a different diff plus an untracked file.
    const digest = createHash("sha256")
      .update(diff)
      .update(" untracked ")
      .update(untracked)
      .digest("hex");
    return { head, treeDigest: digest };
  } catch {
    return { head, treeDigest: null };
  }
}

async function trackedChanges(root: string): Promise<readonly ChangedFile[]> {
  // --numstat gives real counts; --diff-filter keeps renames from being counted
  // as an unrelated add and delete pair.
  const numstat = await git(root, ["diff", "--numstat", "--no-color", "HEAD"]);
  const statuses = await fileStatuses(root);

  const files: ChangedFile[] = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, removedRaw, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    files.push({
      path,
      // A binary file reports "-" for both counts.
      added: Number.parseInt(addedRaw, 10) || 0,
      removed: Number.parseInt(removedRaw, 10) || 0,
      status: statuses.get(path) ?? "modified",
    });
  }
  return files;
}

async function fileStatuses(root: string): Promise<Map<string, ChangedFile["status"]>> {
  const out = new Map<string, ChangedFile["status"]>();
  const raw = await git(root, ["diff", "--name-status", "--no-color", "HEAD"]);
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [code, ...rest] = line.split("\t");
    const path = rest[rest.length - 1];
    if (!path) continue;
    if (code.startsWith("A")) out.set(path, "added");
    else if (code.startsWith("D")) out.set(path, "deleted");
    else out.set(path, "modified");
  }
  return out;
}

async function untrackedFiles(root: string): Promise<readonly ChangedFile[]> {
  // A new file an agent has not staged is still part of the change, and is the
  // easiest thing for a diff-against-HEAD to miss entirely.
  const raw = await git(root, ["ls-files", "--others", "--exclude-standard"]);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((path) => ({ path, added: 0, removed: 0, status: "untracked" as const }));
}

/**
 * Declaration shapes worth noticing. Each pattern captures the declared name in
 * group 1. Kept small on purpose: a pattern that matches call sites as well as
 * declarations turns blast radius into noise.
 */
const DECLARATIONS: readonly RegExp[] = Object.freeze([
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+(?:const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/,
  /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /\bclass\s+([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  /\bdef\s+([A-Za-z_][\w]*)\s*\(/,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/,
]);

type SymbolScan = Readonly<{ names: readonly string[]; unread: number }>;

/** Pulls declared names out of one line, if it declares anything. */
function declaredIn(body: string): string | null {
  for (const pattern of DECLARATIONS) {
    const match = pattern.exec(body);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function changedSymbols(root: string): Promise<SymbolScan> {
  // -U0 keeps context lines out, so an untouched declaration next to an edit is
  // not reported as changed.
  const diff = await git(root, ["diff", "-U0", "--no-color", "HEAD"]);
  const names = new Set<string>();

  for (const line of diff.split("\n")) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const declared = declaredIn(line.slice(1));
    if (declared) names.add(declared);
    if (names.size >= MAX_SYMBOLS) break;
  }

  return { names: [...names], unread: 0 };
}

/**
 * Declarations in files Git has never seen.
 *
 * Every line counts as added, because every line is: the file did not exist
 * before. Read directly rather than through Git, since `git diff` has nothing
 * to compare an untracked file against and reports none of it.
 *
 * A file that cannot be read is counted, not skipped silently. A binary one is
 * left out without counting -- it declares nothing, and calling that a failed
 * read would report an absence that is not there.
 *
 * This reads whole files where the tracked path reads only changed lines, so
 * it has a wider surface for false positives: a declaration shape inside a
 * string or a comment counts. Run against this repository it produced `fn$`,
 * out of a `function fn${index}` inside a template literal in a test. The cost
 * is a wasted search in the reach section, not a wrong statement about the
 * code, and the heuristic is declared as one at the top of this file. Narrowing
 * it would mean a parser per language, which is the honest long-term answer and
 * a different piece of work.
 */
async function untrackedSymbols(
  root: string,
  paths: readonly string[],
  already: number,
): Promise<SymbolScan> {
  const names = new Set<string>();
  let unread = 0;

  for (const path of paths) {
    if (already + names.size >= MAX_SYMBOLS) break;
    let source: string;
    try {
      const buffer = await readFile(join(root, path));
      // A NUL in the head is the usual signal, and the one Git itself uses.
      if (buffer.subarray(0, 8000).includes(0)) continue;
      source = buffer.subarray(0, MAX_FILE_BYTES).toString("utf8");
    } catch {
      unread += 1;
      continue;
    }
    for (const line of source.split("\n")) {
      const declared = declaredIn(line);
      if (declared) names.add(declared);
      if (already + names.size >= MAX_SYMBOLS) break;
    }
  }

  return { names: [...names], unread };
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args as string[], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout;
}


export type AddedLine = Readonly<{ path: string; line: number; text: string }>;

/**
 * Every line this change adds, with the file and line number it landed on.
 *
 * For scanning, not for display: nothing here is put in a packet verbatim. The
 * caller matches shapes against it and reports positions.
 *
 * Both sources again, for the reason #40 established -- a diff against HEAD
 * cannot see a file Git has never heard of, and a credential added in a brand
 * new file is the case most worth catching, not least.
 *
 * Line numbers come from the hunk headers on the tracked side, so a reported
 * position is the position in the file rather than an offset into a diff.
 */
export async function addedLines(root: string): Promise<{
  lines: readonly AddedLine[];
  truncated: boolean;
  unread: number;
}> {
  const lines: AddedLine[] = [];
  let unread = 0;

  let hasCommit = true;
  try {
    await git(root, ["rev-parse", "HEAD"]);
  } catch {
    hasCommit = false;
  }

  if (hasCommit) {
    let diff = "";
    try {
      diff = await git(root, ["diff", "--no-color", "-U0", "HEAD"]);
    } catch {
      diff = "";
    }
    let path = "";
    let next = 0;
    for (const raw of diff.split("\n")) {
      if (raw.startsWith("+++ ")) {
        // "+++ b/path", or "+++ /dev/null" for a deletion.
        const named = raw.slice(4);
        path = named === "/dev/null" ? "" : named.replace(/^[ab]\//, "");
        continue;
      }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (hunk) {
        next = Number.parseInt(hunk[1], 10);
        continue;
      }
      if (!path || !raw.startsWith("+") || raw.startsWith("+++")) continue;
      if (lines.length >= MAX_ADDED_LINES) return { lines, truncated: true, unread };
      lines.push({ path, line: next, text: raw.slice(1) });
      next += 1;
    }
  }

  for (const file of await untrackedFiles(root)) {
    let source: string;
    try {
      const buffer = await readFile(join(root, file.path));
      if (buffer.subarray(0, 8000).includes(0)) continue;
      source = buffer.subarray(0, MAX_FILE_BYTES).toString("utf8");
    } catch {
      unread += 1;
      continue;
    }
    let number = 0;
    for (const text of source.split("\n")) {
      number += 1;
      if (lines.length >= MAX_ADDED_LINES) return { lines, truncated: true, unread };
      lines.push({ path: file.path, line: number, text });
    }
  }

  return { lines, truncated: false, unread };
}
