import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { summarise, projectSlug, readTokenUsage } = jiti("../src/main/token-usage.ts");

// The meter said "not measured" for as long as it existed, because showing a
// number nobody counted is the failure this product exists to remove. These
// hold the line the other way: everything reported is read, and the things
// that cannot be read are not reported.

const CWD = "/repo";

const turn = (usage, extra = {}) =>
  JSON.stringify({
    type: "assistant",
    cwd: CWD,
    timestamp: "2026-08-18T10:00:00.000Z",
    message: { model: "claude-opus-5", usage },
    ...extra,
  });

test("a cache read is never added to input", () => {
  // The bill difference is an order of magnitude on a long session. Summing
  // them into one "tokens used" figure would make the meter useless in the
  // exact case it matters -- a session that has been running a while.
  const usage = summarise(
    [turn({ input_tokens: 10, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 500, output_tokens: 20 })],
    CWD,
  );
  assert.equal(usage.input, 10);
  assert.equal(usage.cacheRead, 100_000);
  assert.equal(usage.cacheWrite, 500);
  assert.equal(usage.output, 20);
});

test("context is the size of the most recent prompt, not a running total", () => {
  // How full the window is now. Adding every turn's prompt together would
  // produce a number that only grows and describes nothing.
  const usage = summarise(
    [
      turn({ input_tokens: 5, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 0, output_tokens: 1 },
        { timestamp: "2026-08-18T10:00:00.000Z" }),
      turn({ input_tokens: 7, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 300, output_tokens: 1 },
        { timestamp: "2026-08-18T10:05:00.000Z" }),
    ],
    CWD,
  );
  assert.equal(usage.context, 7 + 9_000 + 300);
  assert.equal(usage.turns, 2);
  // Totals still accumulate.
  assert.equal(usage.cacheRead, 10_000);
});

test("an out-of-order record does not rewind the context reading", () => {
  // Transcripts are appended by a live process; a late write with an earlier
  // timestamp must not make the meter describe an older prompt.
  const usage = summarise(
    [
      turn({ input_tokens: 1, cache_read_input_tokens: 50_000, output_tokens: 1 },
        { timestamp: "2026-08-18T11:00:00.000Z" }),
      turn({ input_tokens: 1, cache_read_input_tokens: 10, output_tokens: 1 },
        { timestamp: "2026-08-18T09:00:00.000Z" }),
    ],
    CWD,
  );
  assert.equal(usage.context, 50_001);
});

test("another repository's records in the same file are not counted", () => {
  // A project directory can hold sessions from a worktree that has moved.
  const usage = summarise(
    [
      turn({ input_tokens: 100, output_tokens: 10 }),
      turn({ input_tokens: 999, output_tokens: 999 }, { cwd: "/somewhere/else" }),
    ],
    CWD,
  );
  assert.equal(usage.input, 100);
  assert.equal(usage.turns, 1);
});

test("only assistant turns with usage are counted", () => {
  const usage = summarise(
    [
      JSON.stringify({ type: "user", cwd: CWD, message: { content: "hello" } }),
      JSON.stringify({ type: "assistant", cwd: CWD, message: { model: "m" } }),
      JSON.stringify({ type: "system", cwd: CWD }),
      turn({ input_tokens: 3, output_tokens: 4 }),
    ],
    CWD,
  );
  assert.equal(usage.turns, 1);
  assert.equal(usage.input, 3);
});

test("a half-written line does not take the reading down", () => {
  // The file is appended to by a live process and can be caught mid-write.
  const usage = summarise(
    ['{"type":"assistant","cwd":"/repo","message":{"usage":{"input_tok', "", turn({ input_tokens: 8, output_tokens: 2 })],
    CWD,
  );
  assert.equal(usage.turns, 1);
  assert.equal(usage.input, 8);
});

test("nonsense in a usage field counts as nothing, never as NaN", () => {
  // One malformed number would otherwise poison every total in the meter.
  const usage = summarise(
    [turn({ input_tokens: "lots", cache_read_input_tokens: -5, output_tokens: null, cache_creation_input_tokens: 12 })],
    CWD,
  );
  assert.equal(usage.input, 0);
  assert.equal(usage.cacheRead, 0);
  assert.equal(usage.output, 0);
  assert.equal(usage.cacheWrite, 12);
  assert.ok(Number.isFinite(usage.context));
});

test("no conversation content is retained, only the counts", () => {
  // These files are the user's conversations. Docket has no business holding
  // any of it, and the shape of the return value is what enforces that.
  const usage = summarise(
    [
      turn({ input_tokens: 1, output_tokens: 1 }, {
        message: {
          model: "claude-opus-5",
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "text", text: "a private thing the user said" }],
        },
      }),
    ],
    CWD,
  );
  assert.ok(!JSON.stringify(usage).includes("private"), "content leaked into the reading");
  assert.deepEqual(
    Object.keys(usage).sort(),
    ["at", "cacheRead", "cacheWrite", "context", "input", "model", "output", "thinking", "turns"],
  );
});

test("the project slug flattens separators, dots and underscores", () => {
  assert.equal(projectSlug("/Users/a/code/my_app"), "-Users-a-code-my-app");
  assert.equal(
    projectSlug("/Users/d/code/docket/.claude/worktrees/x-1"),
    "-Users-d-code-docket--claude-worktrees-x-1",
  );
});

test("no transcript reads as no transcript, never as zero tokens", async () => {
  // "Nothing has been counted" and "this session used nothing" are different
  // statements. A meter showing 0 for the first is a lie about the second.
  const home = await mkdtemp(join(tmpdir(), "docket-usage-"));
  try {
    const reading = await readTokenUsage("/repo/never/opened", home);
    assert.equal(reading.ok, false);
    assert.match(reading.reason, /No Claude Code transcript/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a real directory is read, and only this workspace's turns are totalled", async () => {
  const home = await mkdtemp(join(tmpdir(), "docket-usage-"));
  const workspace = "/repo/alpha";
  const directory = join(home, ".claude", "projects", projectSlug(workspace));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "one.jsonl"),
    [
      JSON.stringify({
        type: "assistant",
        cwd: workspace,
        timestamp: "2026-08-18T10:00:00.000Z",
        message: { model: "claude-opus-5", usage: { input_tokens: 4, cache_read_input_tokens: 2_000, output_tokens: 9 } },
      }),
      JSON.stringify({
        type: "assistant",
        cwd: "/repo/beta",
        message: { usage: { input_tokens: 500, output_tokens: 500 } },
      }),
    ].join("\n"),
  );
  try {
    const reading = await readTokenUsage(workspace, home);
    assert.equal(reading.ok, true, reading.ok ? "" : reading.reason);
    assert.equal(reading.usage.input, 4);
    assert.equal(reading.usage.cacheRead, 2_000);
    assert.equal(reading.usage.context, 2_004);
    assert.equal(reading.usage.model, "claude-opus-5");
    assert.equal(reading.transcripts, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a directory with no assistant turns says so rather than reporting zero", async () => {
  const home = await mkdtemp(join(tmpdir(), "docket-usage-"));
  const workspace = "/repo/quiet";
  const directory = join(home, ".claude", "projects", projectSlug(workspace));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "s.jsonl"), JSON.stringify({ type: "user", cwd: workspace }));
  try {
    const reading = await readTokenUsage(workspace, home);
    assert.equal(reading.ok, false);
    assert.match(reading.reason, /no assistant turns/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("one request is counted once, however many records it wrote", async () => {
  // The bug that made the first working version wrong by two to three times,
  // and looked entirely reasonable while it did. A single API request is
  // written out as several records -- the text, the thinking, each tool call
  // -- and every one of them repeats the SAME usage block.
  const usage = summarise(
    [
      turn({ input_tokens: 2, cache_read_input_tokens: 1_000, output_tokens: 50 }, { requestId: "req_a" }),
      turn({ input_tokens: 2, cache_read_input_tokens: 1_000, output_tokens: 50 }, { requestId: "req_a" }),
      turn({ input_tokens: 2, cache_read_input_tokens: 1_000, output_tokens: 50 }, { requestId: "req_a" }),
      turn({ input_tokens: 3, cache_read_input_tokens: 2_000, output_tokens: 60 }, { requestId: "req_b" }),
    ],
    CWD,
  );
  assert.equal(usage.turns, 2, "three records of one request are one turn");
  assert.equal(usage.input, 5);
  assert.equal(usage.cacheRead, 3_000);
  assert.equal(usage.output, 110);
});

test("a request repeated across two transcripts is still counted once", async () => {
  // A resumed session repeats requests from the one it continued. Counting
  // those again is the same bug one level up, so the seen-set is shared.
  const home = await mkdtemp(join(tmpdir(), "docket-usage-"));
  const workspace = "/repo/resumed";
  const directory = join(home, ".claude", "projects", projectSlug(workspace));
  await mkdir(directory, { recursive: true });
  const record = JSON.stringify({
    type: "assistant",
    cwd: workspace,
    requestId: "req_shared",
    timestamp: "2026-08-18T10:00:00.000Z",
    message: { model: "m", usage: { input_tokens: 10, output_tokens: 10 } },
  });
  await writeFile(join(directory, "first.jsonl"), record);
  await writeFile(join(directory, "second.jsonl"), record);
  try {
    const reading = await readTokenUsage(workspace, home);
    assert.equal(reading.ok, true);
    assert.equal(reading.transcripts, 2, "both files were read");
    assert.equal(reading.usage.turns, 1, "the shared request was counted twice");
    assert.equal(reading.usage.input, 10);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("records with no requestId are still counted", async () => {
  // Older transcripts may not carry one. Dropping them would silently
  // under-report, which is the opposite failure and just as wrong.
  const usage = summarise(
    [turn({ input_tokens: 1, output_tokens: 1 }), turn({ input_tokens: 1, output_tokens: 1 })],
    CWD,
  );
  assert.equal(usage.turns, 2);
});

test("a session led by another CLI is told so, not told to wait", async () => {
  // "No transcript yet" reads as "one is coming", and no Claude Code
  // transcript is coming for a session Codex is leading -- it writes its own
  // format, read by codex-usage.ts. Naming the format beats implying a wait.
  const home = await mkdtemp(join(tmpdir(), "docket-usage-"));
  try {
    const reading = await readTokenUsage("/repo/codex-led", home, "codex");
    assert.equal(reading.ok, false);
    assert.match(reading.reason, /led by codex/);
    assert.doesNotMatch(reading.reason, /yet/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
