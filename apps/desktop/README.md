# AOS Desktop

AOS Desktop is the downloadable local workbench for choosing Codex or Claude
Code as a workspace controller, authenticating the installed CLI in a
purpose-bound terminal, and inspecting mission evidence in Ledger or Workshop
views.

## What is real in the desktop build

- Provider detection and version checks use the locally installed `codex` and
  `claude` executables.
- Authentication runs inside a restricted PTY owned by the main process.
- Workspace authorization uses the operating system folder picker.
- The selected base controller and workspace are stored as non-secret local
  preferences.
- The workbench can deliberately start one fresh Codex or Claude controller
  session for the authorized workspace and show its interactive output in the
  in-app terminal. It never scans for, attaches to, resumes, or restarts an
  existing conversation.
- The browser-only renderer fallback is simulated and persistently labelled;
  it does not inspect CLIs, create credentials, or execute a provider.

The mission, worker, cost, and receipt examples remain labelled preview data in
this MVP. The Adaptive Model Router remains a separate delegation layer: it can
select bounded worker models but does not silently replace the selected Codex
or Claude controller.

## Requirements

- macOS 13 or later (Apple silicon or Intel), Windows 10 1809 or later, or a
  glibc-based Linux with GTK 3 (Ubuntu 20.04+, Debian 11+, Fedora 38+)
- Node.js 22.13 or later for source development
- Codex CLI and/or Claude Code installed separately

On Linux, `node-pty` publishes no prebuilt binary, so `npm ci` compiles it and
needs `python3`, `make`, and a C++ compiler:

```sh
sudo apt-get install -y python3 make g++      # Debian/Ubuntu
sudo dnf install -y python3 make gcc-c++      # Fedora/RHEL
```

Codex uses its normal provider-owned browser flow. For Claude in a distributed
third-party product, use Claude Console or another Anthropic-approved
commercial connection. The local subscription login option is labelled preview
only and is not a distributable subscription entitlement.

## Develop

```sh
npm ci
npm start
```

The desktop dev server is owned by Electron Forge and does not use the existing
dashboard server on port 3000.

## Verify

```sh
npm run validate
npm audit --omit=dev
npm run package
```

## Build the installers

`npm run make` builds for the current platform. The per-platform scripts are:

| Command | Produces |
| --- | --- |
| `npm run make:mac` | `.zip` and `.dmg` for `arm64` and `x64` |
| `npm run make:win` | `Docket-<version>-Setup.exe` (Squirrel) and `.zip` for `x64` |
| `npm run make:linux` | `.deb`, `.rpm`, and `.zip` for `x64` |

Output lands under `out/make/`.

**Each target must be built on its own operating system.** This is not a
configuration gap: `node-pty` has no Linux prebuild and must be compiled by a
Linux toolchain, and Squirrel needs a Windows host to produce `Setup.exe`.
[`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml)
runs all four targets on their matching runners and uploads the artifacts with
checksums.

`make:linux` additionally requires `fakeroot` and `dpkg` for the `.deb` and
`rpmbuild` for the `.rpm`.

Regenerate the application icons from `assets/icon.svg` with `npm run icons`
(macOS only; the generated `.icns`, `.ico`, and `.png` are committed).

## Signing status

Every current artifact is **unsigned**, so each platform warns on first launch:

- **macOS** — Gatekeeper blocks it. Set `AOS_SIGN_MAC_APP=1` with a Developer
  ID Application identity to sign, and `AOS_NOTARIZE_MAC_APP=1` plus
  `APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID` to notarize.
- **Windows** — SmartScreen shows an unrecognised-publisher warning until the
  installer is signed with an EV or OV code-signing certificate.
- **Linux** — the `.deb` and `.rpm` are unsigned; no repository is published.

Signing and notarization are release gates, not solved problems. Do not
describe these builds as safe for public frictionless distribution yet.

## Security boundary

- The renderer is sandboxed, context-isolated, and has no Node integration.
- Preload exposes only the typed API in
  [`src/shared/ipc-contract.ts`](src/shared/ipc-contract.ts).
- No generic shell/spawn API exists. Main uses fixed argument arrays for
  allowlisted provider commands.
- Provider credentials remain in provider-owned storage. AOS does not read or
  persist credential files or terminal input.
- Electron capability fuses disable Run-as-Node, Node options, and CLI inspect;
  enforce embedded-ASAR integrity; and load application code only from ASAR.
- A controller switch applies to a new session only. AOS never automatically
  attaches to, resumes, restarts, or transfers hidden context from an existing
  Codex or Claude session.

See [`ADR-002`](../../docs/architecture/adr-002-desktop-runtime.md) for the
accepted architecture and distribution decision.
