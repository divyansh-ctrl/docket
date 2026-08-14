# ADR-002: Electron desktop runtime with provider-neutral controllers

**Status:** accepted for the desktop MVP  
**Date:** 2026-08-13

## Context

AOS needs a downloadable application that can detect locally installed coding
agents, authenticate them through a real terminal, authorize a workspace, and
show operational evidence. The web dashboard cannot safely own local CLI or
PTY access, so the desktop boundary must add those powers without granting them
to the renderer.

Codex and Claude Code may both be installed and authenticated, but their
sessions and provider contracts are not interchangeable.

## Decision

Build `apps/desktop` with Electron, React, TypeScript, Electron Forge, and
`node-pty`.

- The renderer is sandboxed with Node integration disabled and context
  isolation enabled.
- A small preload exposes one typed `AosDesktopApi`; it never exposes
  `ipcRenderer`, environment variables, process handles, or a generic command
  interface.
- The main process owns executable discovery, provider status, native folder
  selection, non-secret preferences, PTY sessions, and cleanup.
- Commands use fixed executable/argument arrays and never invoke a shell.
- The terminal is purpose-bound to provider login and newly launched provider
  sessions. It is not a general shell.
- A canonical native folder picker authorizes workspace paths. Renderer-sent
  paths are not treated as authority.
- One controller is selected per workspace. Switching applies only to a new
  idle session; AOS does not hot-swap, resume, attach to, or restart an existing
  provider session.
- Controller selection and routed worker-model selection remain separate.

## Authentication boundary

Codex browser authentication runs as `codex login`; state is verified with
`codex login status`.

Claude support has two explicitly different modes:

1. **Claude Console** (`claude auth login --console`) is the production path
   for third-party software.
2. **Local CLI preview** (`claude auth login`) exists only for local product
   evaluation and is labelled accordingly. It must not be marketed as a way to
   route product usage through a user's Free, Pro, or Max subscription.

Credentials remain in provider-owned storage. AOS neither receives nor
persists provider tokens.

## Distribution decision

AOS Desktop ships downloadable artifacts for all three desktop platforms:
`.dmg`/`.zip` on macOS (arm64 and x64), `AOS-Setup.exe`/`.zip` on Windows
(x64), and `.deb`/`.rpm`/`.zip` on Linux (x64).

> **Amendment 2026-08-14:** the Windows installer is now built as
> `Docket-<version>-Setup.exe`. The name above is left as recorded on
> 2026-08-13 rather than rewritten, per the change-control rule in
> [`README.md`](README.md). The installer gained a version in 830084a: a
> filename stable across releases makes a download resolve by release ordering
> rather than by what was asked for. The distribution decision itself is
> unchanged — this amends an artifact name, not an outcome.

Each target is built on its own runner rather than cross-compiled. Two
constraints force this and are not expected to change: `node-pty` publishes no
Linux prebuild, so its native module must be compiled by a Linux toolchain,
and Squirrel.Windows requires a Windows host to produce an installer. CI
therefore runs a four-way matrix and attaches checksummed artifacts to a draft
release.

Public frictionless distribution remains gated on code-signing on every
platform: a Developer ID certificate plus notarization on macOS, an EV/OV
certificate on Windows, and signed repository metadata on Linux. Until then
each artifact triggers the platform's unrecognised-publisher warning, and
releases are drafted rather than published so that warning can be documented
before anyone downloads.

### Platform-specific runtime consequences

Supporting three platforms moved several assumptions out of the code:

- Provider discovery is layout-driven per platform. Claude Code resolves from
  its native installer, Homebrew casks, WinGet, and Linux package managers;
  Codex resolves from npm prefixes and NVM. Windows launchers are `.cmd`/`.exe`
  rather than shebang scripts, so the Codex shim is never executed: a trusted
  `node.exe` runs the resolved package script, keeping the "never invoke a
  shell" rule intact.
- The provider environment is constructed per platform. Windows requires
  `SystemRoot` and related variables or process creation fails outright.
- `node-pty` rejects a signal argument on Windows, so termination requests
  omit it there and skip the SIGKILL escalation, which has no meaning under
  ConPTY.
- Window chrome differs: `hiddenInset` is macOS-only and produces a frameless,
  uncloseable window on Windows, which uses the native title bar overlay
  instead while Linux keeps its own frame.

## Rejected alternatives

- **PWA/browser-only:** cannot own local CLI, PTY, or native folder authority.
- **Tauri for this milestone:** adds a Rust toolchain and Node sidecar/refactor
  while native PTY and React reuse are the dominant requirements.
- **Mac App Store first:** its sandbox conflicts with repository and local CLI
  access.

## Consequences

- Electron increases download size because Chromium is bundled.
- Native `node-pty` must be rebuilt for Electron and unpacked from ASAR.
- Every IPC handler and external URL is a security boundary.
- Claude subscription authentication cannot be a generally distributed product
  feature without Anthropic approval; Console/API or supported cloud billing is
  required for production.

## Verification gates

- Typecheck, lint, and production dependency audit pass.
- Renderer CSP, sandbox, navigation denial, IPC sender validation, fixed
  commands, path authorization, and PTY cleanup receive independent review.
- The packaged app opens, detects both CLIs, reports auth without exposing
  credentials, and creates a purpose-bound terminal on demand.
- Browser preview remains visibly and persistently labelled simulated.
