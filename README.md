# AOS

> Provisional codename. Trademark and domain screening have not been completed.

AOS is an open-weight agent operations system for software teams. It turns a request into bounded work units, assigns each unit to a policy-eligible local or hosted model, runs it in an isolated workspace, verifies the result, and gives a human a compact evidence packet instead of a wall of agent activity.

The product thesis is simple: the scarce resource is no longer generated code. It is trustworthy review time.

## Status

This repository now contains two deliberately separated surfaces:

- The dashboard is an interactive product prototype with clearly labelled simulated mission, worker, cost, and receipt data.
- AOS Desktop is a local alpha for macOS, Windows, and Linux that can detect installed Codex and Claude Code CLIs, run their provider-owned login flows in a restricted terminal, authorize a workspace, select either provider as the base for new sessions, and start a fresh controller session. It never attaches to, resumes, restarts, or silently transfers an existing conversation.

Every desktop artifact is unsigned today. Real adaptive worker execution, verified model receipts, and signing/notarization on all three platforms are still future release gates; the product does not claim those capabilities today.

## What makes AOS different

- **Work-unit routing, not model chat switching.** A controller decomposes mixed work, then routes implementation, documentation, tests, or review independently.
- **User-owned model fleet.** Local `llama.cpp`/Ollama and OpenAI-compatible vLLM or hosted endpoints can sit behind one policy surface.
- **Capability certification.** A connected model earns eligibility by passing tool-use, patching, schema, latency, and stability checks on the user's hardware.
- **Durable orchestration.** Leases, heartbeats, idempotency, cancellation propagation, spawn limits, and retry budgets prevent duplicate or orphaned work.
- **Proof before trust.** Every run produces an append-only receipt with the requested and reported model, artifacts, actions, checks, cost, latency, and escalation history.
- **Review compression.** Humans see intent-versus-diff, affected invariants, risk hotspots, test evidence, assumptions, and the exact decisions still required.
- **Isolation by default.** A Git worktree separates changes; a container or microVM, network policy, and scoped credentials provide the actual security boundary.

## An important integration boundary

Connecting an MCP server or installing a skill cannot force Codex, Claude Code, or another host to replace its main model. AOS can recommend a route and can execute delegated work through its own control plane. Mechanical enforcement happens only when delegated provider calls and work execution pass through AOS. The host remains the controller unless the host itself exposes a supported model-selection API.

## Intended workflow

1. Import a repository and connect user-owned inference endpoints.
2. Certify the models and record their real capabilities, locality, licenses, latency, and cost.
3. Convert a mixed request into bounded work units with risk and data-policy labels.
4. Route each unit to the cheapest model that has proven it can do the job.
5. Execute in an isolated workspace with explicit tool and network permissions.
6. Run deterministic checks and, when warranted, an independent reviewer model.
7. Escalate only unresolved judgment calls to a human, with a verifiable receipt.
8. Learn from acceptance, regressions, retries, latency, and cost without training on private code by default.

## Prototype experience

The dashboard has two synchronized ways to understand the same mission state:

- **Ledger** shows the causal event history, compressed change review,
  validation evidence, routing receipt, costs, and approval boundary.
- **Workshop** is a top-down operational map of Plan → Route → Build →
  Validate → Approve → Ship. It is a navigation and situational-awareness
  surface, not a virtual office that disguises models as people.

Violet Ink, Mineral Blue, and Warm Sand change the workspace atmosphere while
keeping success, warning, and destructive colors stable. All current missions,
costs, receipts, and model identities remain visibly marked as demo data.

## Repository map

```text
aos/
├── apps/
│   ├── dashboard/        # Browser-based interactive prototype
│   └── desktop/          # Secure local Electron workbench and macOS packaging
├── docs/
│   ├── PRODUCT.md        # Product requirements and strategy
│   ├── ROADMAP.md        # Outcome-gated delivery plan
│   ├── architecture/     # Runtime, security, fleet, and receipts
│   └── research/         # Guildly, market research, and router receipts
├── design-system/        # UI/UX Pro Max source of truth
├── infra/                # Reserved for deployment and isolation config
└── packages/             # Reserved for shared runtime packages
```

## Run the dashboard

```bash
cd /Users/divyansh/Desktop/aos/apps/dashboard
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Run or package the desktop app

```bash
cd /Users/divyansh/Desktop/aos/apps/desktop
npm ci
npm run validate
npm start
```

`npm run make` builds for the platform you are on; `make:mac`, `make:win`, and `make:linux` target a specific one. Downloads are produced per platform:

| Platform | Artifacts |
| --- | --- |
| macOS (arm64, x64) | `.dmg`, `.zip` |
| Windows (x64) | `AOS-Setup.exe`, `.zip` |
| Linux (x64) | `.deb`, `.rpm`, `.zip` |

Each target builds on its own operating system, because `node-pty` has no Linux prebuild and the Windows installer needs a Windows host. [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml) builds all four on matching runners and attaches them, with checksums, to a draft release.

AOS starts only new controller sessions from the app; it does not discover or modify an already-running Codex or Claude session. See the [desktop README](apps/desktop/README.md) for the trust boundary, per-platform requirements, and signing status.

## Product documents

- [Product definition](docs/PRODUCT.md)
- [Guildly teardown](docs/research/guildly-teardown.md)
- [Market and user research](docs/research/market-landscape.md)
- [Roadmap](docs/ROADMAP.md)
- [System architecture](docs/architecture/system.md)
- [Security architecture](docs/architecture/security.md)
- [Model fleet](docs/architecture/model-fleet.md)
- [Receipt format](docs/architecture/receipts.md)
- [Dependency risk register](docs/architecture/dependency-risk-register.md)
- [Dashboard design system](design-system/aos/MASTER.md)

## Language and licensing

AOS uses **open-weight** when a model publishes weights but does not necessarily meet the [Open Source Initiative's Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition). Model eligibility must include license and data-policy checks; “downloadable” is not treated as synonymous with “open source” or “safe for commercial use.”

The AOS project license and final product name are not yet decided. The proposed business model in `docs/PRODUCT.md` is a hypothesis, not a licensing commitment.

## Research provenance

The linked research was assembled from official product documentation, primary project repositories, industry surveys, and clearly labeled issue reports. Adaptive Model Router delegations returned failed receipts because no worker models were configured; therefore this repository does not claim that an external worker model produced or verified any artifact. Content-free receipts are retained in `docs/research/router-receipts.jsonl`.
