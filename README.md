# Docket

> Docket is a working name, adopted in place of the earlier codename AOS.
> Trademark and domain screening have not been completed.

**Docket is a merge gate for agent-written code.** It runs the coding agent you already have — Codex, Claude Code — inside a boundary that agent cannot talk its way out of, then proves what the change actually does before you merge it.

An audit trail tells you the agent edited fourteen files. A merge gate tells you whether those fourteen files are safe to merge.

## The problem

Generating code stopped being the bottleneck. Deciding whether to accept it did not.

The tools that coordinate agents have converged on governance: org charts, tickets, budgets, append-only history. That answers *what happened*. It does not answer the only question that blocks a merge — *is this correct, and what else does it touch?* An agent's own summary of its work is not evidence, and a reviewer who has to re-derive the change from a diff has not been helped much.

Docket is built for the person who has to say yes or no.

## What a gate produces

For each bounded unit of work, one evidence packet:

- **Intent versus diff** — what was asked, and what actually changed.
- **Checks that really ran** — the repository's own tests and linters, executed by Docket rather than reported by the agent, with their true output. A failure is reported as a failure.
- **Blast radius** — what else calls what changed.
- **Claim versus behaviour** — what the agent said it did, next to what it did.
- **The open decision** — the one judgment call that is actually yours.

Deterministic checks come first. A reviewer model is consulted only when its expected value is positive, and it is never the thing that says "safe."

## Status — what is real today

Docket is a local alpha. This section is deliberately specific, because the gap between a product brief and a binary is where trust is lost.

**Working now:**

- detection and version checks for locally installed `codex` and `claude`
- provider-owned login flows in a restricted terminal Docket does not read
- workspace authorization through the OS picker, canonicalized and validated
- a real controller session in an in-app terminal
- per-repository agent detection that writes real `.claude/agents/*.md` and `AGENTS.md`
- subagent activity read from the CLI's own hooks
- the trust boundary below, covered by tests

- check discovery and execution, with drift detection against the committed definitions
- the evidence packet, and a stated intent to read it against
- container isolation when a runtime is present, with a fail-closed mode that refuses to run without one

**Not built yet — and not claimed:**

- work-unit routing, the model fleet, and capability certification
- short-lived, scope-limited credentials for the agent process

Container isolation has one caveat worth stating: it has been exercised by
tests that pin its argument vector, but no maintainer has yet run a check
through a real container runtime. Until someone has, treat the contained path
as built rather than proven. A Git worktree remains
[not a security boundary](docs/architecture/security.md), which is why the
container exists.

Every desktop artifact is unsigned. Signing and notarization on all three platforms are release gates, not solved problems.

## The trust boundary

Most of this category treats the orchestrator as trusted infrastructure. It is not: it is a program that takes instructions from a model and configuration from a file, and it runs on a machine with your source and your credentials on it. In August 2026 the most popular agent orchestrator disclosed an unauthenticated remote-code-execution flaw whose root cause was that [agent configuration could become executable behaviour](docs/research/competitive-position.md).

Docket is built so that cannot happen:

- **No generic shell.** There is no spawn or exec API. Main uses fixed argument arrays for a small allowlist of provider commands.
- **No local server.** No HTTP listener, so no localhost trust model to defeat. The renderer talks to main over one typed IPC surface.
- **A sandboxed renderer** with context isolation and no Node integration.
- **Electron fuses** disable Run-as-Node, Node options, and CLI inspection, enforce ASAR integrity, and load application code only from ASAR.
- **Credentials stay with the provider.** Docket neither reads nor persists credential files or terminal input.
- **No silent session capture.** A controller switch applies to new sessions only. Docket never attaches to, resumes, restarts, or transfers an existing conversation.

See [ADR-002](docs/architecture/adr-002-desktop-runtime.md) and the [desktop README](apps/desktop/README.md).

## Bring your own agent

Docket does not want to be your coding agent, and it cannot replace one.

Connecting an MCP server or installing a skill cannot force Codex, Claude Code, or another host to change its main model. Docket runs the CLI you already have, under a boundary and a set of checks. The host stays the controller unless it exposes a supported model-selection API.

This is a deliberate position: the generation layer is competitive and commoditizing. The gate is not.

## Where this is going

Routing work to the cheapest model that has proven it can do the job remains the long-term design, and the architecture documents describe it in full. It is sequenced *after* the gate, because routing without verification just distributes unverified work more cheaply.

Order of work: evidence packet → deterministic verification → per-unit isolation → routing and certification. See the [roadmap](docs/ROADMAP.md) and [competitive position](docs/research/competitive-position.md).

## Repository map

```text
docket/
├── apps/
│   ├── dashboard/        # Earlier browser prototype of the mission/ledger
│   │                     # framing, kept as design reference; data is simulated
│   ├── desktop/          # The product: local Electron workbench
│   └── site/             # Download site
├── docs/
│   ├── PRODUCT.md        # Product definition
│   ├── ROADMAP.md        # Outcome-gated delivery plan
│   ├── architecture/     # Runtime, security, fleet, and receipts
│   └── research/         # Competitive position and market research
├── design-system/        # UI/UX source of truth
├── infra/                # Reserved for deployment and isolation config
└── packages/             # Reserved for shared runtime packages
```

## Run or package the desktop app

```bash
cd apps/desktop
npm ci
npm run validate
npm start
```

`npm run make` builds for the platform you are on; `make:mac`, `make:win`, and `make:linux` target a specific one:

| Platform | Artifacts |
| --- | --- |
| macOS (arm64, x64) | `.dmg`, `.zip` |
| Windows (x64) | `Docket-<version>-Setup.exe`, `.zip` |
| Linux (x64) | `.deb`, `.rpm`, `.zip` |

Each target builds on its own operating system, because `node-pty` has no Linux prebuild and the Windows installer needs a Windows host. [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml) builds all four on matching runners and attaches them, with checksums, to a draft release.

## Run the dashboard prototype

```bash
cd apps/dashboard
npm install
npm run dev
```

Then open `http://localhost:3000`. All of its missions, costs, receipts, and model identities are simulated and labelled as such.

## Product documents

- [Product definition](docs/PRODUCT.md)
- [Competitive position and product wedge](docs/research/competitive-position.md)
- [Roadmap](docs/ROADMAP.md)
- [System architecture](docs/architecture/system.md)
- [Security architecture](docs/architecture/security.md)
- [Receipt format](docs/architecture/receipts.md)
- [Model fleet](docs/architecture/model-fleet.md)
- [Market and user research](docs/research/market-landscape.md)
- [Guildly teardown](docs/research/guildly-teardown.md)
- [Dependency risk register](docs/architecture/dependency-risk-register.md)
- [Design system](design-system/docket/MASTER.md)

## Language and licensing

Docket uses **open-weight** when a model publishes weights but does not necessarily meet the [Open Source Initiative's Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition). Model eligibility must include license and data-policy checks; "downloadable" is not treated as synonymous with "open source" or "safe for commercial use."

Docket is open source under the [Apache License 2.0](LICENSE). See [ADR-003](docs/architecture/adr-003-open-source-licence.md) for why that licence and what it settles. The product name is still a working name pending trademark and domain screening.

The coding-agent CLIs Docket runs are installed separately and are not covered by this licence; they remain subject to their own vendors' terms.

## Research provenance

The linked research was assembled from official product documentation, primary repositories, industry surveys, a disclosed CVE record, and clearly labelled issue reports. Adaptive Model Router delegations returned failed receipts because no worker models were configured; this repository therefore does not claim that an external worker model produced or verified any artifact. Content-free receipts are retained in [`docs/research/router-receipts.jsonl`](docs/research/router-receipts.jsonl).
