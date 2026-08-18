import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { environmentFailure, runCheck, resolveNpm } = jiti("../src/main/check-runner.ts");
const { isEvidence, passed } = jiti("../src/shared/checks.ts");

const {
  canSeeWorkspace,
  detectRuntime,
  planDependencies,
  removeVolumeArgv,
  resolveMount,
  workspaceOnly,
} = jiti("../src/main/container.ts");

const npmAvailable = (await resolveNpm(true)).path !== null;
const needsNpm = { skip: npmAvailable ? false : "npm is not available on this host" };

// Whether a runtime exists, and separately whether it can see the directory
// these tests build their fixtures in. The two are not the same thing, and
// treating them as one is the bug the tests below exist for: on macOS the
// runtime is a VM that shares the home directory but not /var/folders, which
// is exactly where os.tmpdir() points.
const runtime = await detectRuntime(true);
const sharedTmp = runtime.command !== null && (await isShared(runtime.command, tmpdir()));
// The home directory as well, because on macOS the temp directory is the one
// place the runtime cannot reach, and the test that matters most is the one
// comparing a real contained run against a real host run. Gating that on the
// temp directory would skip it on the only machine where the failures it
// guards were ever observed.
const sharedHome = runtime.command !== null && (await isShared(runtime.command, homedir()));

const needsSharedTmp = {
  skip: sharedTmp ? false : "no container runtime that can see the temp directory",
};
const needsSharedHome = {
  skip: sharedHome ? false : "no container runtime that can see the home directory",
};
const needsUnsharedTmp = {
  skip: runtime.command === null
    ? "no container runtime on this host"
    : sharedTmp
      ? "this runtime can see the temp directory, so there is no unshared case to test"
      : false,
};

async function isShared(command, parent) {
  const probe = await mkdtemp(join(parent, "docket-mount-"));
  try {
    await writeFile(join(probe, "package.json"), "{}");
    return (await canSeeWorkspace(command, workspaceOnly(probe, ""), "package.json")).ok;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}

async function workspace(scripts, parent = tmpdir()) {
  const root = await mkdtemp(join(parent, "docket-run-"));
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

test("a missing program is read as the environment, not as the code", () => {
  // Every string here was produced by this repository's own suite running in a
  // container: the image had no Git, so fifteen tests failed at once with a
  // message that has nothing to do with the code they were testing.
  for (const output of [
    "not ok 25 - discovers checks\n  error: 'spawn git ENOENT'\n  code: 'ENOENT'",
    "sh: 1: cargo: not found",
    "/bin/bash: line 3: rustc: command not found",
  ]) {
    const reason = environmentFailure(output);

    assert.ok(reason, `not recognised: ${output}`);
    assert.match(reason, /not installed/);
    // The quoted line is what lets a reader check the call rather than accept
    // it. A classification nobody can audit is just a different guess.
    assert.match(reason, /git|cargo|rustc/);
  }
});

test("a dependency built for the wrong platform is read as the environment", () => {
  const reason = environmentFailure(
    "Error: Failed to load native module: pty.node, checked: build/Release, prebuilds/linux-arm64",
  );

  assert.ok(reason);
  assert.match(reason, /different platform/);
  assert.match(reason, /no evidence rather than as a failure/);
});

test("an ordinary test failure is never explained away as the environment", () => {
  // The dangerous direction. Calling a real failure "did not run" costs a
  // finding; calling an environment failure a test failure tells a reviewer
  // their code is broken when it is not. Only the second is a lie, but the
  // first still has to stay rare, so the patterns are held to real signatures.
  for (const output of [
    "not ok 3 - adds two numbers\n  expected: 4\n  actual: 5",
    "AssertionError: The input did not match the regular expression /home/",
    "Error: Cannot find module './config'",
    "npm ERR! Missing script: \"tset\"",
    "TypeError: undefined is not a function",
  ]) {
    assert.equal(environmentFailure(output), null, `misread as environment: ${output}`);
  }
});

test("a check that fails for the environment's reasons is not evidence", needsNpm, async () => {
  // End to end rather than on the classifier alone: the outcome, the error and
  // isEvidence all have to agree, and it is the packet that reads them.
  const script = "echo 'sh: 1: git: not found' >&2; exit 1";
  const root = await workspace({ test: script });
  try {
    const result = await runCheck(root, check("test"), { test: script }, { forceHost: true });

    assert.equal(result.outcome, "errored");
    assert.notEqual(result.outcome, "failed");
    assert.match(result.error, /not installed/);
    assert.equal(isEvidence(result), false);
    assert.equal(passed(result), false);
    // The output is still kept in full: the reason is a reading of it, not a
    // replacement for it.
    assert.match(result.output, /git: not found/);
    assert.equal(result.exitCode, 1);
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
    //
    // The bound discriminates between "killed at 1.5s" and "waited out 30s".
    // It is not a performance budget, so it sits nearer the middle than the
    // floor: on a loaded machine npm's own start-up can eat several seconds
    // before the timeout even starts, and a bound tight enough to fail on
    // that is a bound that fails for a reason it is not testing.
    assert.ok(result.durationMs < 20_000, `timeout did not kill the tree: ${result.durationMs}ms`);
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
  // The script announces itself before sleeping, and the abort waits for that
  // announcement. The previous version aborted 300ms in and hoped the process
  // existed by then -- on a loaded runner it often did not, and the test
  // failed for a reason that had nothing to do with what it was checking.
  // Cancelling before the spawn is a real case, and it has its own test now.
  const script = "echo running && sleep 30";
  const root = await workspace({ test: script });
  try {
    const controller = new AbortController();
    const running = runCheck(root, check("test"), { test: script }, {
      signal: controller.signal,
      onOutput: (chunk) => {
        if (chunk.includes("running")) controller.abort();
      },
    });

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

test("a check reaches the same verdict contained as it does on the host", needsSharedHome, async () => {
  // Track 0.5, and the only test here that would notice the two paths
  // disagreeing. Every other test in this file exercises one path at a time,
  // which is exactly how a contained run came to report this repository's
  // passing tests as failing without a single test going red.
  //
  // Both directions matter. A contained run that fails what the host passes is
  // a false finding; one that passes what the host fails is a missed one, and
  // that is the worse of the two.
  for (const [script, expected] of [
    ["echo agreed", "passed"],
    ["echo nope >&2; exit 2", "failed"],
  ]) {
    // Under the home directory, not the temp directory: that is the one the
    // runtime shares on macOS, and a skipped comparison proves nothing.
    const root = await workspace({ test: script }, homedir());
    let volume = null;
    try {
      const host = await runCheck(root, check("test"), { test: script }, {
        forceHost: true,
        timeoutMs: 300_000,
      });
      const contained = await runCheck(root, check("test"), { test: script }, {
        timeoutMs: 900_000,
      });
      volume = (await planDependencies(await resolveMount(root))).dependencies?.volume ?? null;

      assert.equal(host.isolation, "host");
      assert.equal(host.outcome, expected);
      // If this run silently fell back to the host the comparison below would
      // pass while proving nothing, so the reason is asserted, not assumed.
      assert.equal(contained.isolation, "container", contained.isolationReason ?? "no reason given");

      assert.equal(contained.outcome, host.outcome, `the two paths disagreed on: ${script}`);
      assert.equal(contained.exitCode, host.exitCode);
    } finally {
      await rm(root, { recursive: true, force: true });
      // The volume outlives the container, so the test that made it removes it.
      if (volume && runtime.command) {
        const [command, ...args] = removeVolumeArgv(runtime.command, volume);
        await new Promise((resolve) => {
          const child = spawn(command, args, { stdio: "ignore" });
          child.on("error", resolve);
          child.on("close", resolve);
        });
      }
    }
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

test("cancelling before the process is spawned still cancels", needsNpm, async () => {
  // The bug a flaky CI failure was hiding. Reaching the spawn takes a runtime
  // probe, a mount check and possibly a dependency install -- seconds during
  // which a person can press cancel. The abort listener is registered after
  // all that, so an abort that arrived first fired into nothing: the process
  // started anyway and ran to its timeout. Aborting up front is the case the
  // 300ms race in the test above only sometimes produced.
  const root = await workspace({ test: "sleep 30" });
  try {
    const controller = new AbortController();
    controller.abort();

    const started = Date.now();
    const result = await runCheck(root, check("test"), { test: "sleep 30" }, {
      signal: controller.signal,
    });

    assert.equal(result.outcome, "errored");
    assert.equal(result.error, "Cancelled");
    assert.equal(isEvidence(result), false);
    // Nothing was launched, so this is immediate rather than merely quick.
    assert.ok(Date.now() - started < 5_000, `an already-cancelled run took ${Date.now() - started}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
