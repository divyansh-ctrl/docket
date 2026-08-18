/**
 * What this session has actually spent, read from the CLI's own record.
 *
 * The desk panel has said `ctx not measured` since it was written, because
 * nothing counted tokens and showing a number nobody counted is the failure
 * this product exists to remove. This counts them, from the only honest
 * source available: the transcript the CLI writes for itself, which carries a
 * `usage` block on every assistant turn.
 *
 * Three things this deliberately does not do.
 *
 * **It does not attribute tokens to individual agents.** The transcripts on
 * this machine carry no per-subagent marking -- 90 files, 60,000 records, not
 * one turn attributed to a subagent. So a per-agent meter would be a number
 * invented to fill a space in the layout. The rail says what is true instead.
 *
 * **It does not add cache reads to input.** A cached read is charged at a
 * fraction of a fresh one; summing them into a single "tokens used" figure
 * would overstate the bill by an order of magnitude on a long session. They
 * are counted and reported separately.
 *
 * **It does not report a percentage of a context window.** That needs a
 * denominator, and the window size is something Docket would be assuming
 * rather than reading. The prompt size on the most recent request is a
 * measurement; "62% full" would be a guess wearing a measurement's clothes.
 *
 * This reads the **Claude Code** CLI's transcripts, which is the only format
 * it understands. Docket can be driven by Codex too, and a Codex-led session
 * writes nothing *here* -- but it does write its own record elsewhere, which
 * `codex-usage.ts` reads. This file said "permanently" until someone looked;
 * the reason text below is the fallback for a Codex session whose own records
 * could not be reached, and it says which format is missing rather than
 * implying a file is on its way.
 *
 * Only `usage`, `cwd`, `model`, `timestamp` and `requestId` are read out of
 * these files. The conversation itself is none of Docket's business and is
 * never held.
 *
 * One request, one count. A single API request is written to the transcript
 * as several records -- the text, the thinking, each tool call -- and every
 * one of them carries the *same* usage block. Summing records instead of
 * requests inflated the first working version of this by two to three times,
 * and it looked entirely reasonable while it did.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type TokenUsage = Readonly<{
  /** Fresh input tokens, charged in full. */
  input: number;
  /** Input written into the cache. */
  cacheWrite: number;
  /** Input served from the cache, charged at a fraction. Never added to input. */
  cacheRead: number;
  output: number;
  /** How much of the output was thinking. */
  thinking: number;
  /** Assistant turns counted. */
  turns: number;
  /**
   * The size of the prompt on the most recent request: how full the window
   * actually was, measured rather than estimated.
   */
  context: number;
  /** The model that request went to, as the record names it. */
  model: string | null;
  /** When the last counted turn happened. */
  at: number;
}>;

export type UsageReading =
  | Readonly<{ ok: true; usage: TokenUsage; transcripts: number }>
  | Readonly<{ ok: false; reason: string }>;

const EMPTY: TokenUsage = Object.freeze({
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  thinking: 0,
  turns: 0,
  context: 0,
  model: null,
  at: 0,
});

/**
 * How the CLI names a project's directory: the absolute path with every
 * separator and dot flattened to a dash.
 *
 * A guess about another tool's layout, so it is never trusted on its own --
 * whatever it finds is confirmed against the `cwd` the records themselves
 * carry, and a mismatch is reported as no reading rather than as someone
 * else's numbers.
 */
export function projectSlug(workspacePath: string): string {
  return workspacePath.replace(/[/._]/g, "-");
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Folds one transcript's lines into a usage total.
 *
 * Pure, and separated from the filesystem so the suite can hold it to the
 * rules above without a real CLI on disk. Records whose `cwd` is not this
 * workspace are skipped: one project directory can hold sessions from a
 * worktree that has since moved.
 */
export function summarise(
  lines: Iterable<string>,
  workspacePath: string,
  running: TokenUsage = EMPTY,
  counted: Set<string> = new Set(),
): TokenUsage {
  let { input, cacheWrite, cacheRead, output, thinking, turns, context, model, at } = running;

  for (const line of lines) {
    if (line.length === 0) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // A transcript is appended to by a live process and can be caught
      // mid-write. One unreadable line is not a reason to report nothing.
      continue;
    }
    if (record.type !== "assistant") continue;
    if (typeof record.cwd === "string" && record.cwd !== workspacePath) continue;

    const message = record.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    // One request, one count. Several records share a requestId -- the text,
    // the thinking, each tool call -- and every one repeats the same usage.
    const requestId = typeof record.requestId === "string" ? record.requestId : null;
    if (requestId) {
      if (counted.has(requestId)) continue;
      counted.add(requestId);
    }

    const fresh = count(usage.input_tokens);
    const written = count(usage.cache_creation_input_tokens);
    const read = count(usage.cache_read_input_tokens);
    const produced = count(usage.output_tokens);

    input += fresh;
    cacheWrite += written;
    cacheRead += read;
    output += produced;
    thinking += count((usage.output_tokens_details as Record<string, unknown> | undefined)?.thinking_tokens);
    turns += 1;

    // The prompt on this request, whatever its parts were charged at. The
    // last one wins, because that is the one describing the window now.
    const when = Date.parse(typeof record.timestamp === "string" ? record.timestamp : "");
    const stamp = Number.isFinite(when) ? when : at;
    if (stamp >= at) {
      at = stamp;
      context = fresh + written + read;
      if (typeof message?.model === "string") model = message.model;
    }
  }

  return { input, cacheWrite, cacheRead, output, thinking, turns, context, model, at };
}

/** How many transcripts back to read. A project directory accumulates. */
const MAX_TRANSCRIPTS = 8;
/** A transcript larger than this is read, but only its tail. */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Reads this workspace's sessions and totals them.
 *
 * Returns a reason rather than zeroes when there is nothing to read: "no
 * transcripts for this workspace" and "this workspace has used no tokens" are
 * different statements, and a meter showing 0 for the first is a lie.
 */
export async function readTokenUsage(
  workspacePath: string,
  home: string = homedir(),
  controller: string | null = null,
): Promise<UsageReading> {
  // Named rather than implied. "No transcript yet" reads as "one is coming",
  // and for a session led by a CLI that does not write these files, none ever
  // is. Telling someone to wait for a thing that will never arrive is worse
  // than telling them it is not available.
  const missing =
    controller && controller !== "claude"
      ? `This reader understands the Claude Code CLI's transcripts, and this session is led by ${controller}, which writes a different format. Its own records are read elsewhere.`
      : "No Claude Code transcript for this repository yet, so nothing has been counted.";
  const directory = join(home, ".claude", "projects", projectSlug(workspacePath));

  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return { ok: false, reason: missing };
  }
  if (entries.length === 0) {
    return { ok: false, reason: missing };
  }

  const dated = await Promise.all(
    entries.map(async (name) => {
      const path = join(directory, name);
      try {
        return { path, at: (await stat(path)).mtimeMs };
      } catch {
        return { path, at: 0 };
      }
    }),
  );
  const newest = dated.sort((left, right) => right.at - left.at).slice(0, MAX_TRANSCRIPTS);

  let usage = EMPTY;
  let read = 0;
  // Shared across transcripts: a resumed session repeats requests from the
  // one it continued, and counting those twice is the same bug one level up.
  const counted = new Set<string>();
  for (const { path } of newest) {
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (source.length > MAX_BYTES) source = source.slice(-MAX_BYTES);
    usage = summarise(source.split("\n"), workspacePath, usage, counted);
    read += 1;
  }

  if (usage.turns === 0) {
    return {
      ok: false,
      reason: "The transcripts for this repository record no assistant turns, so there is nothing to count.",
    };
  }

  return { ok: true, usage, transcripts: read };
}
