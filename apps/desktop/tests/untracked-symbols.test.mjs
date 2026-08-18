import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const run = promisify(execFile);
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { surveyChanges } = jiti("../src/main/workspace-diff.ts");

// Symbols were read from `git diff HEAD`, which sees tracked files only. So a
// change that added a whole new module contributed nothing to blast radius or
// to the intent comparison, and the packet said nothing about the hole. These
// hold the fix and, just as much, hold the reporting of what it still misses.

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "docket-symbols-"));
  await run("git", ["init", "-q", "."], { cwd: root });
  await run("git", ["config", "user.email", "t@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

async function commit(root) {
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-qm", "base"], { cwd: root });
}

test("a brand-new module's exports are found", async () => {
  const root = await repo();
  try {
    await writeFile(join(root, "seed.txt"), "seed\n");
    await commit(root);
    await writeFile(
      join(root, "fresh.ts"),
      "export function readTokenUsage() {}\nexport const CAMERA = 1;\nexport class Runner {}\n",
    );

    const diff = await surveyChanges(root);
    assert.ok(diff.symbols.includes("readTokenUsage"), "an added module declares things");
    assert.ok(diff.symbols.includes("CAMERA"));
    assert.ok(diff.symbols.includes("Runner"));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("tracked edits and new files are both counted, without duplicates", async () => {
  const root = await repo();
  try {
    await writeFile(join(root, "old.ts"), "export function kept() {}\n");
    await commit(root);
    await writeFile(join(root, "old.ts"), "export function kept() {}\nexport function grown() {}\n");
    await writeFile(join(root, "new.ts"), "export function grown() {}\nexport function fresh() {}\n");

    const diff = await surveyChanges(root);
    assert.ok(diff.symbols.includes("grown"));
    assert.ok(diff.symbols.includes("fresh"));
    assert.equal(
      diff.symbols.filter((name) => name === "grown").length,
      1,
      "a name declared in both places is one symbol, not two",
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a repository with no commits still reports what its files declare", async () => {
  // Everything is untracked here, so the old code returned nothing at all --
  // the emptiest possible answer for the fullest possible change.
  const root = await repo();
  try {
    await writeFile(join(root, "first.ts"), "export function firstThing() {}\n");
    const diff = await surveyChanges(root);
    assert.ok(diff.symbols.includes("firstThing"));
    assert.match(diff.unavailable, /no commits yet/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a binary file is passed over without being called unreadable", async () => {
  const root = await repo();
  try {
    await writeFile(join(root, "seed.txt"), "seed\n");
    await commit(root);
    await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 3, 4]));
    await writeFile(join(root, "code.ts"), "export function stillFound() {}\n");

    const diff = await surveyChanges(root);
    assert.ok(diff.symbols.includes("stillFound"));
    assert.equal(diff.symbolsUnread, 0, "a binary file declares nothing; that is not a failed read");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("an ignored directory is never opened", async () => {
  const root = await repo();
  try {
    await writeFile(join(root, ".gitignore"), "vendor/\n");
    await commit(root);
    await mkdir(join(root, "vendor"), { recursive: true });
    await writeFile(join(root, "vendor", "huge.ts"), "export function vendored() {}\n");
    await writeFile(join(root, "mine.ts"), "export function mine() {}\n");

    const diff = await surveyChanges(root);
    assert.ok(diff.symbols.includes("mine"));
    assert.ok(!diff.symbols.includes("vendored"), "ignored files are not part of the change");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("the cap is reported rather than silently applied", async () => {
  const root = await repo();
  try {
    await writeFile(join(root, "seed.txt"), "seed\n");
    await commit(root);
    const many = Array.from({ length: 90 }, (_, index) => `export function fn${index}() {}`).join("\n");
    await writeFile(join(root, "many.ts"), `${many}\n`);

    const diff = await surveyChanges(root);
    assert.equal(diff.symbols.length, 60, "the cap still applies");
    assert.equal(diff.symbolsTruncated, true, "and the packet is told the list is partial");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a file that will not open is counted, not swallowed", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("file permissions do not deny reads here");
    return;
  }
  const root = await repo();
  try {
    await writeFile(join(root, "seed.txt"), "seed\n");
    await commit(root);
    await writeFile(join(root, "locked.ts"), "export function hidden() {}\n");
    await chmod(join(root, "locked.ts"), 0o000);

    const diff = await surveyChanges(root);
    assert.equal(diff.symbolsUnread, 1);
    assert.ok(!diff.symbols.includes("hidden"));
  } finally {
    await chmod(join(root, "locked.ts"), 0o644).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
