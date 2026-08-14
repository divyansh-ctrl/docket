import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  assertCheckId,
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

test("check ids accept the structured form and reject anything else", () => {
  // Regression: these were first sent through assertOpaqueId, whose pattern is
  // /^[a-z0-9-]{8,128}$/i. It has no colon, so every real check id was rejected
  // and the feature could not run at all while the build stayed green.
  assert.equal(assertCheckId("npm:test"), "npm:test");
  assert.equal(assertCheckId("npm:test:unit"), "npm:test:unit");
  assert.equal(assertCheckId("npm:type-check"), "npm:type-check");
  assert.equal(assertCheckId("npm:a"), "npm:a");

  assert.throws(() => assertCheckId("test"), /Invalid check id/);
  assert.throws(() => assertCheckId("yarn:test"), /Invalid check id/);
  assert.throws(() => assertCheckId("npm:"), /Invalid check id/);
  assert.throws(() => assertCheckId("npm:-leading"), /Invalid check id/);
  assert.throws(() => assertCheckId("npm:rm -rf /"), /Invalid check id/);
  assert.throws(() => assertCheckId("npm:a;b"), /Invalid check id/);
  assert.throws(() => assertCheckId(`npm:${"x".repeat(200)}`), /Invalid check id/);
  assert.throws(() => assertCheckId(42), /Invalid check id/);
});
