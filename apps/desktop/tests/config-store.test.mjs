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
      intent: null,
      // Off by default. On is the stricter setting, and a default that refuses
      // to run any check on a machine with no container runtime would make the
      // app inert on first launch for nearly everyone.
      requireIsolation: false,
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
      // The stated intent is persisted so it survives a restart; it is the
      // user's own sentence about their own repository, never a credential.
      "intent",
      "requireIsolation",
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
      intent: null,
      requireIsolation: false,
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("the isolation requirement survives a restart and is never inferred", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.equal(store.read().requireIsolation, false);

    assert.equal((await store.updateRequireIsolation(true)).requireIsolation, true);

    const reloaded = new ConfigStore(userDataPath);
    await reloaded.load();
    assert.equal(reloaded.read().requireIsolation, true);

    // Only an explicit boolean true turns it on. A truthy leftover from a
    // hand-edited or half-written file must not silently switch a machine into
    // a mode where every check refuses to run with no visible reason.
    await writeFile(
      join(userDataPath, "docket-config.json"),
      JSON.stringify({ schemaVersion: 2, selectedProvider: "codex", requireIsolation: "yes" }),
    );
    const coerced = new ConfigStore(userDataPath);
    await coerced.load();
    assert.equal(coerced.read().requireIsolation, false);
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

test("intent is bound to its workspace and dropped when another is opened", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();

    const first = { id: "workspace-aaaaaaaa", name: "first", path: "/tmp/first" };
    await store.updateWorkspace(first);
    await store.updateIntent("  Rotate refresh tokens on reuse.  ", 1000);

    assert.equal(store.read().intent.text, "Rotate refresh tokens on reuse.", "trimmed and stored");
    assert.equal(store.read().intent.workspaceId, first.id);
    assert.equal(store.read().intent.recordedAt, 1000);

    // Opening a different repository must not carry the brief across. Showing
    // one repository's stated purpose beside another's diff attaches an intent
    // to a change that never had it.
    await store.updateWorkspace({ id: "workspace-bbbbbbbb", name: "second", path: "/tmp/second" });
    assert.equal(store.read().intent, null);

    // It survives a restart for the workspace it belongs to.
    await store.updateWorkspace(first);
    await store.updateIntent("Back on the first repository.", 2000);
    const reloaded = new ConfigStore(userDataPath);
    await reloaded.load();
    assert.equal(reloaded.read().intent.text, "Back on the first repository.");

    // Empty text clears rather than recording a blank brief.
    await reloaded.updateIntent("   ", 3000);
    assert.equal(reloaded.read().intent, null);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("recording an intent with no repository open is refused", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();
    await assert.rejects(() => store.updateIntent("orphan", 1), /No repository is open/);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
