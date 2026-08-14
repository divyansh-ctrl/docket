import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  assertProviderId,
  assertTerminalInput,
  assertTerminalSize,
  canonicalizeWorkspace,
} = jiti(fileURLToPath(new URL("../src/main/validation.ts", import.meta.url)));

test("provider and terminal boundary validation rejects malformed input", () => {
  assert.equal(assertProviderId("codex"), "codex");
  assert.throws(() => assertProviderId("shell"), /Unsupported provider/);
  assert.deepEqual(assertTerminalSize(120, 40), { cols: 120, rows: 40 });
  assert.throws(() => assertTerminalSize(1, 1), /outside allowed bounds/);
  assert.equal(assertTerminalInput("status\r"), "status\r");
  assert.throws(() => assertTerminalInput("x".repeat(70_000)), /too large/);
});

test("workspace authorization rejects broad roots and canonicalizes a project", async () => {
  await assert.rejects(() => canonicalizeWorkspace("/"), /root cannot be a workspace/);
  await assert.rejects(() => canonicalizeWorkspace(homedir()), /home cannot be a workspace/);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "docket-workspace-test-"));
  const workspacePath = join(temporaryRoot, "project");
  try {
    await mkdir(workspacePath);
    const workspace = await canonicalizeWorkspace(workspacePath);
    assert.equal(workspace.path, await realpath(workspacePath));
    assert.equal(workspace.name, "project");
    assert.match(workspace.id, /^[a-f0-9]{24}$/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
