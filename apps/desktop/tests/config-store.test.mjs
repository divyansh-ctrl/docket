import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  const userDataPath = await mkdtemp(join(tmpdir(), "aos-config-test-"));
  const configPath = join(userDataPath, "aos-config.json");
  try {
    const store = new ConfigStore(userDataPath);
    await store.load();
    assert.deepEqual(store.read(), { selectedProvider: "codex", workspace: null });

    await store.updateController("claude");
    await store.updateWorkspace({
      id: "0123456789abcdef01234567",
      name: "project",
      path: "/private/tmp/project",
    });

    const serialized = await readFile(configPath, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
      "schemaVersion",
      "selectedProvider",
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
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
