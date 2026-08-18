import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { discoverChecks } = jiti("../src/main/check-discovery.ts");
const { runCheck } = jiti("../src/main/check-runner.ts");
const { assemblePacket } = jiti("../src/shared/evidence.ts");

const run = promisify(execFile);

/** A committed repository with the given files. */
async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), "docket-config-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(root, name), body);
  }
  await run("git", ["init", "-q", "."], { cwd: root });
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-qm", "i"], {
    cwd: root,
  });
  return root;
}

const PYTHON = JSON.stringify(
  {
    image: "python:3.12-bookworm",
    checks: [
      { kind: "test", command: ["pytest", "-q"] },
      { kind: "lint", command: ["ruff", "check", "."] },
    ],
  },
  null,
  2,
);

test("a repository with no package.json is served when it declares itself", async () => {
  // The whole point of this feature: before it, a Python repository was not
  // served badly, it was not served at all.
  const root = await repo({ "docket.json": PYTHON });
  try {
    const discovery = await discoverChecks(root);
    assert.deepEqual(discovery.checks.map((check) => check.kind), ["lint", "test"]);
    assert.deepEqual(discovery.checks[1].command, ["pytest", "-q"]);
    assert.equal(discovery.checks[1].image, "python:3.12-bookworm");
    assert.equal(discovery.checks[1].runner, "command");
    assert.deepEqual(discovery.drift, [], "a committed config has not drifted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("weakening a declared command is caught as drift", async () => {
  // Editing docket.json is by far the cheapest way to make a gate pass, and
  // it leaves a green result behind. This is the protection that matters.
  const root = await repo({ "docket.json": PYTHON });
  try {
    await writeFile(
      join(root, "docket.json"),
      JSON.stringify({ image: "python:3.12-bookworm", checks: [{ kind: "test", command: ["true"] }] }),
    );
    const discovery = await discoverChecks(root);
    assert.equal(discovery.drift.length, 1);
    assert.equal(discovery.drift[0].reason, "changed");
    assert.equal(discovery.drift[0].committed, '["pytest","-q"]');
    assert.equal(discovery.drift[0].working, '["true"]');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reformatting the config is not drift", async () => {
  const root = await repo({ "docket.json": PYTHON });
  try {
    // Same commands, different whitespace and key order. A gate that cried
    // drift here would be one people learn to ignore.
    await writeFile(
      join(root, "docket.json"),
      '{"checks":[{"command":["ruff","check","."],"kind":"lint"},{"command":["pytest","-q"],"kind":"test"}],"image":"python:3.12-bookworm"}',
    );
    const discovery = await discoverChecks(root);
    assert.deepEqual(discovery.drift, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a declared config wins over npm scripts, and says so by its ids", async () => {
  const root = await repo({
    "docket.json": JSON.stringify({ checks: [{ kind: "test", command: ["pytest"] }] }),
    "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest", lint: "eslint ." } }),
  });
  try {
    const discovery = await discoverChecks(root);
    // One source of truth per repository. Merging the two would run some
    // checks the repository declared and some it did not, and the packet
    // could not say which was which.
    assert.deepEqual(discovery.checks.map((check) => check.id), ["config:test"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a broken config blocks, and never reads as a repository with no checks", async () => {
  const root = await repo({
    "docket.json": "{ this is not json",
    "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest" } }),
  });
  try {
    const discovery = await discoverChecks(root);
    assert.deepEqual(discovery.checks, [], "a config that will not parse declares nothing");
    assert.match(discovery.configError, /not valid JSON/);

    // And it reaches the reviewer as a blocking finding. Falling back to the
    // npm scripts here would let one corrupted file swap the declared gate
    // for a different one with nothing said about it.
    const packet = assemblePacket({
      intent: "x",
      committedUnavailable: false,
      configError: discovery.configError,
      change: { files: 1, added: 1, removed: 0, truncated: false, unavailable: null },
      checks: [],
      reach: { references: [], contained: [], unavailable: null },
      claims: [],
    });
    const finding = packet.findings.find((entry) => entry.id === "config-unreadable");
    assert.ok(finding, "a broken config produced no finding");
    assert.equal(finding.severity, "blocking");
    assert.equal(packet.clean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a check that names an image is never run on the host instead", async () => {
  // The refusal that keeps a result honest. `python:3.12-bookworm` is part of
  // what the check IS; running `pytest` against whatever this machine has is
  // a different check, and reporting it as this one would be a false
  // statement about what was verified.
  const root = await repo({
    "docket.json": JSON.stringify({
      image: "python:3.12-bookworm",
      checks: [{ kind: "test", command: ["definitely-not-a-real-binary-xyz"] }],
    }),
  });
  try {
    const discovery = await discoverChecks(root);
    const result = await runCheck(root, discovery.checks[0], {}, { forceHost: true });

    assert.equal(result.isolation, "refused");
    assert.equal(result.outcome, "errored");
    assert.match(result.error, /python:3\.12-bookworm/);
    assert.match(result.error, /different check/);
    // Not a failure and not a pass. The distinction the packet rests on.
    assert.notEqual(result.outcome, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a declared command with no image still runs, as argv, with no shell", async () => {
  const root = await repo({
    "docket.json": JSON.stringify({
      checks: [{ kind: "test", command: ["node", "-e", "process.stdout.write('ran; echo pwned')"] }],
    }),
  });
  try {
    const discovery = await discoverChecks(root);
    const result = await runCheck(root, discovery.checks[0], {}, { forceHost: true });
    assert.equal(result.outcome, "passed");
    // The semicolon is data. Had a shell been involved it would have been a
    // command separator, and the output would show the second half running.
    assert.match(result.output, /ran; echo pwned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a config edited between discovery and the run is caught before anything executes", async () => {
  // The npm path re-reads package.json for exactly this reason. A declared
  // command needs it more: the argv here IS the process, so a stale one is
  // not a wrong lookup, it is the wrong program running.
  const root = await repo({
    "docket.json": JSON.stringify({
      checks: [{ kind: "test", command: ["node", "-e", "process.exit(1)"] }],
    }),
  });
  try {
    const discovery = await discoverChecks(root);

    // The working tree moves under the discovered check, the way it would if
    // an agent were still editing while a run was queued.
    await writeFile(
      join(root, "docket.json"),
      JSON.stringify({ checks: [{ kind: "test", command: ["node", "-e", "0"] }] }),
    );

    const result = await runCheck(root, discovery.checks[0], {}, { forceHost: true });
    assert.equal(result.outcome, "errored", "a stale declaration must not be executed");
    assert.match(result.error, /changed since this check was read/);
    // The would-be-passing replacement never ran.
    assert.notEqual(result.outcome, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a config deleted between discovery and the run stops the run", async () => {
  const root = await repo({
    "docket.json": JSON.stringify({ checks: [{ kind: "test", command: ["node", "--version"] }] }),
  });
  try {
    const discovery = await discoverChecks(root);
    await rm(join(root, "docket.json"));
    const result = await runCheck(root, discovery.checks[0], {}, { forceHost: true });
    assert.equal(result.outcome, "errored");
    assert.match(result.error, /could not be read/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
