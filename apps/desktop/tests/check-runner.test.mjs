import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { runCheck, resolveNpm } = jiti("../src/main/check-runner.ts");
const { isEvidence, passed } = jiti("../src/shared/checks.ts");

const npmAvailable = (await resolveNpm(true)).path !== null;
const needsNpm = { skip: npmAvailable ? false : "npm is not available on this host" };

async function workspace(scripts) {
  const root = await mkdtemp(join(tmpdir(), "docket-run-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts }, null, 2));
  return root;
}

function check(script, overrides = {}) {
  return {
    id: `npm:${script}`,
    kind: "test",
    label: `npm run ${script}`,
    runner: "npm",
    script,
    manifestPath: "package.json",
    declaration: "",
    ...overrides,
  };
}

test("a passing script is recorded as passed, with its real output", needsNpm, async () => {
  const root = await workspace({ test: "echo the-suite-ran" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo the-suite-ran" });

    assert.equal(result.outcome, "passed");
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /the-suite-ran/);
    assert.equal(passed(result), true);
    assert.equal(isEvidence(result), true);
    // The reader must be able to reproduce the run by hand.
    assert.deepEqual(result.argv.slice(1), ["run", "test"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failing script is recorded as failed, not as an error", needsNpm, async () => {
  const root = await workspace({ test: "echo boom >&2; exit 3" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo boom >&2; exit 3" });

    assert.equal(result.outcome, "failed");
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /boom/);
    // A real failure is still evidence: it ran and told us something.
    assert.equal(isEvidence(result), true);
    assert.equal(result.error, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a hanging script is timed out and never reported as a failure", needsNpm, async () => {
  const root = await workspace({ test: "sleep 30" });
  try {
    const result = await runCheck(root, check("test"), { test: "sleep 30" }, { timeoutMs: 1500 });

    assert.equal(result.outcome, "timed-out");
    // "Did not finish" and "failed" lead a reviewer to opposite conclusions.
    assert.equal(isEvidence(result), false);
    assert.match(result.error, /without finishing/);
    // The kill must reach npm's grandchildren. Signalling npm alone leaves the
    // sleep running and the pipe open, and the timeout waits out the full 30s
    // hang it was supposed to cut short.
    assert.ok(result.durationMs < 10_000, `timeout did not kill the tree: ${result.durationMs}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a script missing from the manifest is refused before anything is spawned", async () => {
  const root = await workspace({ test: "echo hi" });
  try {
    const result = await runCheck(root, check("nope"), { test: "echo hi" });

    assert.equal(result.outcome, "errored");
    assert.equal(result.exitCode, null);
    assert.deepEqual(result.argv, []);
    assert.match(result.error, /No script named "nope"/);
    assert.equal(isEvidence(result), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output arrives as it is produced, not only at the end", needsNpm, async () => {
  const root = await workspace({ test: "echo streamed" });
  try {
    const chunks = [];
    await runCheck(root, check("test"), { test: "echo streamed" }, { onOutput: (c) => chunks.push(c) });

    assert.match(chunks.join(""), /streamed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling a run reports it as cancelled rather than passed", needsNpm, async () => {
  const root = await workspace({ test: "sleep 30" });
  try {
    const controller = new AbortController();
    const running = runCheck(root, check("test"), { test: "sleep 30" }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);

    const result = await running;

    assert.equal(result.outcome, "errored");
    assert.equal(result.error, "Cancelled");
    assert.equal(isEvidence(result), false);
    assert.ok(result.durationMs < 10_000, `cancel did not kill the tree: ${result.durationMs}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the runner is resolved to a real executable, never a shell string", async () => {
  const runner = await resolveNpm(true);
  if (process.platform === "win32") {
    assert.equal(runner.path, null);
    assert.match(runner.reason, /not supported on Windows/);
  } else if (runner.path) {
    assert.ok(runner.path.startsWith("/"), "resolved npm should be an absolute path");
  }
});
