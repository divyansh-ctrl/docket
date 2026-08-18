import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { parseArgs, USAGE } = jiti("../src/cli/args.ts");

// The command line is the whole interface on a build machine. A flag that is
// silently misread there produces a confident answer about the wrong thing,
// with nobody watching.

const ok = (argv) => {
  const parsed = parseArgs(argv);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  return parsed.options;
};

test("the plan's own example parses to what it says", () => {
  // Straight from the roadmap's done-when line for a headless mode.
  const options = ok(["--workspace", ".", "--require-isolation", "--json"]);
  assert.equal(options.workspace, ".");
  assert.equal(options.requireIsolation, true);
  assert.equal(options.json, true);
});

test("defaults are the cautious ones", () => {
  const options = ok([]);
  assert.equal(options.workspace, ".");
  // Isolation off by default matches the app: most machines have no runtime,
  // and a gate that refuses to run on first use gates nothing.
  assert.equal(options.requireIsolation, false);
  assert.equal(options.json, false);
  assert.equal(options.claims, null);
  assert.equal(options.timeoutMs, null);
});

test("a flag never swallows the next flag as its value", () => {
  // `--workspace --json` must not check a directory called "--json". This is
  // the misparse that runs the gate against the wrong thing and says nothing.
  for (const argv of [
    ["--workspace", "--json"],
    ["--intent", "--require-isolation"],
    ["--claims", "--json"],
    ["--workspace"],
  ]) {
    const parsed = parseArgs(argv);
    assert.equal(parsed.ok, false, `swallowed: ${argv.join(" ")}`);
    assert.match(parsed.error, /needs a value/);
  }
});

test("a timeout that is not a number is refused, not turned into NaN", () => {
  // NaN would disable the timeout entirely, which is the one thing a timeout
  // must never silently do.
  for (const value of ["soon", "", "-1", "0", "NaN"]) {
    const parsed = parseArgs(["--timeout", value]);
    assert.equal(parsed.ok, false, `accepted "${value}"`);
  }
  assert.equal(ok(["--timeout", "1500"]).timeoutMs, 1500);
});

test("an unknown argument stops the run rather than being ignored", () => {
  const parsed = parseArgs(["--require-isolaton"]);
  assert.equal(parsed.ok, false);
  // A typo'd --require-isolation that is quietly ignored is the worst case:
  // the caller believes they demanded isolation and did not get it.
  assert.match(parsed.error, /Unknown argument/);
});

test("values with spaces and leading dashes inside them survive", () => {
  assert.equal(ok(["--intent", "fix the -n flag"]).intent, "fix the -n flag");
  assert.equal(ok(["--workspace", "/tmp/a b/repo"]).workspace, "/tmp/a b/repo");
});

test("the usage text states what the exit codes mean", () => {
  // The 1-versus-2 distinction is the product's thesis applied to itself, so
  // it belongs where the person wiring up CI will read it.
  assert.match(USAGE, /Exit codes/);
  assert.match(USAGE, /0\s+A packet was produced and nothing in it should stop a merge/);
  assert.match(USAGE, /1\s+A packet was produced and something in it should stop a merge/);
  assert.match(USAGE, /2\s+No packet could be produced/);
});
