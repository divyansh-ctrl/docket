import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { summariseSession, addSession, readCodexUsage } = jiti("../src/main/codex-usage.ts");

// Codex counts by three conventions that are each the opposite of what the
// Claude Code reader beside this assumes. Every one of them is a way to
// misreport a bill while looking entirely reasonable, so each has a test that
// fails if the reader ever drifts back to the Claude reading.

const CWD = "/repo";
const NOW = Date.parse("2026-08-18T12:00:00Z");

const meta = (cwd = CWD) =>
  JSON.stringify({ timestamp: "2026-08-18T09:00:00Z", type: "session_meta", payload: { cwd } });

const context = (model = "gpt-5.6") =>
  JSON.stringify({ type: "turn_context", payload: { cwd: CWD, model } });

/** One token_count event: the running total, and the turn inside it. */
const tick = (total, last, extra = {}) =>
  JSON.stringify({
    timestamp: extra.at ?? "2026-08-18T09:00:10Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: total,
        last_token_usage: last,
        model_context_window: extra.window === undefined ? 258400 : extra.window,
      },
      rate_limits: extra.limits ?? null,
    },
  });

const usage = (input, cached, output, thinking = 0, written = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: written,
  output_tokens: output,
  reasoning_output_tokens: thinking,
  total_tokens: input + output,
});

test("the totals are cumulative, so only the last one counts", () => {
  // Every event repeats the running total. Summing them multiplies a session
  // by its own length -- the same shape as the request-id bug that inflated
  // the Claude reader two to three times.
  const { usage: read } = summariseSession(
    [
      meta(),
      tick(usage(100, 0, 10), usage(100, 0, 10)),
      tick(usage(300, 0, 30), usage(200, 0, 20)),
      tick(usage(600, 0, 60), usage(300, 0, 30)),
    ],
    NOW,
  );
  assert.equal(read.input, 600, "the last total, not 100 + 300 + 600");
  assert.equal(read.output, 60);
  assert.equal(read.turns, 3);
});

test("cached input is taken back out of input rather than added to it", () => {
  // Codex writes `input_tokens` with the cached part already inside it, the
  // opposite of Claude Code. Reading it the Claude way reports a session's
  // cheap re-reads at full price.
  const { usage: read } = summariseSession(
    [meta(), tick(usage(1000, 900, 50), usage(1000, 900, 50))],
    NOW,
  );
  assert.equal(read.input, 100, "1000 stated minus 900 cached");
  assert.equal(read.cacheRead, 900);
  assert.notEqual(read.input, 1000);
});

test("a resumed session contributes what it added, not what it inherited", () => {
  // Five real rollout files opened on the same 128-million total -- forks of
  // one point. Counting the whole final figure for each overstated the true
  // number by 780 million tokens, 14.5%.
  const { usage: read } = summariseSession(
    [
      meta(),
      // Opens mid-conversation: the running total already stands at 5000 in,
      // of which this first turn is 200.
      tick(usage(5200, 0, 520), usage(200, 0, 20)),
      tick(usage(5600, 0, 560), usage(400, 0, 40)),
    ],
    NOW,
  );
  assert.equal(read.input, 600, "5600 final minus the 5000 it opened on");
  assert.equal(read.output, 60);
});

test("a session that began at zero is unaffected by the subtraction", () => {
  const { usage: read } = summariseSession(
    [meta(), tick(usage(200, 0, 20), usage(200, 0, 20)), tick(usage(500, 0, 50), usage(300, 0, 30))],
    NOW,
  );
  assert.equal(read.input, 500);
});

test("the context window is reported where Codex states it and nowhere else", () => {
  const stated = summariseSession([meta(), tick(usage(10, 0, 1), usage(10, 0, 1))], NOW);
  assert.equal(stated.usage.window, 258400, "read from the file");
  assert.equal(stated.usage.context, 10, "the prompt as sent, cached parts included");

  const silent = summariseSession(
    [meta(), tick(usage(10, 0, 1), usage(10, 0, 1), { window: null })],
    NOW,
  );
  assert.equal(silent.usage.window, null, "absent is absent, not a default");
});

test("a rate limit past its reset is not reported as current", () => {
  // These files keep the last limit Codex was told about, and it can be months
  // old. A window whose reset has passed has reset; the percentage in the file
  // describes a window that no longer exists.
  const live = { primary: { used_percent: 20, window_minutes: 10080, resets_at: NOW / 1000 + 600 }, plan_type: "free" };
  const stale = { primary: { used_percent: 45, window_minutes: 300, resets_at: NOW / 1000 - 600 }, plan_type: "team" };

  const fresh = summariseSession([meta(), tick(usage(10, 0, 1), usage(10, 0, 1), { limits: live })], NOW);
  assert.equal(fresh.usage.limits.usedPercent, 20);
  assert.equal(fresh.usage.limits.plan, "free");

  const old = summariseSession([meta(), tick(usage(10, 0, 1), usage(10, 0, 1), { limits: stale })], NOW);
  assert.equal(old.usage.limits, null, "a stale limit is no reading, not a stale reading");
});

test("a half-written last line does not throw the whole reading away", () => {
  const { usage: read } = summariseSession(
    [meta(), tick(usage(400, 0, 40), usage(400, 0, 40)), '{"type":"event_msg","payload":{"type":"token'],
    NOW,
  );
  assert.equal(read.input, 400);
});

test("a token_count with no info is skipped rather than counted as zero", () => {
  const line = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } });
  const { usage: read } = summariseSession(
    [meta(), tick(usage(400, 0, 40), usage(400, 0, 40)), line],
    NOW,
  );
  assert.equal(read.input, 400);
  assert.equal(read.turns, 1);
});

test("the model is read from the turn context", () => {
  const { usage: read } = summariseSession(
    [meta(), context("gpt-5.6-luna"), tick(usage(10, 0, 1), usage(10, 0, 1))],
    NOW,
  );
  assert.equal(read.model, "gpt-5.6-luna");
});

test("a file whose directory changes under it is reported as no reading", () => {
  const { cwd, usage: read } = summariseSession(
    [meta("/repo"), JSON.stringify({ type: "turn_context", payload: { cwd: "/elsewhere" } })],
    NOW,
  );
  assert.equal(cwd, null, "rather than someone else's numbers");
  assert.equal(read.turns, 0);
});

/** A zeroed figure to start a running total from. */
function EMPTY_OK() {
  return {
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
  };
}

test("the window and the limit describe now, so the newest session wins", () => {
  const older = { ...summariseSession([meta(), tick(usage(100, 0, 10), usage(100, 0, 10))], NOW).usage, at: 1000, window: 100, context: 5 };
  const newer = { ...summariseSession([meta(), tick(usage(200, 0, 20), usage(200, 0, 20))], NOW).usage, at: 2000, window: 400, context: 9 };
  const summed = addSession(addSession(EMPTY_OK(), older), newer);
  assert.equal(summed.input, 300, "spend adds");
  assert.equal(summed.window, 400, "the window does not");
  assert.equal(summed.context, 9);
});

test("no Codex session here is said plainly, not as a number", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-usage-"));
  try {
    const day = join(home, ".codex", "sessions", "2026", "08", "18");
    await mkdir(day, { recursive: true });
    await writeFile(
      join(day, "rollout-2026-08-18T09-00-00-abc.jsonl"),
      [meta("/somewhere/else"), tick(usage(100, 0, 10), usage(100, 0, 10))].join("\n"),
    );
    const reading = await readCodexUsage(CWD, home, NOW);
    assert.equal(reading.ok, false);
    assert.match(reading.reason, /No Codex session has run in this repository/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("sessions in this repository are found, totalled and attributed", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-usage-"));
  try {
    const day = join(home, ".codex", "sessions", "2026", "08", "18");
    await mkdir(day, { recursive: true });
    await writeFile(
      join(day, "rollout-2026-08-18T09-00-00-aaa.jsonl"),
      [meta(), context(), tick(usage(1000, 400, 100), usage(1000, 400, 100))].join("\n"),
    );
    await writeFile(
      join(day, "rollout-2026-08-18T10-00-00-bbb.jsonl"),
      [meta(), context(), tick(usage(500, 100, 50), usage(500, 100, 50))].join("\n"),
    );
    // Another repository's session, in the same day's directory.
    await writeFile(
      join(day, "rollout-2026-08-18T11-00-00-ccc.jsonl"),
      [meta("/other"), tick(usage(9999, 0, 999), usage(9999, 0, 999))].join("\n"),
    );

    const reading = await readCodexUsage(CWD, home, NOW);
    assert.equal(reading.ok, true);
    assert.equal(reading.sessions, 2);
    assert.equal(reading.usage.input, 1000 - 400 + (500 - 100));
    assert.equal(reading.usage.cacheRead, 500);
    assert.equal(reading.usage.output, 150);
    assert.equal(reading.usage.window, 258400);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
