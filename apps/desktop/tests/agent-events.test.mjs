// These hooks are installed into someone's own repository and the log is
// appended to by another process, so the cases worth guarding are: not
// clobbering hooks a person configured, not inventing team members out of the
// CLI's built-in agents, and not emitting half an event that arrived in two
// writes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { installAgentHooks, mergeHooks, parseAgentEvent, watchAgentEvents } = jiti(
  fileURLToPath(new URL("../src/main/agent-events.ts", import.meta.url)),
);

const settle = () => new Promise((resolve) => setTimeout(resolve, 220));

test("hooks a person configured are preserved", () => {
  const theirs = {
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      SubagentStart: [{ matcher: "Explore", hooks: [{ type: "command", command: "./mine.sh" }] }],
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "./guard.sh" }] }],
    },
  };

  const merged = mergeHooks(theirs, "/logs/events.jsonl");

  assert.deepEqual(merged.permissions, theirs.permissions, "unrelated settings must survive");
  assert.deepEqual(merged.hooks.PreToolUse, theirs.hooks.PreToolUse, "unrelated events must survive");
  assert.equal(merged.hooks.SubagentStart.length, 2, "their hook plus ours");
  assert.equal(merged.hooks.SubagentStart[0].hooks[0].command, "./mine.sh");
});

test("installing twice does not stack duplicate hooks", () => {
  const once = mergeHooks({}, "/logs/a.jsonl");
  const twice = mergeHooks(once, "/logs/b.jsonl");

  assert.equal(twice.hooks.SubagentStart.length, 1, "our own previous entry is replaced");
  assert.equal(twice.hooks.SubagentStop.length, 1);
  assert.ok(twice.hooks.SubagentStart[0].hooks[0].args[1].includes("/logs/b.jsonl"), "path is updated");
});

test("a workspace path containing a quote cannot break out of the command", () => {
  const merged = mergeHooks({}, "/tmp/it's here/events.jsonl");
  const command = merged.hooks.SubagentStart[0].hooks[0].args[1];
  assert.ok(command.includes("'\\''"), "the quote must be escaped for the shell");
  assert.ok(!/;|&&|\|\|/.test(command), "no shell operators should appear");
});

test("only agents on the roster become room activity", () => {
  const base = { hook_event_name: "SubagentStart", agent_id: "a1" };
  assert.equal(parseAgentEvent(JSON.stringify({ ...base, agent_type: "review" }))?.agentId, "review");
  // The CLI ships its own agents; showing them as teammates would misreport
  // who is on the team.
  assert.equal(parseAgentEvent(JSON.stringify({ ...base, agent_type: "Explore" })), null);
  assert.equal(parseAgentEvent(JSON.stringify({ ...base, agent_type: "general-purpose" })), null);
  assert.equal(parseAgentEvent("not json"), null);
  assert.equal(parseAgentEvent(JSON.stringify({ agent_type: "review" })), null, "an unknown event is dropped");
});

test("a stop event carries what the agent reported", () => {
  const event = parseAgentEvent(
    JSON.stringify({
      hook_event_name: "SubagentStop",
      agent_type: "tests",
      agent_id: "run-7",
      last_assistant_message: "42 passing, 1 failing: rotation under concurrency",
    }),
  );
  assert.equal(event.kind, "stop");
  assert.equal(event.runId, "run-7");
  assert.match(event.summary, /1 failing/);
});

test("installing writes hooks to the local settings file", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "docket-hooks-"));
  const log = join(workspace, "events.jsonl");
  await installAgentHooks(workspace, log);

  // settings.local.json, not settings.json: the command holds an absolute path
  // that means nothing on another machine, so it must not be committed.
  const written = JSON.parse(await readFile(join(workspace, ".claude/settings.local.json"), "utf8"));
  assert.ok(written.hooks.SubagentStart, "start hook installed");
  assert.ok(written.hooks.SubagentStop, "stop hook installed");
  await assert.rejects(() => readFile(join(workspace, ".claude/settings.json"), "utf8"));
});

test("a malformed settings file is reported, not overwritten", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "docket-hooks-"));
  await mkdir(join(workspace, ".claude"), { recursive: true });
  const path = join(workspace, ".claude/settings.local.json");
  await writeFile(path, "{ this is not json");

  await assert.rejects(() => installAgentHooks(workspace, join(workspace, "e.jsonl")), /settings\.local\.json/);
  assert.equal(await readFile(path, "utf8"), "{ this is not json", "their file is untouched");
});

test("the log is followed, and only new events are reported", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "docket-events-"));
  const log = join(workspace, "events.jsonl");
  // Written before watching: history must not replay into the room.
  await writeFile(log, `${JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "lead", agent_id: "old" })}\n`);

  const seen = [];
  const stop = watchAgentEvents(log, (event) => seen.push(event));
  await settle();

  await appendFile(log, `${JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "engineer", agent_id: "n1" })}\n`);
  await settle();

  // An event split across two writes must not be emitted until it is complete.
  await appendFile(log, '{"hook_event_name":"SubagentStop","agent_type":"engineer",');
  await settle();
  assert.equal(seen.length, 1, "a partial line must not be parsed");

  await appendFile(log, '"agent_id":"n1","last_assistant_message":"done"}\n');
  await settle();
  stop();

  assert.deepEqual(
    seen.map((event) => `${event.agentId}:${event.kind}`),
    ["engineer:start", "engineer:stop"],
    "history is skipped and the split event arrives once whole",
  );
  assert.equal(seen[1].summary, "done");
});
