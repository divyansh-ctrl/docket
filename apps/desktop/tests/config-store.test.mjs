import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { ConfigStore } = jiti(
  fileURLToPath(new URL("../src/main/config-store.ts", import.meta.url)),
);

test("desktop config persists only controller and canonical workspace metadata", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  const configPath = join(userDataPath, "docket-config.json");
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.deepEqual(store.read(), {
      selectedProvider: "codex",
      workspace: null,
      agentModels: {},
      setupComplete: false,
    });

    await store.updateController("claude");
    await store.updateWorkspace({
      id: "0123456789abcdef01234567",
      name: "project",
      path: "/private/tmp/project",
    });
    await store.updateAgentModel("review", "opus");
    await store.completeSetup();

    const serialized = await readFile(configPath, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
      "agentModels",
      "schemaVersion",
      "selectedProvider",
      "setupComplete",
      "workspace",
    ]);
    assert.doesNotMatch(serialized, /api[_-]?key|credential|password|secret|token/i);
    // Windows does not implement POSIX permission bits: the mode passed to
    // writeFile is ignored and the file reports 0o666. Access there is
    // governed by the user profile's ACL instead.
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    }

    const reloaded = new ConfigStore(userDataPath);
    await reloaded.load();
    assert.deepEqual(reloaded.read(), {
      selectedProvider: "claude",
      workspace: {
        id: "0123456789abcdef01234567",
        name: "project",
        path: "/private/tmp/project",
      },
      agentModels: { review: "opus" },
      setupComplete: true,
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("an agent model that no longer exists is dropped rather than loaded", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  try {
    // A stale override would otherwise be written into a real subagent file,
    // where an invalid model only surfaces when the agent fails to spawn.
    await writeFile(
      join(userDataPath, "docket-config.json"),
      JSON.stringify({
        schemaVersion: 2,
        selectedProvider: "codex",
        workspace: null,
        agentModels: { review: "opus", engineer: "gpt-9", nobody: "sonnet" },
        setupComplete: true,
      }),
    );

    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.deepEqual(store.read().agentModels, { review: "opus" });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("a rejected agent or model never reaches disk", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();
    await assert.rejects(() => store.updateAgentModel("review", "gpt-9"), /Unknown model/);
    await assert.rejects(() => store.updateAgentModel("nobody", "opus"), /Unknown agent/);
    assert.deepEqual(store.read().agentModels, {});
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
