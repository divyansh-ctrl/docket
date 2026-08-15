import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { canonicalize, compactPacket, matchesTree, verifyChain, SEALED_OUTPUT_BYTES } = jiti(
  "../src/shared/decision.ts",
);
const { DecisionLog, digestOf, renderRecord } = jiti("../src/main/decision-log.ts");
const { repositoryState } = jiti("../src/main/workspace-diff.ts");

const execFileAsync = promisify(execFile);

function packet(overrides = {}) {
  return {
    intent: "Rotate refresh tokens on reuse.",
    change: { files: 2, added: 18, removed: 6, truncated: false, unavailable: null },
    checks: [],
    reach: { references: [], contained: [], unavailable: null },
    findings: [],
    clean: true,
    ...overrides,
  };
}

async function log() {
  const root = await mkdtemp(join(tmpdir(), "docket-decision-"));
  return { root, log: new DecisionLog(root) };
}

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "docket-tree-"));
  await writeFile(join(root, "a.txt"), "one\n");
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "t@t.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

// --- canonical form --------------------------------------------------------

test("key order does not change the canonical form", () => {
  // The reason this exists. JSON.stringify preserves insertion order, so two
  // structurally identical packets built by different code paths would hash
  // differently and a record would fail to verify against itself.
  const left = canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
  const right = canonicalize({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });

  assert.equal(left, right);
});

test("array order does change the canonical form", () => {
  // Order is meaningful in a findings list: the packet sorts by severity, and
  // two packets with the same findings in a different order are not the same
  // packet.
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test("values JSON would silently drop are refused instead", () => {
  // JSON.stringify omits undefined and functions. Two records with different
  // contents would then produce the same digest, which is the one thing a
  // digest may never do.
  assert.throws(() => canonicalize({ a: undefined }), /undefined/);
  assert.throws(() => canonicalize({ a: () => 1 }), /function/);
  assert.throws(() => canonicalize({ a: Number.NaN }), /non-finite/);
});

// --- sealing ---------------------------------------------------------------

test("a sealed record hashes its own contents", async () => {
  const { root, log: decisions } = await log();
  try {
    const record = await decisions.seal({
      workspaceId: "ws1",
      head: "abc123",
      treeDigest: "deadbeef",
      decision: "approved",
      note: "Read the reuse guard.",
      packet: packet(),
      sealedAt: 1_700_000_000_000,
    });

    assert.equal(record.sequence, 1);
    assert.equal(record.previousDigest, null);
    assert.match(record.digest, /^[a-f0-9]{64}$/);
    // Re-derived from the stored record: the digest has to be reproducible by
    // anyone holding the record, or it attests to nothing.
    assert.equal(digestOf(bodyFields(record)), record.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function bodyFields(record) {
  const { digest, ...body } = record;
  void digest;
  return body;
}

test("records chain, and the chain is what catches an edit", async () => {
  const { root, log: decisions } = await log();
  try {
    await decisions.seal(seal({ note: "first" }));
    await decisions.seal(seal({ note: "second" }));
    const third = await decisions.seal(seal({ note: "third" }));

    const clean = await decisions.read("ws1");
    assert.equal(clean.records.length, 3);
    assert.equal(clean.verification.ok, true);
    assert.equal(clean.records[2].previousDigest, clean.records[1].digest);
    assert.equal(third.sequence, 3);

    // Now edit the middle record the way someone would: change the decision
    // and leave everything else, including the digest, alone.
    const path = join(root, "decisions", "ws1.jsonl");
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const tampered = JSON.parse(lines[1]);
    tampered.decision = "approved";
    lines[1] = JSON.stringify(tampered);
    await writeFile(path, `${lines.join("\n")}\n`);

    const checked = await decisions.read("ws1");
    assert.equal(checked.verification.ok, false);
    const problem = checked.verification.problems.find((entry) => entry.line === 2);
    assert.ok(problem, `expected a problem on line 2: ${JSON.stringify(checked.verification.problems)}`);
    assert.match(problem.reason, /changed after it was sealed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function seal(overrides = {}) {
  return {
    workspaceId: "ws1",
    head: "abc123",
    treeDigest: "deadbeef",
    decision: "changes-requested",
    note: "",
    packet: packet(),
    sealedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("removing a record breaks the chain at the join, not silently", async () => {
  const { root, log: decisions } = await log();
  try {
    await decisions.seal(seal({ note: "first" }));
    await decisions.seal(seal({ note: "second" }));
    await decisions.seal(seal({ note: "third" }));

    // Delete the middle one. Every remaining record is individually valid --
    // this is exactly the case a per-record hash alone would miss.
    const path = join(root, "decisions", "ws1.jsonl");
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    await writeFile(path, `${lines[0]}\n${lines[2]}\n`);

    const checked = await decisions.read("ws1");
    assert.equal(checked.verification.ok, false);
    assert.ok(
      checked.verification.problems.some((entry) => /removed or replaced|removed or reordered/.test(entry.reason)),
      `expected a chain break: ${JSON.stringify(checked.verification.problems)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a corrupt line is reported without discarding the good records around it", async () => {
  const { root, log: decisions } = await log();
  try {
    await decisions.seal(seal({ note: "first" }));
    const path = join(root, "decisions", "ws1.jsonl");
    await writeFile(path, `${(await readFile(path, "utf8")).trim()}\nnot json at all\n`);

    const checked = await decisions.read("ws1");

    // The good record survives. Destroying real history to punish one bad line
    // would lose more evidence than the corruption did.
    assert.equal(checked.records.length, 1);
    assert.equal(checked.records[0].note, "first");
    assert.equal(checked.verification.ok, false);
    assert.match(checked.verification.problems[0].reason, /not valid JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an absent log is empty, not unreadable", async () => {
  const { root, log: decisions } = await log();
  try {
    const checked = await decisions.read("never-sealed");
    assert.deepEqual(checked.records, []);
    assert.equal(checked.verification.ok, true);
    // A repository with no decisions is a normal state, and must not be
    // reported as a failure to read the log.
    assert.equal(checked.unavailable, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("logs are kept per workspace, so one repository's decisions never appear under another", async () => {
  const { root, log: decisions } = await log();
  try {
    await decisions.seal(seal({ workspaceId: "ws1", note: "on one" }));
    await decisions.seal(seal({ workspaceId: "ws2", note: "on the other" }));

    assert.equal((await decisions.read("ws1")).records.length, 1);
    assert.equal((await decisions.read("ws2")).records[0].note, "on the other");
    // Each log starts its own chain.
    assert.equal((await decisions.read("ws2")).records[0].previousDigest, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the log is written where only its owner can read it", async () => {
  const { root, log: decisions } = await log();
  try {
    await decisions.seal(seal());
    if (process.platform !== "win32") {
      const mode = (await stat(join(root, "decisions", "ws1.jsonl"))).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- binding to the tree ---------------------------------------------------

test("a record knows when the working tree has moved under it", async () => {
  const root = await repo();
  try {
    const before = await repositoryState(root);
    assert.match(before.head, /^[a-f0-9]{40}$/);
    assert.match(before.treeDigest, /^[a-f0-9]{64}$/);

    const record = { head: before.head, treeDigest: before.treeDigest };
    assert.equal(matchesTree(record, before), "same");

    // An uncommitted edit is the case that matters: it is the state an agent
    // leaves behind and the state a reviewer decides on.
    await writeFile(join(root, "a.txt"), "two\n");
    assert.equal(matchesTree(record, await repositoryState(root)), "changed");

    // Putting it back is not a different tree.
    await writeFile(join(root, "a.txt"), "one\n");
    assert.equal(matchesTree(record, await repositoryState(root)), "same");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a new untracked file counts as the tree moving", async () => {
  const root = await repo();
  try {
    const before = await repositoryState(root);
    await writeFile(join(root, "sneaked-in.ts"), "export const x = 1;\n");

    assert.equal(matchesTree(before, await repositoryState(root)), "changed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unknown tree is unknown, never assumed to match", async () => {
  // The rule the whole product runs on: absence is stated, not implied. A
  // digest that could not be computed does not license "unchanged".
  assert.equal(matchesTree({ head: "a", treeDigest: null }, { head: "a", treeDigest: "x" }), "unknown");
  assert.equal(matchesTree({ head: "a", treeDigest: "x" }, { head: "a", treeDigest: null }), "unknown");
  // A different commit is changed even when the diff digest happens to match,
  // which it does whenever both trees are clean.
  assert.equal(matchesTree({ head: "a", treeDigest: "x" }, { head: "b", treeDigest: "x" }), "changed");
});

test("outside a repository the state is unknown rather than empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "docket-notrepo-"));
  try {
    const state = await repositoryState(root);
    assert.equal(state.head, null);
    // ls-files fails outside a repository, so there is no digest to report.
    assert.equal(state.treeDigest, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- what a record carries -------------------------------------------------

test("check output is capped before sealing, and the cap is visible in the record", async () => {
  const long = "x".repeat(SEALED_OUTPUT_BYTES * 2);
  const compacted = compactPacket(
    packet({
      checks: [
        {
          check: { id: "npm:test", kind: "test", label: "npm run test", runner: "npm", script: "test", manifestPath: "package.json", declaration: "vitest" },
          result: {
            checkId: "npm:test", outcome: "passed", exitCode: 0, output: long,
            outputTruncated: false, durationMs: 10, argv: ["npm", "run", "test"],
            error: null, isolation: "container", isolationReason: null,
          },
          drift: null,
        },
      ],
    }),
  );

  const stored = compacted.checks[0].result;
  assert.ok(stored.output.length < long.length);
  // A shortened log that looks complete is worse than a short one: the record
  // says it was shortened.
  assert.equal(stored.outputTruncated, true);
  assert.match(stored.output, /kept only the last/);
  // The tail is kept, because failures print at the end.
  assert.ok(stored.output.endsWith("x"));
});

test("the digest covers the packet, so swapping it in is caught", () => {
  const body = {
    version: 1, sequence: 1, workspaceId: "ws1", head: "abc", treeDigest: "def",
    decision: "approved", note: "", sealedAt: 1, previousDigest: null, packet: packet(),
  };
  const swapped = { ...body, packet: packet({ clean: false }) };

  assert.notEqual(digestOf(body), digestOf(swapped));
});

test("verification is pure and reports every problem, not just the first", () => {
  const first = { version: 1, sequence: 1, workspaceId: "w", head: null, treeDigest: null, decision: "approved", note: "", sealedAt: 1, packet: packet(), previousDigest: null };
  const second = { ...first, sequence: 5, note: "b", previousDigest: "wrong" };

  const records = [
    { ...first, digest: digestOf(first) },
    { ...second, digest: digestOf(second) },
  ];

  const result = verifyChain(records, digestOf);

  assert.equal(result.ok, false);
  // Wrong sequence and a broken link are two separate facts about line 2, and
  // reporting only the first would hide half of what happened.
  assert.equal(result.problems.filter((entry) => entry.line === 2).length, 2);
});

// --- export ----------------------------------------------------------------

test("an exported record carries the digest and states what the seal does not prove", async () => {
  const { root, log: decisions } = await log();
  try {
    const record = await decisions.seal(
      seal({ decision: "approved", note: "Reuse guard looks right." }),
    );
    const markdown = renderRecord(record);

    assert.match(markdown, /Approved/);
    assert.match(markdown, /Reuse guard looks right\./);
    assert.match(markdown, new RegExp(record.digest));
    assert.match(markdown, /Rotate refresh tokens on reuse\./);
    // An exported record travels away from every other piece of context, so the
    // limit of what it establishes travels with it.
    assert.match(markdown, /tamper-evident, not tamper-proof/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
