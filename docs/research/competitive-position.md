# Competitive position and product wedge

**Research date:** 2026-08-14
**Question:** Docket's current build overlaps heavily with products that are already free, polished, and widely adopted. What position is actually unclaimed, and what must Docket build to own it?

## Bottom line

Docket is competing on the axis where it is weakest and giving away the axis where it is strongest.

The team room — channels, a roster, a ticket board, an office floor — is the Guildly axis. Guildly ships it free on three platforms with GitHub, Slack, Linear, Drive, and Notion integrations. Paperclip ships the governance version of it under MIT and passed 30,000 GitHub stars within three weeks of its March 2026 launch. Docket's version of that surface is a strict subset of both, and this repository's own [Guildly teardown](guildly-teardown.md) already warned against cloning the metaphor.

Meanwhile the thing Docket has actually built and tested — a desktop runtime where agent configuration cannot become arbitrary execution — is the exact failure that took down the category leader this month, and Docket does not currently say so anywhere in its product surface.

**The unclaimed position is not "a better room for agents." It is proof that agent work is safe to merge.**

## What changed since the 2026-08-13 landscape review

The [market landscape](market-landscape.md) written one day earlier concluded that "Guildly with open models" is not durable differentiation. That conclusion holds and has strengthened. Four things are now established that were not clearly established then.

### 1. The governance layer is taken, at scale

[Paperclip](https://paperclip.ing/) ships org charts, roles, **tickets with immutable audit trails**, **per-agent monthly budgets** that hard-stop on breach, heartbeats, and goal alignment. It is agent-agnostic by design — "If it can receive a heartbeat, it's hired" — and explicitly lists Claude, Codex, Gemini, Cursor, Hermes, OpenClaw, Pi, and OpenCode.

Its audit claim is nearly the wording Docket uses for receipts: *"Append-only history. No edits, no deletions."*

**Implication:** "we have tickets and an append-only history" is no longer a differentiator. It is a check-box a 30k-star MIT project already ticks.

### 2. The team-room UX is taken, and it is free

[Guildly](https://www.tryguildly.com/) is a Slack-like desktop app with `#general`, `#tickets`, `#prds`, `#docs`, `#ideas`, and `#trackers`; five role agents; a Kanban board with OPEN → DOING → REVIEW; an AUTOPILOT mode; and a cost dashboard. Its stated discipline is *"A plan first, then the work"* with one-click human approval.

Docket has `#floor`, `#tickets`, `#roster`, and an Office. That is fewer channels, fewer integrations, and no plan-approval step, against a free incumbent.

**Implication:** Docket cannot win this surface by adding more of it.

### 3. Isolation is being solved — but only inside single vendors

- GitHub Copilot coding agent runs each task in an ephemeral cloud sandbox VM.
- Cursor, Devin, and Cognition each ship a hosted sandbox or VM per task.
- [Sculptor](https://www.augmentcode.com/tools/best-ai-coding-agent-desktop-apps) (Imbue) gives each agent its own Docker container, but is Claude-primary and requires Docker Desktop.
- The OpenAI Codex app offers local, worktree, and cloud modes — but GPT-5 family only, with "no bring-your-own-agent flexibility."
- `container-use` (Dagger) and `packnplay` give each agent an ephemeral container plus a dedicated worktree.

**Implication:** real isolation exists, but always coupled to one model vendor, one container runtime, or someone else's cloud. Nobody offers *isolation + bring-your-own-agent + a local team surface* together.

### 4. Verification of agent output is a real category — and it lives outside the loop

[Greptile](https://www.greptile.com/content-library/best-ai-code-review-tools) positions explicitly as an independent validation layer for AI-generated code: whether a PR comes from a developer, Claude Code, Codex, Cursor, or Devin, it applies the same full-codebase review before merge. CodeRabbit is the most-adopted PR reviewer and works natively across GitHub, GitLab, Bitbucket, and Azure DevOps. Qodo pairs review with generated tests.

**Implication:** Docket must not try to become an AI code reviewer. That fight is lost. But note *where* these tools sit: post-hoc, cloud-hosted, at the pull request, with no control over how the change was produced and no ability to stop it earlier.

## The Paperclip vulnerabilities, and why they matter architecturally

On 2026-08-05, three flaws were disclosed in Paperclip, all patched in `v2026.416.0`:

| ID | CVSS | Auth required | Root cause |
|---|---|---|---|
| [CVE-2026-41679](https://thehackernews.com/2026/08/paperclip-ai-flaws-let-attackers-run.html) | 10.0 | No | Import accepted board-level credentials to create companies, bypassing instance-admin checks. *"Agent configuration can become executable behavior"* via a process adapter that launches configured commands. |
| GHSA-x8hx-rhr2-9rf7 | 9.6 | No | DNS rebinding against the localhost trust model: in `local_trusted`, Paperclip *"treated every request reaching the service as an implicit instance administrator."* |
| GHSA-xfqj-r5qw-8g4j | 8.3 | Varies | Unauthenticated requests passed middleware with a "no actor" identity, leaving each route to assert its own access control. |

Impact of the first: application data, source repositories, locally stored credentials, secrets available to agent processes, and internal services reachable from the machine.

**This is not a reason to disparage Paperclip — they patched it quickly.** It is a reason to name the architectural class, because Docket's existing design is already the counter-argument to all three:

| Paperclip failure class | Docket's existing counter | Where it lives |
|---|---|---|
| Agent config becomes executable behavior | No generic shell or spawn API; fixed argument arrays for allowlisted provider commands only | `src/main/security-policy.ts` |
| Localhost implies administrator | No local HTTP server at all; narrow typed IPC over a context-isolated bridge | `src/shared/ipc-contract.ts` |
| Route-by-route access assertions | One preload surface, one validation layer, tested | `src/main/validation.ts`, 67 passing tests |
| Secrets reachable by agent processes | Credentials stay in provider-owned storage; Docket never reads or persists them | ADR-002 |

Docket has this and says nothing about it. That is the most valuable unexploited asset in the repository.

## Where Docket actually stands today

Honest inventory, so the strategy is not built on the marketing copy.

**Real and working:**
- provider detection and version checks for installed `codex` / `claude`
- provider-owned login in a restricted PTY
- workspace authorization through the OS picker, canonicalized and validated
- a real controller session in an in-app terminal, verified running Codex `v0.144.1`
- per-repository agent detection that writes actual `.claude/agents/*.md` and `AGENTS.md`
- subagent lifecycle events read from the CLI's own hooks
- the security boundary above, with tests

**Not real:**
- routing (no worker selection exists)
- receipts (no receipt is produced by anything)
- verification (nothing is checked; nothing is proven)
- isolation beyond a Git worktree, which the repo's own [security doc](../architecture/security.md) correctly says is not a security boundary
- the Office, which is labelled `demonstration · no session running` because it is

The gap between the README's claims and the binary is wide. That gap is exactly what "the build is not even close enough" means, and it is fixable — but not by adding channels.

## The market map

| Layer | Who owns it | What it proves | What it cannot do |
|---|---|---|---|
| Org chart / governance | Paperclip, Guildly | *what happened* — who did what, what it cost | whether the result is correct or safe |
| Execution isolation | Copilot cloud, Codex cloud, Sculptor, container-use | the blast radius was contained | nothing about correctness; locked to one vendor or runtime |
| Post-hoc review | Greptile, CodeRabbit, Qodo | a human-readable opinion on a finished PR | cannot stop the work earlier; no control over production |
| Personal autonomy | [Hermes](https://hermes-agent.nousresearch.com/) (Nous Research) | persistent memory, self-generated skills | not aimed at team software delivery |

**The seam nobody occupies:** a local, bring-your-own-agent surface that isolates each unit of work *while it runs*, verifies it with deterministic checks *before* it reaches a pull request, and hands a human a compact evidence packet that says why it is safe to merge.

An audit trail says *the engineer agent edited 14 files.* A receipt says *the tests it claimed to run actually ran, here is their output, here is what else calls the function it changed, and here is the one decision left for you.* Paperclip ships the first. Nobody ships the second locally.

## What to build, in order

Each item is chosen because it is (a) unclaimed, (b) something Docket's existing runtime is unusually positioned to do, and (c) demonstrable in a screenshot.

### 1. The evidence packet, for real

One work unit produces one receipt: intent versus actual diff, the checks that ran with their real output, files touched, blast radius (what else calls what changed), what the agent said it did versus what it did, and the explicit open question. Make it exportable and signed.

This is the product. Everything else is scaffolding for it. It is also the only item on this list that no competitor ships locally.

### 2. Deterministic verification before the PR exists

Run the repository's own test and lint commands inside the unit's boundary and attach the true result. Report failures as failures. The one thing every competitor's "QA agent" does badly is report on itself; Docket's advantage is that it runs the checks itself and does not have to believe the agent.

The [reviewer charter](../../apps/desktop/src/shared/agent-roster.ts) already encodes the right instinct — read-only tools, one finding per ticket, a concrete failing case. Give it real check output to work from.

### 3. Real isolation per unit

Worktree plus container, read-only source, constrained writable scratch, default-deny egress. `container-use` (Dagger) and `packnplay` are prior art worth adopting rather than rebuilding. Docker-optional, because requiring Docker Desktop is Sculptor's stated weakness.

### 4. Say the security thing out loud

Docket's trust boundary is a marketing asset in a month when the leading orchestrator shipped a 10.0. Positioning: *the orchestrator that cannot be talked into running something.* Publish the boundary, the fuses, the allowlist, and the test count on the site.

### 5. Capability certification — later, not now

The category review states plainly that there is no unified benchmarking and vendors publish no independent performance comparisons. That is a genuine unmet gap and matches this repo's [model fleet](../architecture/model-fleet.md) design. But it only matters once Docket routes work to more than one model, which is far out. Keep it in the roadmap; do not build it next.

## What to stop doing

- **Stop expanding the room.** More channels, a richer Office, more agent personas — every hour there is spent losing to a free incumbent.
- **Stop shipping simulated data in the product.** The `demonstration` label is honest, but a demo pipeline in a product whose entire pitch is *proof* undermines the pitch. The dead `src/renderer/data.ts` preview missions were deleted on 2026-08-14; the Office should render only real events or nothing.
- **Stop claiming receipts, routing, and certification in the README** until one of them exists. The README currently promises a product that the binary does not contain, and the first thing a technical evaluator does is check.

## Risks to this strategy

- **Paperclip can add sandboxing.** It is MIT, fast-moving, and has 30k stars of contributor pressure. The defensible part is not the sandbox — it is verification plus evidence, which requires taste and is harder to bolt on.
- **Greptile can move earlier in the loop.** A pre-PR local mode from a funded review company would compress this wedge directly. Speed matters.
- **The security wedge is perishable.** Post-incident attention fades. It is a door-opener, not a moat.
- **Single-operator scope.** Isolation plus verification plus receipts is a large build. Item 1 alone, done well, is a defensible product; the list should not be attempted in parallel.

## Sources

Public material reviewed on 2026-08-14. Absence of a capability means it was not established in the cited material, not that it is impossible.

- [Paperclip](https://paperclip.ing/) — official product page
- [Paperclip vulnerabilities](https://thehackernews.com/2026/08/paperclip-ai-flaws-let-attackers-run.html) — The Hacker News, 2026-08-05
- [Guildly](https://www.tryguildly.com/) — official product page
- [Hermes Agent](https://hermes-agent.nousresearch.com/) — Nous Research
- [Best AI coding agent desktop apps](https://www.augmentcode.com/tools/best-ai-coding-agent-desktop-apps) — Augment Code category review
- [Best AI code review tools](https://www.greptile.com/content-library/best-ai-code-review-tools) — Greptile (vendor-authored; treat comparative claims as marketing)
- [AI agent sandboxing](https://amux.io/guides/ai-agent-sandboxing/) — isolation technology comparison
