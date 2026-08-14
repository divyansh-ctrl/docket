/**
 * Who else depends on what changed.
 *
 * "A safe-looking change to a shared helper is not a small change" is the
 * second thing the reviewer charter tells an agent to look for, and it is the
 * question a diff cannot answer on its own: the diff shows the edit, not the
 * fourteen call sites that inherit it.
 *
 * References are found with `git grep`, which searches tracked files only. That
 * is deliberate -- it skips node_modules and build output without needing an
 * ignore list, and it is fast enough to run while a person waits.
 *
 * This finds textual references, not resolved ones. A common word will match
 * things that are not calls, so results are capped, the callers are reported as
 * files rather than counted as facts, and the panel says "references" instead
 * of "callers". Naming it precisely is what keeps a heuristic useful.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;
/** Per symbol. Past this the symbol is common enough that the list is noise. */
const MAX_FILES_PER_SYMBOL = 25;
/** A name shorter than this matches far too much to mean anything. */
const MIN_SYMBOL_LENGTH = 3;

export type SymbolReferences = Readonly<{
  symbol: string;
  /** Files outside the change that mention it, relative to the workspace root. */
  files: readonly string[];
  /** True when the search hit its cap, so `files` is a sample not a total. */
  truncated: boolean;
}>;

export type BlastRadius = Readonly<{
  references: readonly SymbolReferences[];
  /** Symbols searched for but referenced nowhere outside the change. */
  contained: readonly string[];
  /** Set when the search could not run at all. */
  unavailable: string | null;
}>;

export async function findBlastRadius(
  root: string,
  symbols: readonly string[],
  changedFiles: readonly string[],
): Promise<BlastRadius> {
  const searchable = symbols.filter((symbol) => symbol.length >= MIN_SYMBOL_LENGTH);
  if (searchable.length === 0) {
    return { references: [], contained: [], unavailable: null };
  }

  const changed = new Set(changedFiles);
  const references: SymbolReferences[] = [];
  const contained: string[] = [];

  for (const symbol of searchable) {
    let files: readonly string[];
    try {
      files = await referencingFiles(root, symbol);
    } catch (error) {
      return {
        references,
        contained,
        unavailable: error instanceof Error ? error.message : String(error),
      };
    }

    // A symbol's own file is not blast radius; it is the change itself.
    const outside = files.filter((file) => !changed.has(file));
    if (outside.length === 0) {
      contained.push(symbol);
      continue;
    }

    references.push({
      symbol,
      files: outside.slice(0, MAX_FILES_PER_SYMBOL),
      truncated: outside.length > MAX_FILES_PER_SYMBOL,
    });
  }

  // Widest first: the shared helper is the one that decides whether this change
  // is small, and it should not be below a one-file rename in the list.
  return {
    references: [...references].sort((left, right) => right.files.length - left.files.length),
    contained,
    unavailable: null,
  };
}

async function referencingFiles(root: string, symbol: string): Promise<readonly string[]> {
  try {
    // -w matches whole words, so `run` does not match `runCheck`. -F treats the
    // symbol literally, so a name containing regex characters cannot turn into
    // a pattern that searches for something else.
    const { stdout } = await execFileAsync(
      "git",
      ["grep", "--files-with-matches", "-w", "-F", "--", symbol],
      { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    // git grep exits 1 when nothing matched, which is an answer, not a failure.
    const code = (error as { code?: unknown }).code;
    if (code === 1) return [];
    throw error;
  }
}
