# Credentials at rest, and how honestly they are held

Docket has never asked for a key: it drives CLIs a person has already signed in
to. Reaching an open model changes that, because a gateway wants a credential
and there is no CLI sign-in to borrow.

The storage is Electron's `safeStorage`, which is the right primitive. The part
that needed care is what gets said about it.

## `isEncryptionAvailable()` does not mean the key is safe

On Linux it returns `true` whenever a symmetric key could be obtained. When no
desktop keyring is present, `getSelectedStorageBackend()` reports `basic_text`
and Chromium derives the key from **a password built into the binary**. Anyone
who can read the file can read the key.

That is not a bug to hide behind an "encrypted" label. A key stored in effective
plaintext under a UI implying safety is worse than no feature, because it moves
a person from "I know where my key is" to "the app is looking after it".

So the store reports one of three states, and the wording follows:

| `protection` | When | What is said |
|---|---|---|
| `os-keychain` | macOS, Windows, or Linux with `gnome_libsecret` / `kwallet*` | Encrypted by the operating system's own credential store. |
| `plain-text` | Linux with `basic_text`, `unknown`, or a backend this version does not recognise | Named as no better than a plain text file, with the fix — install a keyring, or use an environment variable. |
| `none` | No encryptor at all | Docket refuses to store anything. |

**An unrecognised backend counts as unprotected.** A name added in a later
Electron is one whose guarantees this code cannot vouch for, and guessing in the
reassuring direction would be guessing about a credential.

Docket does **not** refuse the Linux plaintext backend. That is a choice for the
person to make once they have been told, and refusing outright would leave a
whole desktop unable to use the feature. `status()` is what tells them, and the
caller has to show it.

## Three rules

- **A value is never logged.** An unreadable store is reported without its
  contents, because whatever is in there, none of it belongs in a log line.
- **A value never crosses IPC.** The renderer receives protection, backend, and
  masked descriptors. There is no channel that returns a value, and a test
  asserts `reveal()` appears in neither `ipc-handlers.ts` nor the preload —
  checked against the source, because a type cannot express "not called from
  there".
- **A value is never written into a file another program reads.** Keys live in
  `docket-secrets.json`, mode `0600`, separate from `docket-config.json` —
  configuration gets read constantly and pasted into issue reports, and
  ciphertext that is never in that file cannot leave in one.

## A key that no longer decrypts says so

The OS key may be rotated, or the file may have come from another machine.
Showing a mask of nothing would read as a working key, so the descriptor says
`cannot be decrypted on this machine` instead. The length in a mask is taken
from the real value, so it is true or it is absent.

## Not done here

No UI. The keys tab is the next step; this is the store it will sit on. The
browser preview reports `none` and says nothing typed there is kept, rather than
showing a reassuring status it cannot back up.
