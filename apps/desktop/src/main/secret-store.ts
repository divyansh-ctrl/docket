/**
 * Credentials at rest, and an honest account of how well they are held.
 *
 * Docket has never asked for a key: it drives CLIs a person has already signed
 * in to. Reaching an open model changes that, because a gateway wants a
 * credential and there is no CLI sign-in to borrow.
 *
 * The storage is `safeStorage`, which is the right primitive. The part that
 * needs care is what gets said about it.
 *
 * **`isEncryptionAvailable()` returning true does not mean the key is safe.**
 * On Linux it returns true whenever a symmetric key could be obtained, and
 * `getSelectedStorageBackend()` reports `basic_text` when no kwallet or
 * gnome-libsecret is present -- Chromium then derives the key from a password
 * built into the binary. Anyone who can read the file can read the key. That is
 * not a bug to hide behind an "encrypted" label; it is a fact to print, in the
 * same way the packet prints a check that did not run.
 *
 * A key stored in effective plaintext under a UI implying safety is worse than
 * no feature, because it moves a person from "I know where my key is" to "the
 * app is looking after it".
 *
 * Three rules hold everywhere below: a value is never logged, never returned
 * over IPC, and never written into a file another program reads.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mask } from "../shared/secrets";

/**
 * The part of Electron's `safeStorage` this needs, named as a port so the
 * suite can drive the paths a real machine will not reach -- an unavailable
 * encryptor, and the Linux fallback, are both untestable otherwise.
 */
export type Vault = Readonly<{
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only. Absent on macOS and Windows, which is not a failure. */
  getSelectedStorageBackend?: () => string;
}>;

export type Protection = "os-keychain" | "plain-text" | "none";

export type SecretStoreStatus = Readonly<{
  protection: Protection;
  /** The platform's own name for the backend, where it has one. */
  backend: string | null;
  /** Shown to a person. Never reassuring where it should not be. */
  detail: string;
}>;

/** What the renderer is allowed to know: enough to recognise, never to use. */
export type SecretDescriptor = Readonly<{
  name: string;
  masked: string;
  storedAt: number;
}>;

/**
 * Linux backends that mean a real OS password manager is holding the key.
 * Anything else -- `basic_text`, `unknown`, or a name added in a later
 * Electron -- is treated as unprotected, because a backend this does not
 * recognise is one whose guarantees it cannot vouch for.
 */
const REAL_KEYRINGS = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);

export function describeProtection(vault: Vault, platform: NodeJS.Platform): SecretStoreStatus {
  if (!vault.isEncryptionAvailable()) {
    return Object.freeze({
      protection: "none",
      backend: null,
      detail:
        "This machine offers no encrypted store, so Docket will not keep a key. " +
        "Put it in an environment variable and Docket will use it without storing it.",
    });
  }

  if (platform !== "linux" || vault.getSelectedStorageBackend === undefined) {
    return Object.freeze({
      protection: "os-keychain",
      backend: platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : null,
      detail: "Keys are encrypted by the operating system's own credential store.",
    });
  }

  const backend = vault.getSelectedStorageBackend();
  if (REAL_KEYRINGS.has(backend)) {
    return Object.freeze({
      protection: "os-keychain",
      backend,
      detail: `Keys are encrypted by ${backend}, this desktop's own credential store.`,
    });
  }

  return Object.freeze({
    protection: "plain-text",
    backend,
    detail:
      `No desktop keyring was found, so ${backend === "unknown" ? "the encryption backend is not yet known" : `the backend is ${backend}`}` +
      " and the key is derived from a password built into the application. Anyone who can read " +
      "the file can read the key, which is no better than a plain text file. Install a keyring " +
      "(gnome-keyring or kwallet), or use an environment variable instead.",
  });
}

type StoredSecret = { cipher: string; storedAt: number };
type StoredFile = { version: 1; secrets: Record<string, StoredSecret> };

/**
 * Keys live in their own file, not in `docket-config.json`.
 *
 * A configuration read happens constantly and is dumped into logs and issue
 * reports without much thought. Ciphertext that never sits in that file cannot
 * be pasted out of it by accident.
 */
export class SecretStore {
  readonly #filePath: string;
  readonly #vault: Vault;
  readonly #platform: NodeJS.Platform;
  #secrets: Record<string, StoredSecret> = {};

  constructor(userDataPath: string, vault: Vault, platform: NodeJS.Platform = process.platform) {
    this.#filePath = join(userDataPath, "docket-secrets.json");
    this.#vault = vault;
    this.#platform = platform;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8")) as Partial<StoredFile>;
      const secrets = parsed.secrets;
      this.#secrets = {};
      if (typeof secrets === "object" && secrets !== null && !Array.isArray(secrets)) {
        for (const [name, entry] of Object.entries(secrets as Record<string, unknown>)) {
          const record = entry as Partial<StoredSecret>;
          if (typeof record?.cipher !== "string" || record.cipher.length === 0) continue;
          this.#secrets[name] = {
            cipher: record.cipher,
            storedAt: typeof record.storedAt === "number" ? record.storedAt : 0,
          };
        }
      }
    } catch (error) {
      // An unreadable secrets file is not repaired and not reported with its
      // contents: whatever is in there, none of it belongs in a log line.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Ignoring unreadable Docket credential store");
      }
      this.#secrets = {};
    }
  }

  status(): SecretStoreStatus {
    return describeProtection(this.#vault, this.#platform);
  }

  /** Masked descriptors only. There is no method here that returns a value. */
  descriptors(): readonly SecretDescriptor[] {
    return Object.freeze(
      Object.keys(this.#secrets)
        .sort()
        .map((name) => this.#describe(name)),
    );
  }

  has(name: string): boolean {
    return name in this.#secrets;
  }

  /**
   * Store a credential.
   *
   * Refuses when there is no encryptor at all rather than falling back to
   * writing the value down. It does *not* refuse the Linux plaintext backend --
   * that is a choice for the person to make once they have been told, and
   * refusing outright would leave a whole desktop unable to use the feature.
   * `status()` is what tells them, and the caller must show it.
   */
  async put(name: string, value: string, now: number = Date.now()): Promise<SecretDescriptor> {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error("A credential cannot be empty");
    if (!this.#vault.isEncryptionAvailable()) {
      throw new Error("This machine offers no encrypted store, so Docket will not keep a key");
    }

    this.#secrets[name] = {
      cipher: this.#vault.encryptString(trimmed).toString("base64"),
      storedAt: now,
    };
    await this.#save();
    return this.#describe(name);
  }

  async remove(name: string): Promise<void> {
    if (!(name in this.#secrets)) return;
    delete this.#secrets[name];
    await this.#save();
  }

  /**
   * The value, for the main process only.
   *
   * Never reachable over IPC. The one legitimate caller is the code that
   * injects it into a child process environment at spawn, which is why this
   * returns the string rather than something safer -- there is no safer shape
   * that a CLI can be handed.
   */
  reveal(name: string): string | null {
    const entry = this.#secrets[name];
    if (!entry) return null;
    try {
      return this.#vault.decryptString(Buffer.from(entry.cipher, "base64"));
    } catch {
      // A key encrypted under a since-rotated OS key cannot be recovered, and
      // saying which key failed is more useful than the error text.
      return null;
    }
  }

  #describe(name: string): SecretDescriptor {
    const entry = this.#secrets[name];
    const value = this.reveal(name);
    return Object.freeze({
      name,
      // Masked from the real value so the length is true. A key that no longer
      // decrypts says so rather than showing a plausible mask.
      masked: value === null ? "cannot be decrypted on this machine" : mask(value),
      storedAt: entry?.storedAt ?? 0,
    });
  }

  async #save(): Promise<void> {
    const file: StoredFile = { version: 1, secrets: this.#secrets };
    await mkdir(dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#filePath);
  }
}
