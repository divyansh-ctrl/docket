# Docket

Docket is the downloadable local workbench. It detects the Codex and Claude
Code CLIs already installed on the machine, authenticates them through their
own login flows in a restricted terminal, authorizes one workspace, and starts
a fresh controller session in an in-app terminal.

This app is where the [merge gate](../../docs/PRODUCT.md) runs. Alongside the
host work — detection, authorization, sessions, and the per-repository agent
roster — the `#checks` channel discovers the repository's own checks, detects
whether their definitions have drifted from the committed ones, runs them, and
assembles an evidence packet you can seal into a decision record. See the
[roadmap](../../docs/ROADMAP.md) for what is still missing.

## Running checks in a container

Checks run inside a container when a runtime is available, and on the host with
a stated reason when one is not. Docker and Podman are both recognised; neither
is required.

    brew install colima docker && colima start    # macOS, no GUI and no licence
    # or Docker Desktop, or podman machine start

Four things are worth knowing before trusting a green result.

**The repository is mounted, not the workspace.** A check declared by a monorepo
package routinely reads across the repository — a sibling's manifest, a shared
fixture, a config file at the root. Mounting only the package makes those files
not exist, and the run then fails for a reason that is not in the code. So the
mount is the Git repository containing the workspace, and the working directory
is the workspace inside it. There is still exactly one mount, and it is never
widened to the home directory or the filesystem root even when Git reports one
of those as the repository root — in that case the mount stays narrow and the
result says so.

**The runtime has to be able to see the repository.** On macOS and Windows the
runtime is a virtual machine that shares only part of the host filesystem —
Colima shares your home directory, Docker Desktop shares what is listed under
Settings → Resources → File sharing. A bind mount of a path outside those does
not fail: it mounts an **empty directory**, and the check then reports the
repository's tests as failing when the container never saw them. Docket proves
the mount with a probe container before every first run against a repository,
and falls back to the host with that reason rather than reporting a red result
that has nothing to do with your code.

**A container the check cannot actually run in is not used.** Seeing the
repository is not the same as being able to run it, and two ways that goes
wrong were found by running this repository's own suite contained on a tree
that is green on this machine:

- `node_modules` was installed by your machine, so any dependency with a
  compiled component holds a binary for your operating system and cannot load
  under Linux.
- A linked Git worktree keeps its real `.git` inside the main checkout, which
  is outside the mount, so Git does not work in the container at all — and
  shelling out to Git is among the most ordinary things a check does.

Both are checked before the run, and either sends the check to the host with
that reason attached. Neither is reported as the repository's tests failing.
Giving the container its own dependencies, so the first one stops being a
fallback and starts being a fix, is
[Track 0.3](../../docs/IMPLEMENTATION-PLAN.md).

**Isolation can be required.** With "Require isolation" on, a check with no
usable container is not run at all and is recorded as `refused` — never as a
pass, and never as a failure.

Whatever happens inside the container, a non-zero exit is only reported as a
failure when the thing that exited was the code. A compiled module that will
not load, a program that is not installed, a missing account entry: these are
recorded as `errored` with the line that said so, because "the tests did not
run" and "the tests failed" lead a reviewer to opposite conclusions.

The image is `node:22-bookworm`, because discovery only understands npm scripts
today. A repository needing something else is not yet served. The `-slim`
variant would be four times smaller and is not used: it ships no Git, and
running this repository's suite inside it produced fifteen failures reading
`spawn git ENOENT` — none of them in the code, every one of them shaped like a
finding.

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
- A per-repository agent roster is detected and written to disk as real
  `.claude/agents/*.md` definitions plus a root `AGENTS.md`, and each agent's
  model can be overridden.
- Subagent starts and stops are read from the CLI's own hooks, so the activity
  shown is reported by the CLI rather than inferred.
- The browser-only renderer fallback is simulated and persistently labelled;
  it does not inspect CLIs, create credentials, or execute a provider.

The interface is a team room — a channel rail, a ticket board, an agent roster,
and an Office floor view — plus the session terminal. The Office is labelled
`demonstration` whenever no session is running, because without a live session
it has no real events to draw.

Nothing here routes work between models. The Adaptive Model Router remains a
separate delegation layer: it can select bounded worker models but does not
replace the selected Codex or Claude controller.

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

- **macOS** — Gatekeeper blocks it. Set `DOCKET_SIGN_MAC_APP=1` with a Developer
  ID Application identity to sign, and `DOCKET_NOTARIZE_MAC_APP=1` plus
  `APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID` to notarize.
  `APPLE_SIGNING_IDENTITY` names which certificate to use, which matters on a
  machine holding more than one.

  **The build fails if signing is requested and cannot be performed.** Setting
  `DOCKET_SIGN_MAC_APP=1` without a Developer ID certificate installed used to
  produce a green build and an ad-hoc binary; it now stops with the reason.
  Leave the variable unset to build honestly unsigned.
- **Windows** — SmartScreen shows an unrecognised-publisher warning until the
  installer is signed with an EV or OV code-signing certificate.
- **Linux** — the `.deb` and `.rpm` are unsigned; no repository is published.

### What signing actually requires

None of this can be done from the repository; it needs an Apple account and a
paid enrollment.

1. **Enrol in the Apple Developer Program** — $99/year, which includes
   notarization at no extra cost.
2. **Create a Developer ID Application certificate** and install it in the
   login keychain. `security find-identity -v -p codesigning` must then list it;
   the build verifies this rather than assuming it.
3. **Create an app-specific password** for the Apple ID used to notarize.
4. **For CI**, export the certificate as a `.p12`, base64 it, and set the
   repository secrets `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_ID_PASSWORD`, and
   `APPLE_TEAM_ID`. The release workflow imports the certificate into a
   per-run keychain; without `APPLE_CERTIFICATE_P12` it builds unsigned and
   says so.

Windows signing is separate: Azure Trusted Signing is around $10/month, or a
traditional EV/OV certificate is $280–900/year. Note that certificate lifetimes
are capped at 459 days, so renewals come round more often than they used to.

Signing and notarization are release gates, not solved problems. Do not
describe these builds as safe for public frictionless distribution yet.

## Security boundary

- The renderer is sandboxed, context-isolated, and has no Node integration.
- Preload exposes only the typed API in
  [`src/shared/ipc-contract.ts`](src/shared/ipc-contract.ts).
- No generic shell/spawn API exists. Main uses fixed argument arrays for
  allowlisted provider commands.
- Provider credentials remain in provider-owned storage. Docket does not read or
  persist credential files or terminal input.
- Electron capability fuses disable Run-as-Node, Node options, and CLI inspect;
  enforce embedded-ASAR integrity; and load application code only from ASAR.
- A controller switch applies to a new session only. Docket never automatically
  attaches to, resumes, restarts, or transfers hidden context from an existing
  Codex or Claude session.

See [`ADR-002`](../../docs/architecture/adr-002-desktop-runtime.md) for the
accepted architecture and distribution decision.
