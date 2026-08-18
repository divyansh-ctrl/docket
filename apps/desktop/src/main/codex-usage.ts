/**
 * What a Codex-led session has spent, read from Codex's own rollout files.
 *
 * The Claude Code reader beside this one says "not measured" for a Codex
 * session, because Codex writes nothing to `~/.claude/projects`. That reason
 * was accurate about the file it looked for and wrong about the world: Codex
 * records usage in more detail than Claude Code does, in
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 *
 * It is a different format with three different conventions, and reusing the
 * Claude arithmetic on it would misreport every figure.
 *
 * **The totals are cumulative, not per-turn.** Every `token_count` event
 * carries `total_token_usage`, the running total for the session so far, and
 * `last_token_usage`, that one turn. Summing the totals across records
 * inflates a session by a factor of its own length. Only the last one counts.
 *
 * **`input_tokens` already includes `cached_input_tokens`** -- the opposite of
 * Claude Code, where a cache read sits outside input. Fresh input here is
 * `input - cached`. Reading it the Claude way would report a session's cheap
 * cached re-reads as full-price input.
 *
 * **A rollout file does not always start from zero.** A resumed or forked
 * session inherits the running total of the conversation it continued. On the
 * machine this was written against, six files opened on a total already past
 * 128 million, five of them on the *same* 128 million -- forks of one point.
 * Summing per-file finals counted that prefix five times over and overstated
 * the true figure by 780 million tokens, 14.5%. So each file contributes what
 * it *added*: its final total minus the total it opened on, and the total it
 * opened on is recoverable exactly, because the first event carries both the
 * running total and the turn inside it.
 *
 * That last one is the same defect that inflated the Claude reader two to
 * three times before it deduplicated by request id. It is worth naming as a
 * class rather than a bug: **a transcript's totals belong to the transcript,
 * not to the record they appear on.** Both formats invite the same mistake and
 * neither announces it.
 *
 * Two things this can do that the Claude reader cannot, because Codex records
 * what Claude Code does not:
 *
 * **A percentage that is read rather than assumed.** `model_context_window` is
 * in the file. Where it is absent -- and it is absent on a handful of records
 * -- there is no percentage, not a default.
 *
 * **The account's rate limit.** `rate_limits` carries the window used, its
 * length, and when it resets. This is the number that answers "am I about to
 * run out", and it is measured by the provider rather than inferred here.
 *
 * A caveat that has to be stated rather than buried: if the rollout file that
 * originally accrued an inherited prefix has been deleted, that prefix is
 * counted by nobody and the total is low by that much. Undercounting a deleted
 * file is the honest failure; inventing the difference is not.
 *
 * Only usage, window, limits, model, cwd and timestamps are read out of these
 * files. Codex's conversations are no more Docket's business than Claude's.
 */
import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** What Codex reports about the account's own limit, as it reports it. */
export type RateLimit = Readonly<{
  /** How much of the window is gone, as Codex measures it. */
  usedPercent: number;
  /** The window's length in minutes. */
  windowMinutes: number | null;
  /** When it resets, in epoch milliseconds. */
  resetsAt: number | null;
  plan: string | null;
}>;

export type CodexUsage = Readonly<{
  /** Fresh input: `input_tokens - cached_input_tokens`, never the raw field. */
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  /** Reasoning tokens, which Codex counts inside output. */
  thinking: number;
  turns: number;
  /** The prompt size on the most recent turn, cached parts included. */
  context: number;
  /**
   * The model's context window as Codex states it, or null where it did not.
   * A percentage is only honest with this in hand.
   */
  window: number | null;
  model: string | null;
  limits: RateLimit | null;
  at: number;
}>;

export type CodexReading =
  | Readonly<{ ok: true; usage: CodexUsage; sessions: number }>
  | Readonly<{ ok: false; reason: string }>;

const EMPTY: CodexUsage = Object.freeze({
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  thinking: 0,
  turns: 0,
  context: 0,
  window: null,
  model: null,
  limits: null,
  at: 0,
});

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function record(line: string): Record<string, unknown> | null {
  if (line.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    // Codex appends to these while it runs; a half-written last line is
    // normal and is not a reason to report nothing.
    return null;
  }
}

/** The four counted quantities, in the shape the file writes them. */
type Parts = { input: number; cached: number; written: number; output: number; thinking: number };

function parts(usage: unknown): Parts {
  const block = (usage ?? {}) as Record<string, unknown>;
  return {
    input: count(block.input_tokens),
    cached: count(block.cached_input_tokens),
    written: count(block.cache_write_input_tokens),
    output: count(block.output_tokens),
    thinking: count(block.reasoning_output_tokens),
  };
}

/**
 * The account's limit, but only while it still describes the present.
 *
 * These files keep the last limit Codex was told about, and that can be
 * months old -- the newest reading in one directory here resets in May, read
 * in August. A window whose reset has passed has reset: the percentage in the
 * file is a fact about a window that no longer exists. Showing it as current
 * would be the exact failure this product exists to remove, so a limit past
 * its reset is reported as no reading rather than as a stale one.
 */
function limitsOf(value: unknown, now: number): RateLimit | null {
  const block = value as Record<string, unknown> | undefined;
  const primary = block?.primary as Record<string, unknown> | undefined;
  if (!primary || typeof primary.used_percent !== "number") return null;
  const resets = primary.resets_at;
  if (typeof resets === "number" && resets > 0 && resets * 1000 <= now) return null;
  return {
    usedPercent: primary.used_percent,
    windowMinutes: typeof primary.window_minutes === "number" ? primary.window_minutes : null,
    // Codex writes epoch seconds here; everything else in Docket is millis.
    resetsAt: typeof resets === "number" && resets > 0 ? resets * 1000 : null,
    plan: typeof block?.plan_type === "string" ? block.plan_type : null,
  };
}

/** What one rollout file says: which directory it ran in, and what it added. */
export type Session = Readonly<{ cwd: string | null; usage: CodexUsage }>;

/**
 * Folds one rollout file into the usage it *added*.
 *
 * Pure, and separate from the filesystem so the suite can hold it to the three
 * conventions above without a Codex install on disk.
 *
 * The subtraction is the whole point. `total_token_usage` on the first event
 * is the running total *including* that first turn, so the total the file
 * opened on is that minus `last_token_usage`. For a session that began at zero
 * this is zero and the subtraction changes nothing; for one that resumed, it
 * removes a prefix that some other file already counted.
 */
export function summariseSession(lines: Iterable<string>, now: number = Date.now()): Session {
  let cwd: string | null = null;
  let model: string | null = null;
  let opened: Parts | null = null;
  let latest: Parts | null = null;
  let context = 0;
  let window: number | null = null;
  let limits: RateLimit | null = null;
  let turns = 0;
  let at = 0;

  for (const line of lines) {
    const entry = record(line);
    if (!entry) continue;
    const payload = (entry.payload ?? {}) as Record<string, unknown>;

    if (entry.type === "session_meta" || entry.type === "turn_context") {
      // Both carry cwd; turn_context also names the model. A file keeps one
      // working directory even across a resume, so the first is enough -- but
      // a later disagreement is taken seriously rather than ignored.
      if (typeof payload.cwd === "string") {
        if (cwd !== null && cwd !== payload.cwd) return { cwd: null, usage: EMPTY };
        cwd = payload.cwd;
      }
      if (typeof payload.model === "string") model = payload.model;
      continue;
    }

    if (entry.type !== "event_msg" || payload.type !== "token_count") continue;
    const info = payload.info as Record<string, unknown> | null | undefined;
    // Codex writes token_count with a null info when it has nothing to report.
    if (!info) continue;
    const total = info.total_token_usage;
    if (!total) continue;

    const running = parts(total);
    const turn = parts(info.last_token_usage);

    if (opened === null) {
      opened = {
        input: Math.max(0, running.input - turn.input),
        cached: Math.max(0, running.cached - turn.cached),
        written: Math.max(0, running.written - turn.written),
        output: Math.max(0, running.output - turn.output),
        thinking: Math.max(0, running.thinking - turn.thinking),
      };
    }
    latest = running;

    if (turn.input + turn.output > 0) {
      turns += 1;
      // The prompt as sent, cached parts included: that is what filled the
      // window, whatever the parts were charged at.
      context = turn.input;
    }
    if (typeof info.model_context_window === "number" && info.model_context_window > 0) {
      window = info.model_context_window;
    }
    const rates = limitsOf(payload.rate_limits, now);
    if (rates) limits = rates;

    const when = Date.parse(typeof entry.timestamp === "string" ? entry.timestamp : "");
    if (Number.isFinite(when) && when > at) at = when;
  }

  if (!latest || !opened) return { cwd, usage: EMPTY };

  return {
    cwd,
    usage: {
      // Fresh input only. `input_tokens` counts the cached part too, so
      // subtracting it here is what keeps this from reading as a bill several
      // times the real one.
      input: Math.max(0, latest.input - opened.input) - Math.max(0, latest.cached - opened.cached),
      cacheWrite: Math.max(0, latest.written - opened.written),
      cacheRead: Math.max(0, latest.cached - opened.cached),
      output: Math.max(0, latest.output - opened.output),
      thinking: Math.max(0, latest.thinking - opened.thinking),
      turns,
      context,
      window,
      model,
      limits,
      at,
    },
  };
}

/** Adds a session's contribution to a running figure across sessions. */
export function addSession(running: CodexUsage, session: CodexUsage): CodexUsage {
  const newer = session.at >= running.at;
  return {
    input: running.input + Math.max(0, session.input),
    cacheWrite: running.cacheWrite + session.cacheWrite,
    cacheRead: running.cacheRead + session.cacheRead,
    output: running.output + session.output,
    thinking: running.thinking + session.thinking,
    turns: running.turns + session.turns,
    // The window, the model and the limit describe *now*, so the most recent
    // session wins rather than the largest or the last read.
    context: newer ? session.context : running.context,
    window: newer && session.window !== null ? session.window : running.window,
    model: newer && session.model !== null ? session.model : running.model,
    limits: newer && session.limits !== null ? session.limits : running.limits,
    at: newer ? session.at : running.at,
  };
}

/** How many sessions back to total. A day's directory accumulates. */
const MAX_SESSIONS = 8;
/** A rollout larger than this is read, but only its tail. */
const MAX_BYTES = 64 * 1024 * 1024;

/** The first line of a file, read without pulling the rest of it into memory. */
async function firstLine(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    // session_meta carries the full system prompt, so the first line is large.
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const end = text.indexOf("\n");
    return end === -1 ? text : text.slice(0, end);
  } finally {
    await handle.close();
  }
}

async function rollouts(root: string): Promise<string[]> {
  const found: string[] = [];
  // sessions/YYYY/MM/DD/rollout-*.jsonl -- walked rather than globbed so a
  // stray file at any level is skipped instead of throwing.
  const walk = async (directory: string, depth: number): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return;
    }
    for (const name of entries) {
      if (depth < 3) await walk(join(directory, name), depth + 1);
      else if (name.startsWith("rollout-") && name.endsWith(".jsonl")) {
        found.push(join(directory, name));
      }
    }
  };
  await walk(root, 0);
  return found;
}

/**
 * Totals this workspace's Codex sessions.
 *
 * Every rollout's head is read to find which ones ran here -- Codex files by
 * date, not by project, so there is no directory to look in. That is 162 short
 * reads on the machine this was written against and takes well under a second;
 * only the matching files are then read in full.
 */
export async function readCodexUsage(
  workspacePath: string,
  home: string = homedir(),
  now: number = Date.now(),
): Promise<CodexReading> {
  const root = join(home, ".codex", "sessions");
  const missing = `No Codex session has run in this repository, so there is nothing to count. Codex records its usage under ~/.codex/sessions.`;

  const paths = await rollouts(root);
  if (paths.length === 0) return { ok: false, reason: missing };

  // The head carries session_meta, which carries cwd. Enough to decide
  // whether the whole file is worth reading.
  const heads = await Promise.all(
    paths.map(async (path) => {
      try {
        // The head only. These files reach hundreds of megabytes, and reading
        // one in full to look at its first line took seven seconds across a
        // directory -- for a panel that re-reads on a timer.
        const head = await firstLine(path);
        const entry = record(head);
        const payload = (entry?.payload ?? {}) as Record<string, unknown>;
        const cwd = entry?.type === "session_meta" && typeof payload.cwd === "string" ? payload.cwd : null;
        return { path, cwd, at: (await stat(path)).mtimeMs };
      } catch {
        return { path, cwd: null, at: 0 };
      }
    }),
  );

  const mine = heads
    .filter((entry) => entry.cwd === workspacePath)
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_SESSIONS);
  if (mine.length === 0) return { ok: false, reason: missing };

  let usage = EMPTY;
  let sessions = 0;
  for (const { path } of mine) {
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (source.length > MAX_BYTES) source = source.slice(-MAX_BYTES);
    const session = summariseSession(source.split("\n"), now);
    // The head said this file was ours; the body has to still say so.
    if (session.cwd !== workspacePath) continue;
    usage = addSession(usage, session.usage);
    sessions += 1;
  }

  if (usage.turns === 0) {
    return {
      ok: false,
      reason: "This repository's Codex sessions record no completed turns, so there is nothing to count.",
    };
  }
  return { ok: true, usage, sessions };
}
