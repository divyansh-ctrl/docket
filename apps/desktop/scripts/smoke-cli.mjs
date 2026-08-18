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
    assert.equal(code, 1, "a failing check must exit 1");
    // The assertion that catches a gate which runs nothing: an exit code with
    // no packet behind it is indistinguishable from a working gate until you
    // look at the output.
    assert.ok(stdout.trim().length > 0, "the gate exited without printing a packet");
    assert.match(stdout, /stop a merge/);
    assert.match(stdout, /npm run test failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

check("a passing repository exits 0 with a packet", async () => {
  const root = await repo({ test: "node --version" });
  try {
    const { code, stdout } = await gate(["--workspace", root, "--intent", "x"], root);
    assert.equal(code, 0);
    assert.ok(stdout.trim().length > 0, "the gate exited without printing a packet");
    assert.match(stdout, /ran and passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
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
    await rm(root, { recursive: true, force: true });
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
