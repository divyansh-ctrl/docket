import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { surveyChanges } = jiti("../src/main/workspace-diff.ts");
const { findBlastRadius } = jiti("../src/main/blast-radius.ts");
const { assemblePacket, verdict } = jiti("../src/shared/evidence.ts");

const execFileAsync = promisify(execFile);

async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), "docket-evidence-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), body);
  }
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "t@t.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

function check(id, kind = "test") {
  return { id, kind, label: `npm run ${kind}`, runner: "npm", script: kind, manifestPath: "package.json", declaration: "x" };
}

function result(checkId, outcome, exitCode = 0) {
  return { checkId, outcome, exitCode, output: "", outputTruncated: false, durationMs: 5, argv: ["npm", "run", "test"], error: null };
}

// --- what changed ----------------------------------------------------------

test("reports real files, counts, and untracked additions", async () => {
  const root = await repo({ "src/a.js": "export function alpha() { return 1; }\n" });
  try {
    await writeFile(join(root, "src/a.js"), "export function alpha() { return 2; }\n");
    await writeFile(join(root, "src/new.js"), "export const beta = 1;\n");

    const diff = await surveyChanges(root);

    assert.equal(diff.unavailable, null);
    const modified = diff.files.find((file) => file.path === "src/a.js");
    assert.equal(modified.status, "modified");
    assert.equal(modified.added, 1);
    assert.equal(modified.removed, 1);
    // An unstaged new file is still part of the change, and is what a plain
    // diff-against-HEAD misses entirely.
    const untracked = diff.files.find((file) => file.path === "src/new.js");
    assert.equal(untracked.status, "untracked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extracts declaration names from the changed lines", async () => {
  const root = await repo({ "src/a.ts": "export function keep() {}\n" });
  try {
    await writeFile(join(root, "src/a.ts"), "export function keep() {}\nexport function added() {}\n");

    const diff = await surveyChanges(root);

    assert.ok(diff.symbols.includes("added"), `expected "added" in ${JSON.stringify(diff.symbols)}`);
    // -U0 keeps context out, so an untouched neighbour is not called changed.
    assert.ok(!diff.symbols.includes("keep"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a repository with no commits says so instead of reporting no changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "docket-evidence-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "a.js"), "x");

    const diff = await surveyChanges(root);

    assert.match(diff.unavailable, /no commits/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a directory that is not a repository is reported, not treated as clean", async () => {
  const root = await mkdtemp(join(tmpdir(), "docket-evidence-"));
  try {
    const diff = await surveyChanges(root);
    assert.match(diff.unavailable, /not a Git repository/);
    assert.deepEqual(diff.files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- who else depends on it ------------------------------------------------

test("finds references outside the change and excludes the change itself", async () => {
  const root = await repo({
    "src/helper.js": "export function shared() {}\n",
    "src/one.js": "import { shared } from './helper';\nshared();\n",
    "src/two.js": "import { shared } from './helper';\nshared();\n",
    "src/other.js": "export function unrelated() {}\n",
  });
  try {
    const radius = await findBlastRadius(root, ["shared"], ["src/helper.js"]);

    assert.equal(radius.unavailable, null);
    assert.equal(radius.references.length, 1);
    assert.deepEqual([...radius.references[0].files].sort(), ["src/one.js", "src/two.js"]);
    // The changed file is the change, not its blast radius.
    assert.ok(!radius.references[0].files.includes("src/helper.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symbol used nowhere else is reported as contained", async () => {
  const root = await repo({ "src/a.js": "function onlyHere() {}\n" });
  try {
    const radius = await findBlastRadius(root, ["onlyHere"], ["src/a.js"]);

    assert.deepEqual(radius.references, []);
    assert.deepEqual(radius.contained, ["onlyHere"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("whole-word matching keeps a prefix from counting as a reference", async () => {
  const root = await repo({
    "src/a.js": "function run() {}\n",
    "src/b.js": "runCheck(); runAll();\n",
  });
  try {
    const radius = await findBlastRadius(root, ["run"], ["src/a.js"]);
    assert.deepEqual(radius.contained, ["run"], "runCheck must not count as a reference to run");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- the packet ------------------------------------------------------------

const noChange = { files: 1, added: 1, removed: 0, truncated: false, unavailable: null };
const noReach = { references: [], contained: [], unavailable: null };

test("a weakened check outranks a failing one", () => {
  // A red result is information. A quietly weakened suite is the absence of it,
  // which is why it has to sort above.
  const packet = assemblePacket({
    intent: "",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [
      { check: check("npm:lint", "lint"), result: result("npm:lint", "failed", 1), drift: null },
      {
        check: check("npm:test"),
        result: result("npm:test", "passed"),
        drift: { checkId: "npm:test", reason: "changed", committed: "vitest run", working: "true" },
      },
    ],
  });

  assert.equal(packet.findings[0].id, "drift:npm:test");
  assert.equal(packet.findings[0].severity, "blocking");
  assert.equal(packet.clean, false);
  assert.match(verdict(packet), /stop a merge/);
});

test("a check that timed out is neither a pass nor a failure", () => {
  const packet = assemblePacket({
    intent: "",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [{ check: check("npm:test"), result: result("npm:test", "timed-out", null), drift: null }],
  });

  const finding = packet.findings.find((entry) => entry.id === "unproven:npm:test");
  assert.equal(finding.severity, "attention");
  assert.match(finding.detail, /absence of evidence/);
  assert.equal(packet.clean, false);
});

test("an unrun check is called out rather than passing silently", () => {
  const packet = assemblePacket({
    intent: "",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [{ check: check("npm:test"), result: null, drift: null }],
  });

  assert.equal(packet.findings[0].id, "unrun:npm:test");
  assert.equal(packet.clean, false);
});

test("clean requires every check to have run and passed with no unknowns", () => {
  const base = {
    // Stated, because an unstated intent is itself a reason not to read clean.
    intent: "Rotate refresh tokens on reuse.",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [{ check: check("npm:test"), result: result("npm:test", "passed"), drift: null }],
  };

  assert.equal(assemblePacket(base).clean, true);
  assert.match(verdict(assemblePacket(base)), /ran and passed/);

  // Unknown drift must not read as clean: it is an unverified pass.
  assert.equal(assemblePacket({ ...base, committedUnavailable: true }).clean, false);

  // Neither may an unreadable diff.
  assert.equal(
    assemblePacket({ ...base, change: { ...noChange, unavailable: "no git" } }).clean,
    false,
  );
});

test("no declared checks is a finding, not a clean packet", () => {
  const packet = assemblePacket({
    intent: "",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [],
  });

  assert.equal(packet.findings[0].id, "no-checks");
  assert.equal(packet.clean, false);
});

test("wide reach is a note, never blocking", () => {
  const packet = assemblePacket({
    intent: "Rename the shared helper.",
    change: noChange,
    committedUnavailable: false,
    reach: {
      references: [{ symbol: "shared", files: ["a.js", "b.js", "c.js", "d.js"], truncated: false }],
      contained: [],
      unavailable: null,
    },
    checks: [{ check: check("npm:test"), result: result("npm:test", "passed"), drift: null }],
  });

  const reach = packet.findings.find((entry) => entry.id === "reach:shared");
  // Marking breadth as blocking trains the reader to ignore the level that means stop.
  assert.equal(reach.severity, "note");
  // Breadth does not make a passing packet unclean...
  assert.equal(packet.clean, true);
  // ...but the summary must not read as "nothing to see" while a note sits
  // unread below it. A reviewer who stops at the verdict would otherwise never
  // learn the change touches something referenced across four files.
  assert.match(verdict(packet), /passed\. One note to read first\./);
});

test("a change with no stated intent is called out", () => {
  const packet = assemblePacket({
    intent: "",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [{ check: check("npm:test"), result: result("npm:test", "passed"), drift: null }],
  });

  const finding = packet.findings.find((entry) => entry.id === "no-intent");
  assert.equal(finding.severity, "attention");
  // Green, well-tested, and the wrong change is a real outcome. A packet must
  // not read as clean when nobody said what the change was supposed to do.
  assert.equal(packet.clean, false);
});

test("a stated intent is carried and lets a passing packet read clean", () => {
  const packet = assemblePacket({
    intent: "  Rotate refresh tokens on reuse.  ",
    change: noChange,
    committedUnavailable: false,
    reach: noReach,
    checks: [{ check: check("npm:test"), result: result("npm:test", "passed"), drift: null }],
  });

  assert.equal(packet.intent, "  Rotate refresh tokens on reuse.  ");
  assert.equal(packet.findings.find((entry) => entry.id === "no-intent"), undefined);
  assert.equal(packet.clean, true);
});

test("no intent is not demanded when nothing changed", () => {
  // An unchanged tree has nothing to explain, and nagging for a brief there
  // would train the reader to dismiss the finding when it matters.
  const packet = assemblePacket({
    intent: "",
    change: { files: 0, added: 0, removed: 0, truncated: false, unavailable: null },
    committedUnavailable: false,
    reach: noReach,
    checks: [{ check: check("npm:test"), result: result("npm:test", "passed"), drift: null }],
  });

  assert.equal(packet.findings.find((entry) => entry.id === "no-intent"), undefined);
});
