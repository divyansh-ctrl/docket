import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { SecretStore, describeProtection } = jiti("../src/main/secret-store.ts");

// A stand-in for safeStorage. Reversible but not secret, which is the point:
// the suite is checking what the store *says* and *writes*, not the cipher.
const vault = (over = {}) => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
  decryptString: (buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
  ...over,
});

const withStore = async (run, v = vault(), platform = "darwin") => {
  const dir = await mkdtemp(join(tmpdir(), "docket-secrets-"));
  try {
    const store = new SecretStore(dir, v, platform);
    await store.load();
    await run(store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// --- what it says about itself ------------------------------------------

test("the Linux fallback is called what it is, not encryption", () => {
  // safeStorage reports encryption is available while deriving the key from a
  // password built into the binary. A key stored that way under a UI implying
  // safety is worse than no feature.
  const status = describeProtection(vault({ getSelectedStorageBackend: () => "basic_text" }), "linux");
  assert.equal(status.protection, "plain-text");
  assert.equal(status.backend, "basic_text");
  assert.match(status.detail, /no better than a plain text file/i);
  assert.doesNotMatch(status.detail, /\bencrypted by\b/i, "it must not claim the OS is holding this");
});

test("a real desktop keyring is reported as one", () => {
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    const status = describeProtection(vault({ getSelectedStorageBackend: () => backend }), "linux");
    assert.equal(status.protection, "os-keychain", backend);
    assert.match(status.detail, new RegExp(backend));
  }
});

test("a backend this version does not recognise is not vouched for", () => {
  // A name added in a later Electron is one whose guarantees are unknown, and
  // guessing in the safe direction would be guessing about a credential.
  const status = describeProtection(vault({ getSelectedStorageBackend: () => "some_new_thing" }), "linux");
  assert.equal(status.protection, "plain-text");
});

test("macOS and Windows do not consult a Linux-only call", () => {
  for (const platform of ["darwin", "win32"]) {
    const status = describeProtection(
      vault({
        getSelectedStorageBackend: () => {
          throw new Error("must not be called off Linux");
        },
      }),
      platform,
    );
    assert.equal(status.protection, "os-keychain", platform);
  }
});

test("no encryptor at all is reported, and storing is refused", async () => {
  const broken = vault({ isEncryptionAvailable: () => false });
  assert.equal(describeProtection(broken, "darwin").protection, "none");
  await withStore(
    async (store) => {
      assert.equal(store.status().protection, "none");
      await assert.rejects(() => store.put("openrouter", "sk-live-1"), /will not keep a key/);
      assert.deepEqual(store.descriptors(), []);
    },
    broken,
  );
});

// --- what it stores, and what it never hands back ------------------------

test("a stored value never appears in a descriptor", async () => {
  await withStore(async (store) => {
    const secret = "sk-or-v1-abcdef0123456789";
    await store.put("openrouter", secret);
    const [descriptor] = store.descriptors();
    const serialised = JSON.stringify(descriptor);
    assert.doesNotMatch(serialised, /abcdef0123456789/, "the value reached the renderer");
    assert.match(descriptor.masked, /^sk-o\*+ \(\d+ characters\)$/);
    assert.equal(descriptor.name, "openrouter");
  });
});

test("the plain value is never written to the file", async () => {
  await withStore(async (store, dir) => {
    await store.put("openrouter", "sk-or-v1-abcdef0123456789");
    const raw = await readFile(join(dir, "docket-secrets.json"), "utf8");
    assert.doesNotMatch(raw, /sk-or-v1-abcdef0123456789/);
  });
});

test("the file is not readable by anyone else", async () => {
  await withStore(async (store, dir) => {
    await store.put("openrouter", "sk-live-1");
    if (process.platform === "win32") return; // ACLs, not mode bits
    assert.equal((await stat(join(dir, "docket-secrets.json"))).mode & 0o777, 0o600);
  });
});

test("credentials are not kept in the configuration file", async () => {
  await withStore(async (store, dir) => {
    await store.put("openrouter", "sk-live-1");
    await assert.rejects(() => readFile(join(dir, "docket-config.json"), "utf8"), /ENOENT/);
  });
});

test("only the main process can reveal a value, and it round trips", async () => {
  await withStore(async (store) => {
    await store.put("openrouter", "sk-live-1");
    assert.equal(store.reveal("openrouter"), "sk-live-1");
    assert.equal(store.reveal("missing"), null);
  });
});

test("an empty credential is refused rather than stored as nothing", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.put("openrouter", "   "), /cannot be empty/);
  });
});

test("removing takes it out of the file, not just the list", async () => {
  await withStore(async (store, dir) => {
    await store.put("openrouter", "sk-live-1");
    await store.remove("openrouter");
    assert.deepEqual(store.descriptors(), []);
    assert.doesNotMatch(await readFile(join(dir, "docket-secrets.json"), "utf8"), /openrouter/);
  });
});

test("a key that no longer decrypts says so rather than showing a plausible mask", async () => {
  // The OS key was rotated, or the file came from another machine. Showing a
  // mask of nothing would read as a working key.
  const dir = await mkdtemp(join(tmpdir(), "docket-secrets-"));
  try {
    const store = new SecretStore(dir, vault(), "darwin");
    await store.load();
    await store.put("openrouter", "sk-live-1");

    const rotated = new SecretStore(
      dir,
      vault({
        decryptString: () => {
          throw new Error("key rotated");
        },
      }),
      "darwin",
    );
    await rotated.load();
    assert.equal(rotated.descriptors()[0].masked, "cannot be decrypted on this machine");
    assert.equal(rotated.reveal("openrouter"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable store opens empty rather than throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docket-secrets-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "docket-secrets.json"), "{not json", "utf8");
    const store = new SecretStore(dir, vault(), "darwin");
    await store.load();
    assert.deepEqual(store.descriptors(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no IPC handler can reach a credential value", async () => {
  // The guard that matters most, and the one a future change is most likely to
  // undo by accident: `reveal` is the only way to a plain value, and the IPC
  // layer must never call it. Asserted against the source because a type
  // cannot express "this function is not called from that file".
  const handlers = await readFile(new URL("../src/main/ipc-handlers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(handlers, /\breveal\s*\(/, "ipc-handlers.ts reaches a credential value");
  const preload = await readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(preload, /\breveal\b/, "the preload exposes a way to a credential value");
});

test("the renderer's view of the store carries no value-shaped field", () => {
  // Named fields, checked by name: a `value` or `secret` key appearing here
  // later would be the mistake this whole file exists to prevent.
  const store = new SecretStore("/nowhere", vault(), "darwin");
  const view = { ...store.status(), stored: store.descriptors() };
  assert.deepEqual(Object.keys(view).sort(), ["backend", "detail", "protection", "stored"]);
});
