import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { anthropic } = jiti("../src/shared/agent-model.ts");
const { scanSecrets } = jiti("../src/shared/secrets.ts");
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
      mcpServers: [],
    });

    await store.updateController("claude");
    await store.updateWorkspace({
      id: "0123456789abcdef01234567",
      name: "project",
      path: "/private/tmp/project",
    });
    await store.updateAgentModel("review", anthropic("opus"));
    await store.completeSetup();

    const serialized = await readFile(configPath, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
      "agentModels",
      // The stated intent is persisted so it survives a restart; it is the
      // user's own sentence about their own repository, never a credential.
      "intent",
      "mcpServers",
      "requireIsolation",
      "schemaVersion",
      "selectedProvider",
      "setupComplete",
      "workspace",
    ]);
    // No credential is ever at rest in this file. This used to be a match
    // against the whole text, which caught the *word* rather than the thing --
    // and started failing the moment a field was honestly named `credential`
    // while holding null. Scanning the values with the gate's own rules is
    // both stricter about what matters and blind to what does not.
    const values = [];
    (function walk(node) {
      if (typeof node === "string") values.push(node);
      else if (node && typeof node === "object") Object.values(node).forEach(walk);
    })(JSON.parse(serialized));
    const found = scanSecrets(values.map((text, line) => ({ path: "docket-config.json", line, text })));
    assert.deepEqual(found.matches, [], "a credential-shaped value reached the configuration file");
    // Windows does not implement POSIX permission bits: the mode passed to
    // writeFile is ignored and the file reports 0o666. Access there is
    // governed by the user profile's ACL instead.
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    }

    const reloaded = new ConfigStore(userDataPath);
    await reloaded.load();
    assert.deepEqual(reloaded.read(), {
      mcpServers: [],
      selectedProvider: "claude",
      workspace: {
        id: "0123456789abcdef01234567",
        name: "project",
        path: "/private/tmp/project",
      },
      agentModels: { review: anthropic("opus") },
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
    assert.deepEqual(store.read().agentModels, { review: anthropic("opus") });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("a rejected agent or model never reaches disk", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-test-"));
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();
    await assert.rejects(() => store.updateAgentModel("review", "gpt-9"), /needs both a service and a name/);
    await assert.rejects(() => store.updateAgentModel("nobody", anthropic("opus")), /Unknown agent/);
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


test("a configuration written before MCP servers existed still loads", async () => {
  // Schema 2 has no mcpServers key at all. An older config must open with an
  // empty set rather than refusing, or an upgrade loses the workspace too.
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-v2-"));
  try {
    await writeFile(
      join(userDataPath, "docket-config.json"),
      JSON.stringify({ schemaVersion: 2, selectedProvider: "claude", setupComplete: true }),
      "utf8",
    );
    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.deepEqual(store.read().mcpServers, []);
    assert.equal(store.read().selectedProvider, "claude");
    assert.equal(store.read().setupComplete, true);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("a stored server that does not survive validation is dropped, not carried", async () => {
  // Same reasoning as the agent models above: a half-understood server would
  // be written into a real .mcp.json and discovered when an agent could not
  // start.
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-mcp-"));
  try {
    await writeFile(
      join(userDataPath, "docket-config.json"),
      JSON.stringify({
        schemaVersion: 3,
        mcpServers: [
          { id: "good", transport: "stdio", command: "echo" },
          { id: "no-transport", command: "echo" },
          { transport: "stdio", command: "echo" },
          { id: "bad-transport", transport: "carrier-pigeon" },
          { id: "good", transport: "http", url: "https://e.com" },
          "not an object",
        ],
      }),
      "utf8",
    );
    const store = new ConfigStore(userDataPath);
    await store.load();
    const servers = store.read().mcpServers;
    assert.deepEqual(
      servers.map((server) => server.id),
      ["good"],
      "only the well-formed server survives, and the duplicate id does not overwrite it",
    );
    assert.equal(servers[0].command, "echo");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});


test("a model stored as the single word it used to be still loads", async () => {
  // Schema 2 and 3 held a bare alias. Every value they could hold was an
  // Anthropic one, so migrating is not a guess -- and refusing would take the
  // rest of the configuration down with it.
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-model-"));
  try {
    await writeFile(
      join(userDataPath, "docket-config.json"),
      JSON.stringify({
        schemaVersion: 3,
        agentModels: { review: "opus", docs: "inherit", engineer: "gpt-9", nobody: "sonnet" },
      }),
      "utf8",
    );
    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.deepEqual(store.read().agentModels, {
      review: { provider: "anthropic", model: "opus", credential: null },
      docs: { provider: "inherit", model: "", credential: null },
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("a model that names a service but nothing to run is dropped", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "docket-config-model2-"));
  try {
    await writeFile(
      join(userDataPath, "docket-config.json"),
      JSON.stringify({
        schemaVersion: 4,
        agentModels: {
          review: { provider: "openrouter", model: "z-ai/glm-5.2:free", credential: "openrouter" },
          docs: { provider: "openrouter", model: "   " },
          tests: { provider: "carrier-pigeon", model: "x" },
        },
      }),
      "utf8",
    );
    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.deepEqual(Object.keys(store.read().agentModels), ["review"]);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
