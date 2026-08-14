// The roster is written to disk as real subagent definitions, so the failure
// modes worth guarding are the ones that only show up at spawn time: a tool a
// background subagent silently loses, a name the loader refuses, or a role
// given write access it should not have.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  AGENT_MODELS,
  AGENT_ROSTER,
  BACKGROUND_SAFE_TOOLS,
  CORE_AGENT_IDS,
  agent,
  renderAgentFile,
  renderAgentsManifest,
} = jiti(fileURLToPath(new URL("../src/shared/agent-roster.ts", import.meta.url)));

test("every declared tool survives a background subagent", () => {
  // Tools outside this set are dropped without an error, and a list that
  // resolves to nothing fails to launch the agent at all.
  const safe = new Set(BACKGROUND_SAFE_TOOLS);
  for (const definition of AGENT_ROSTER) {
    assert.ok(definition.tools.length > 0, `${definition.id} declares no tools`);
    for (const tool of definition.tools) {
      assert.ok(safe.has(tool), `${definition.id} declares ${tool}, which a background subagent drops`);
    }
  }
});

test("handles are valid, unique subagent names", () => {
  const seen = new Set();
  for (const definition of AGENT_ROSTER) {
    // The loader rejects a name containing a colon and expects lowercase and
    // hyphens only.
    assert.match(definition.handle, /^[a-z][a-z-]*$/, `${definition.id} has an unusable handle`);
    assert.ok(!seen.has(definition.handle), `duplicate handle ${definition.handle}`);
    seen.add(definition.handle);
  }
});

test("reviewing roles cannot edit what they review", () => {
  for (const id of ["lead", "review", "security"]) {
    const tools = agent(id).tools;
    assert.ok(!tools.includes("Edit"), `${id} must not be able to edit`);
    assert.ok(!tools.includes("Write"), `${id} must not be able to write`);
  }
});

test("implementing roles can actually change files", () => {
  for (const id of ["engineer", "tests", "interface", "data", "release"]) {
    assert.ok(agent(id).tools.includes("Edit"), `${id} needs Edit to do its job`);
  }
});

test("core agents are the three that every repository needs", () => {
  assert.deepEqual([...CORE_AGENT_IDS], ["lead", "engineer", "review"]);
});

test("default models are real aliases", () => {
  for (const definition of AGENT_ROSTER) {
    assert.ok(AGENT_MODELS.includes(definition.defaultModel), `${definition.id} has an unknown model`);
  }
});

test("a rendered agent file parses as frontmatter plus a body", () => {
  const file = renderAgentFile(agent("review"), "opus");
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]+)$/.exec(file);
  assert.ok(match, "file does not open with a frontmatter block");

  const [, frontmatter, body] = match;
  const fields = Object.fromEntries(
    frontmatter.split("\n").map((line) => {
      const at = line.indexOf(": ");
      return [line.slice(0, at), line.slice(at + 2)];
    }),
  );

  assert.equal(fields.name, "review");
  assert.equal(fields.model, "opus");
  assert.equal(fields.tools, "Read, Grep, Glob, Bash");
  assert.ok(fields.description.length > 0, "description is required by the loader");
  // A description spanning lines would break the frontmatter block.
  assert.ok(!fields.description.includes("\n"));
  assert.ok(body.includes("You are the Reviewer"), "body should be the charter");
});

test("the chosen model overrides the default in the written file", () => {
  assert.equal(agent("docs").defaultModel, "haiku");
  assert.match(renderAgentFile(agent("docs"), "opus"), /^model: opus$/m);
});

test("the manifest lists only the agents on the team, with their models", () => {
  const team = [agent("lead"), agent("engineer")];
  const manifest = renderAgentsManifest(team, { engineer: "opus" });

  assert.match(manifest, /\| @lead \|.*\| opus \|/);
  // Overridden, not the sonnet default.
  assert.match(manifest, /\| @engineer \|.*\| opus \|/);
  assert.ok(!manifest.includes("@security"), "an absent agent must not appear");
  assert.ok(manifest.includes("You are the Lead"), "charters belong in the manifest");
});
