import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { claimsFrom, render, EXIT, main } = jiti("../src/cli/check.ts");

const run = promisify(execFile);
const npmAvailable = await run("npm", ["--version"]).then(() => true, () => false);
const needsNpm = { skip: npmAvailable ? false : "npm is not available on this host" };

/** A repository with the given scripts and one file, committed. */
async function repo(scripts, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "docket-cli-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "subject", version: "1.0.0", type: "module", scripts }, null, 2),
  );
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), body);
  }
  await run("git", ["init", "-q", "."], { cwd: root });
  await run("git", ["add", "-A"], { cwd: root });
  await run(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root },
  );
  return root;
}

test("claims are read from a real hook log, and non-claims are left alone", async () => {
  const root = await mkdtemp(join(tmpdir(), "docket-claims-"));
  const log = join(root, "activity.jsonl");
  await writeFile(
    log,
    [
      JSON.stringify({
        hook_event_name: "SubagentStop",
        agent_type: "engineer",
        agent_id: "r1",
        last_assistant_message: "Rewrote the store. 4 of 4 passing. Lint is clean.",
      }),
      // A start event carries no summary and must contribute nothing.
      JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "engineer", agent_id: "r1" }),
      "",
      "not json at all",
    ].join("\n"),
  );

  const claims = await claimsFrom(log);
  assert.deepEqual(
    claims.map((claim) => `${claim.kind}:${claim.verdict}`).sort(),
    ["lint:passed", "test:passed"],
  );
  // A malformed line must not take the run down: the log is appended to by
  // another process and can be caught mid-write.
  await rm(root, { recursive: true, force: true });
});

test("the rendered packet leads with the verdict and numbers the findings", () => {
  const text = render({
    intent: "",
    change: { files: 0, added: 0, removed: 0, truncated: false, unavailable: null },
    checks: [],
    reach: { references: [], contained: [], unavailable: null },
    claims: [],
    findings: [
      { id: "a", severity: "blocking", title: "The tests fail", detail: "Exited 1." },
      { id: "b", severity: "note", title: "A note", detail: "" },
    ],
    clean: false,
  });
  const lines = text.split("\n");
  assert.match(lines[0], /stop a merge/, "the verdict comes first");
  assert.match(text, /1\. \[blocking\] The tests fail/);
  assert.match(text, /2\. \[note\] A note/);
});

test("a repository whose checks pass exits clean", needsNpm, async () => {
  const root = await repo({ lint: "node --version", test: "node --version" });
  try {
    const code = await main(["--workspace", root, "--intent", "keep the lights on", "--json"]);
    assert.equal(code, EXIT.clean, "a passing repository must exit 0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failing check exits blocked, not unusable", needsNpm, async () => {
  const root = await repo({ test: "node -e \"process.exit(1)\"" });
  try {
    const code = await main(["--workspace", root, "--intent", "break it", "--json"]);
    // The distinction the whole exit-code scheme exists for: a check that ran
    // and failed is a verdict, not an inability to reach one.
    assert.equal(code, EXIT.blocked);
    assert.notEqual(code, EXIT.unusable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bad arguments are unusable, never a verdict", async () => {
  // Exiting 1 here would tell CI the change should not merge, on the strength
  // of a typo. It has to be distinguishable from a real finding.
  for (const argv of [["--nonsense"], ["--workspace"], ["--timeout", "soon"]]) {
    assert.equal(await main(argv), EXIT.unusable, argv.join(" "));
  }
});

test("--help exits clean and gates nothing", async () => {
  assert.equal(await main(["--help"]), EXIT.clean);
});
