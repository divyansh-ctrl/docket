import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { runCheck, resolveNpm } = jiti("../src/main/check-runner.ts");
const { isEvidence, passed } = jiti("../src/shared/checks.ts");

const { canSeeWorkspace, detectRuntime, workspaceOnly } = jiti("../src/main/container.ts");

const npmAvailable = (await resolveNpm(true)).path !== null;
const needsNpm = { skip: npmAvailable ? false : "npm is not available on this host" };

// Whether a runtime exists, and separately whether it can see the directory
// these tests build their fixtures in. The two are not the same thing, and
// treating them as one is the bug the tests below exist for: on macOS the
// runtime is a VM that shares the home directory but not /var/folders, which
// is exactly where os.tmpdir() points.
const runtime = await detectRuntime(true);
const sharedTmp =
  runtime.command !== null && (await tmpIsShared(runtime.command));

const needsSharedTmp = {
  skip: sharedTmp ? false : "no container runtime that can see the temp directory",
};
const needsUnsharedTmp = {
  skip: runtime.command === null
    ? "no container runtime on this host"
    : sharedTmp
      ? "this runtime can see the temp directory, so there is no unshared case to test"
      : false,
};

async function tmpIsShared(command) {
  const probe = await mkdtemp(join(tmpdir(), "docket-mount-"));
  try {
    await writeFile(join(probe, "package.json"), "{}");
    return (await canSeeWorkspace(command, workspaceOnly(probe, ""), "package.json")).ok;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}

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
    // The reader must be able to reproduce the run by hand, whichever path it
    // took. On a machine with a container runtime the argv is the full `docker
    // run ...` vector and the script is at the end of it; on a bare host it is
    // just `npm run test`. Asserting the host shape flatly is what made this
    // fail on the one CI runner that actually has Docker -- which is also how
    // we learned the contained path works.
    assert.deepEqual(result.argv.slice(-2), ["run", "test"]);
    assert.ok(result.argv.length >= 3, `argv should name its runner: ${JSON.stringify(result.argv)}`);
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

test("a run with no container runtime is labelled as uncontained, with a reason", needsNpm, async () => {
  // Not a hypothetical: most development machines have no container runtime, so
  // this is the path nearly every check takes today. The result has to carry
  // that, because a host run and a contained run are not equal evidence.
  const root = await workspace({ test: "echo ran" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo ran" }, { forceHost: true });

    assert.equal(result.outcome, "passed");
    assert.equal(result.isolation, "host");
    assert.equal(typeof result.isolationReason, "string");
    assert.ok(result.isolationReason.length > 0, "an uncontained run must say why");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a check really does run inside a container when one is available", needsSharedTmp, async () => {
  // Runs where the runtime can actually see the temp directory: the Linux CI
  // image, where there is no VM between the daemon and the filesystem. On
  // macOS this skips and the test below covers what happens instead.
  const script = "echo contained-run && cat /etc/os-release";
  const root = await workspace({ test: script });
  try {
    const result = await runCheck(root, check("test"), { test: script }, { timeoutMs: 300_000 });

    assert.equal(result.outcome, "passed", `container run failed: ${result.error ?? result.output}`);
    assert.equal(result.isolation, "container");
    assert.equal(result.isolationReason, null);
    assert.match(result.output, /contained-run/);
    // Proof it was not the host: the image is Debian, and this machine is not.
    assert.match(result.output, /Debian/i);
    assert.ok(result.argv.includes("--network"), "the contained argv must carry its flags");
    assert.equal(result.argv[result.argv.indexOf("--network") + 1], "none");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a repository the runtime cannot see is never reported as a contained run", needsUnsharedTmp, async () => {
  // The failure this guards is not theoretical, it is what macOS does today. A
  // bind mount of a path the runtime's VM does not share mounts as an EMPTY
  // directory rather than failing. npm then finds no manifest, exits non-zero,
  // and Docket would report the repository's tests as failing -- a red result
  // with nothing to do with the code, which is worse than any host run because
  // it looks like a real finding.
  const root = await workspace({ test: "echo should-not-be-reached" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo should-not-be-reached" });

    assert.notEqual(result.isolation, "container");
    // And emphatically not a failure: the check either ran on the host or did
    // not run, and either way the reason names the mount.
    assert.notEqual(result.outcome, "failed");
    assert.match(result.isolationReason ?? "", /cannot see this repository/);
    assert.match(result.isolationReason ?? "", /file sharing|shares/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requiring isolation refuses when the runtime cannot see the repository", needsUnsharedTmp, async () => {
  const root = await workspace({ test: "echo should-not-be-reached" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo should-not-be-reached" }, {
      requireIsolation: true,
    });

    // A runtime that is running but blind to this repository is not isolation,
    // and must fail closed exactly like no runtime at all.
    assert.equal(result.isolation, "refused");
    assert.equal(result.outcome, "errored");
    assert.deepEqual(result.argv, []);
    assert.match(result.error, /cannot see this repository/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requiring isolation refuses the run rather than falling back to the host", async () => {
  // The whole point of the setting. Without this assertion the toggle could be
  // wired to nothing and every test above would still pass, because the host
  // path produces a perfectly good result -- just not the one that was asked
  // for.
  const root = await workspace({ test: "echo should-not-run" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo should-not-run" }, {
      forceHost: true,
      requireIsolation: true,
    });

    assert.equal(result.outcome, "errored");
    assert.equal(result.isolation, "refused");
    // Nothing was spawned, so there is no exit code and no output to quote.
    assert.equal(result.exitCode, null);
    assert.deepEqual(result.argv, []);
    assert.doesNotMatch(result.output, /should-not-run/);
    assert.equal(isEvidence(result), false);
    assert.equal(passed(result), false);
    // A refusal the reader cannot act on is a dead end, so it names the remedy.
    assert.match(result.error, /required/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requiring isolation does not stop a run that would have been contained anyway", needsNpm, async () => {
  // Guards the inverse mistake: a fail-closed flag that fails closed always is
  // just a broken feature. With no runtime present this asserts the fallback
  // stays open when the requirement is off, which is the default everyone gets.
  const root = await workspace({ test: "echo ran" });
  try {
    const result = await runCheck(root, check("test"), { test: "echo ran" }, {
      forceHost: true,
      requireIsolation: false,
    });

    assert.equal(result.outcome, "passed");
    assert.equal(result.isolation, "host");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a refusal before anything spawns is still labelled", async () => {
  const root = await workspace({ test: "echo hi" });
  try {
    const result = await runCheck(root, check("nope"), { test: "echo hi" }, { forceHost: true });

    assert.equal(result.outcome, "errored");
    assert.equal(result.isolation, "host");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
