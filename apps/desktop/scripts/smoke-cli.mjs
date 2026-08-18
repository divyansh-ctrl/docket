/**
 * Runs the built `docket check` binary and checks what it actually does.
 *
 * This exists because of a specific failure. The entry point guarded its own
 * `main()` behind a test on `process.argv[1]`, the bundle is emitted under a
 * different name than the source file, and so the built gate ran nothing,
 * printed nothing, and exited 0 -- on a repository with a failing test and an
 * agent lying about it. A gate that passes everything in silence is the worst
 * outcome this product has, and it survived a clean typecheck, a clean lint,
 * a successful build, and a unit suite that imported `main` directly from
 * source. Only running the artifact found it.
 *
 * So: the artifact, run as a shell would run it, with its exit code and its
 * output both asserted. Silence is a failure here even when the code is right.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const BINARY = join(here, "..", "dist-cli", "docket-check.cjs");

/** Runs the binary and returns its code and streams, never throwing. */
async function gate(args, cwd) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BINARY, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

/**
 * Removes a scenario's temp repository, and never fails the scenario for it.
 *
 * Two separate mistakes were here. Windows CI failed with `EBUSY: resource
 * busy or locked, rmdir` -- the check spawns real processes, and a handle can
 * outlive the exit by a moment, so deleting immediately races the OS. Node's
 * `rm` has retries for exactly this and they were not being used.
 *
 * The worse one: the delete ran in a `finally` inside each scenario's own
 * try/catch, so a cleanup error was printed as
 * `FAIL a failing check exits 1 AND says why`. That assertion had passed. A
 * harness that reports a failure in something it did not test is doing the
 * thing this product exists to stop, one level up -- so cleanup now reports
 * itself, in its own words, and is never mistaken for a verdict about the CLI.
 */
async function discard(root) {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    // Said out loud rather than swallowed. It is a temp directory on a
    // throwaway runner, so leaving it costs nothing -- but a silent catch here
    // would hide a real leak on a machine that is not throwaway.
    process.stdout.write(`note leftover temp directory ${root}: ${error.message}\n`);
  }
}

async function repo(scripts) {
  const root = await mkdtemp(join(tmpdir(), "docket-smoke-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "subject", version: "1.0.0", scripts }, null, 2),
  );
  await run("git", ["init", "-q", "."], { cwd: root });
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-qm", "i"], {
    cwd: root,
  });
  return root;
}

/**
 * Windows cannot run checks yet -- npm is a .cmd shim that will not launch
 * without a shell, and putting a shell back into the safe path is the one
 * fix that is not allowed (roadmap 2.3). The gate already knows this and says
 * so. What matters is that it says it *honestly*: an absence of evidence, not
 * a pass and not a failure. That is worth pinning down rather than skipping,
 * because it is exactly the claim 2.3 will have to change.
 */
const windows = process.platform === "win32";

const checks = [];
const check = (name, body) => checks.push([name, body]);

check("--help prints usage and exits 0", async () => {
  const { code, stdout } = await gate(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Exit codes/);
});

check("a failing check exits 1 AND says why", async () => {
  const root = await repo({ test: 'node -e "process.exit(1)"' });
  try {
    const { code, stdout } = await gate(["--workspace", root, "--intent", "x"], root);
    // The assertion that catches a gate which runs nothing: an exit code with
    // no packet behind it is indistinguishable from a working gate until you
    // look at the output. True on every platform.
    assert.ok(stdout.trim().length > 0, "the gate exited without printing a packet");
    assert.notEqual(code, 0, "an unproven or failing check must never exit clean");

    if (windows) {
      // The check never ran, so the packet must not describe it as failing.
      // Reporting a failure nobody observed is the thing this product exists
      // to remove, and it would be a poor place to start.
      assert.match(stdout, /did not finish|not supported on Windows/);
      assert.doesNotMatch(stdout, /npm run test failed/);
      return;
    }
    assert.equal(code, 1, "a failing check must exit 1");
    assert.match(stdout, /stop a merge/);
    assert.match(stdout, /npm run test failed/);
  } finally {
    await discard(root);
  }
});

check("a passing repository exits 0 with a packet", async () => {
  const root = await repo({ test: "node --version" });
  try {
    const { code, stdout } = await gate(["--workspace", root, "--intent", "x"], root);
    assert.ok(stdout.trim().length > 0, "the gate exited without printing a packet");

    if (windows) {
      // Fail-closed, and correctly so: a check that could not run has not
      // proven anything, so the packet is not clean and the gate does not
      // wave the change through. Pinned here so that when 2.3 lands and
      // Windows can run checks, this line is what tells us.
      assert.notEqual(code, 0, "unproven checks must not exit clean on Windows either");
      assert.match(stdout, /did not finish|not supported on Windows/);
      return;
    }
    assert.equal(code, 0);
    assert.match(stdout, /ran and passed/);
  } finally {
    await discard(root);
  }
});

check("--json emits a parseable packet with the fields the app shows", async () => {
  const root = await repo({ test: "node --version" });
  try {
    const { code, stdout } = await gate(["--workspace", root, "--json"], root);
    assert.equal(code, 1, "no intent was given, so the packet is not clean");
    const packet = JSON.parse(stdout);
    for (const field of ["intent", "change", "checks", "reach", "claims", "findings", "clean"]) {
      assert.ok(field in packet, `the packet is missing ${field}`);
    }
  } finally {
    await discard(root);
  }
});

check("a bad argument exits 2, never 1", async () => {
  const { code, stderr } = await gate(["--nonsense"]);
  assert.equal(code, 2, "an unusable invocation must not look like a verdict");
  assert.match(stderr, /Unknown argument/);
});

let failed = 0;
for (const [name, body] of checks) {
  try {
    await body();
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAIL ${name}\n     ${error.message}\n`);
  }
}
process.stdout.write(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
