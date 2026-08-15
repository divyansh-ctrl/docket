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
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;
/** Beyond this a diff is a rewrite, and a per-file list stops informing. */
const MAX_FILES = 400;
/** Symbols are searched for one by one, so this bounds the work that follows. */
const MAX_SYMBOLS = 60;

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

  const symbols = hasCommit ? await changedSymbols(root) : [];

  return {
    files: all,
    symbols,
    added: all.reduce((total, file) => total + file.added, 0),
    removed: all.reduce((total, file) => total + file.removed, 0),
    truncated: files.length + untracked.length > MAX_FILES,
    unavailable: hasCommit ? null : "This repository has no commits yet, so there is nothing to compare against.",
  };
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

async function changedSymbols(root: string): Promise<readonly string[]> {
  // -U0 keeps context lines out, so an untouched declaration next to an edit is
  // not reported as changed.
  const diff = await git(root, ["diff", "-U0", "--no-color", "HEAD"]);
  const names = new Set<string>();

  for (const line of diff.split("\n")) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const body = line.slice(1);
    for (const pattern of DECLARATIONS) {
      const match = pattern.exec(body);
      if (match?.[1]) {
        names.add(match[1]);
        break;
      }
    }
    if (names.size >= MAX_SYMBOLS) break;
  }

  return [...names];
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
