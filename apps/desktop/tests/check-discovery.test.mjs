import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { discoverChecks, parseScripts } = jiti("../src/main/check-discovery.ts");

const execFileAsync = promisify(execFile);

async function repository(scripts, { commit = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "docket-checks-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts }, null, 2));
  if (commit) {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "t@t.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
  }
  return root;
}

async function rewrite(root, scripts) {
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts }, null, 2));
}

test("discovers one check per kind from the repository's own scripts", async () => {
  const root = await repository({
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    test: "vitest run",
    build: "vite build",
  });
  try {
    const { checks, drift, committedUnavailable } = await discoverChecks(root);

    assert.equal(committedUnavailable, false);
    assert.deepEqual(drift, []);
    // Ordered cheapest signal first, build last.
    assert.deepEqual(
      checks.map((check) => check.kind),
      ["typecheck", "lint", "test", "build"],
    );
    assert.equal(checks[2].label, "npm run test");
    assert.equal(checks[2].declaration, "vitest run");
    assert.equal(checks[2].id, "npm:test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a script that never terminates is not treated as a check", async () => {
  const root = await repository({ "test:watch": "vitest --watch", dev: "vite", start: "node ." });
  try {
    const { checks } = await discoverChecks(root);
    assert.deepEqual(checks, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a colon variant counts when there is no exact name", async () => {
  const root = await repository({ "test:unit": "vitest run unit" });
  try {
    const { checks } = await discoverChecks(root);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].script, "test:unit");
    assert.equal(checks[0].kind, "test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an agent weakening the test script is reported as drift", async () => {
  // The failure this whole module exists for: the suite still exits zero, still
  // reports green, and proves nothing.
  const root = await repository({ test: "vitest run" });
  try {
    await rewrite(root, { test: "true" });

    const { checks, drift } = await discoverChecks(root);

    assert.equal(checks[0].declaration, "true");
    assert.equal(drift.length, 1);
    assert.equal(drift[0].checkId, "npm:test");
    assert.equal(drift[0].reason, "changed");
    assert.equal(drift[0].committed, "vitest run");
    assert.equal(drift[0].working, "true");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a check added since HEAD is reported as added, not as tampering", async () => {
  const root = await repository({ test: "vitest run" });
  try {
    await rewrite(root, { test: "vitest run", lint: "eslint ." });

    const { drift } = await discoverChecks(root);

    assert.equal(drift.length, 1);
    assert.equal(drift[0].checkId, "npm:lint");
    assert.equal(drift[0].reason, "added");
    assert.equal(drift[0].committed, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without a committed manifest, drift is unknown rather than clean", async () => {
  // Reporting "no drift" here would be a claim about a comparison that never
  // happened, which is the exact dishonesty this feature is meant to catch.
  const root = await repository({ test: "vitest run" }, { commit: false });
  try {
    const { checks, drift, committedUnavailable } = await discoverChecks(root);

    assert.equal(checks.length, 1);
    assert.deepEqual(drift, []);
    assert.equal(committedUnavailable, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a directory with no manifest yields no checks and no false drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "docket-checks-"));
  try {
    const result = await discoverChecks(root);
    assert.deepEqual(result.checks, []);
    assert.deepEqual(result.drift, []);
    assert.equal(result.committedUnavailable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed and script-less manifests parse to null rather than throwing", () => {
  assert.equal(parseScripts("{ not json"), null);
  assert.equal(parseScripts('{"name":"x"}'), null);
  assert.equal(parseScripts('{"scripts":null}'), null);
  assert.deepEqual(parseScripts('{"scripts":{"test":"vitest","bad":3}}'), { test: "vitest" });
});

test("drift is detected when the workspace is a subdirectory of the repository", async () => {
  // Regression: `git show HEAD:package.json` resolves from the repository root,
  // so opening a monorepo package read the wrong manifest and silently reported
  // drift as unknown -- for exactly the repositories most likely to have it.
  const root = await mkdtemp(join(tmpdir(), "docket-mono-"));
  try {
    const pkg = join(root, "apps", "desktop");
    await execFileAsync("mkdir", ["-p", pkg]);
    await writeFile(join(pkg, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "t@t.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });

    await writeFile(join(pkg, "package.json"), JSON.stringify({ scripts: { test: "true" } }));

    const { drift, committedUnavailable } = await discoverChecks(pkg);

    assert.equal(committedUnavailable, false, "committed manifest should be readable from a subdirectory");
    assert.equal(drift.length, 1);
    assert.equal(drift[0].reason, "changed");
    assert.equal(drift[0].committed, "vitest run");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
