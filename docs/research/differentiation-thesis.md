# Docket differentiation thesis

**Research date:** 2026-08-14
**Ticket:** GLD-2
**Question:** What already exists in the multi-agent coding-desktop category, what does not, and what is the specific wedge that makes Docket worth installing?

**Method:** review of the existing repo docs, review of the shipped desktop source, and public web research on the named competitive set. Every competitive claim below is scoped to public material reviewed on the research date. Absence means "not established in the public material I read," not "does not exist." Anything I could not verify is labelled **[assumption]**.

> **Revised 2026-08-15.** Findings about competitors are left exactly as recorded on 2026-08-14 — they are dated evidence and rewriting them would destroy their value. What is updated is this document's claims about **our own repository**, which were accurate when written and are no longer: the docs it calls stale have been rewritten, and the evidence packet it calls unbuilt now exists. Each such correction is marked inline. Two genuine disagreements with the merged product documents are recorded in §5 rather than silently resolved.
>
> Read alongside [`competitive-position.md`](competitive-position.md), written independently on the same day. The two cover **different competitive sets** — this one the desktop orchestrators (Conductor, Nimbalyst, Vibe Kanban, Cursor, Zed), that one the governance and review layers (Paperclip, Guildly, Greptile, Sculptor) — and reach the same conclusion by different routes: the review artifact is the wedge, and it is unbuilt everywhere. Neither supersedes the other.

---

## 0. Where the existing docs have gone stale

This is the first finding, because it affects everything else: **our own documents describe a different product than the one in the repo.**

> **Resolved 2026-08-15.** This finding was acted on. `README.md`, `docs/PRODUCT.md`, and `docs/ROADMAP.md` were rewritten around the merge gate; `apps/desktop/README.md` was corrected; the AOS name was removed everywhere except two deliberate historical references. The recommendation below — rewrite rather than patch — is what happened.
>
> Two entries in the table were **not** acted on and remain open, because they are product decisions rather than documentation debt: `model-fleet.md` still exists and routing is sequenced at roadmap Phase 4 rather than retired, and the business-model table in `PRODUCT.md` still describes Community/Team/Enterprise editions. See §5.
>
> The table is left as recorded. It is the evidence that motivated the rewrite, and a corrected copy would no longer show why the rewrite was needed.

| Doc | State | What is stale |
|---|---|---|
| `README.md` | **Stale — product-level** | Describes "AOS, an open-weight agent operations system," a model-fleet router with capability certification and container isolation. The app was renamed **Docket** and rebuilt as a team room in commit `ca24440`. The README still maps `apps/dashboard` as a headline surface. |
| `docs/PRODUCT.md` | **Stale — thesis-level** | Its ten product primitives are mostly out of scope now: model fleet registry, capability certification, policy router, container/microVM execution isolation, and outcome learning all assume a control plane we are no longer building. The business-model table (open-source Community edition, hosted Team tier, self-hosted Enterprise, managed inference) directly contradicts "proprietary, closed-source, local-first, no backend." What survives intact: durable work state, scoped context, verification, receipts, review compression. |
| `docs/ROADMAP.md` | **Stale — structurally** | Phases 1–4 are organized around the router/control-plane build. Phase 1's exit criteria (1,000-work-unit soak, cancellation propagation, container executor) describe a system we are not shipping. Phase 2's review-packet deliverable is the only part that maps to Docket. |
| `docs/research/market-landscape.md` | **Partly stale** | Research quality is good and the "what is commoditizing" list still holds. But the competitive table omits the products that actually matter to us — Conductor, Crystal, Vibe Kanban, Cursor, Zed, Devin, Aider — and it understates Claude Code Agent Teams (see §2, Gap 2). Its open-weight model-pool section is now irrelevant: we do not pick models, users bring a CLI. |
| `docs/research/guildly-teardown.md` | **Current and still useful** | The interface analysis ("patterns to transform") is the most directly applicable existing material we have. Note that Docket is now much *closer* to Guildly than the teardown anticipated — we adopted the team room, the roles, and the tickets. Our divergence is now the review surface alone, not the information architecture. |
| `docs/architecture/receipts.md` | **Current, over-scoped** | The envelope spec (RFC 8785 canonicalization, Ed25519, hash chain) is sound and directly reusable. But it is written for a multi-tenant hosted control plane — `tenantId`, KMS signing keys, workload identity. A local-first version needs a much smaller profile. |
| `docs/architecture/security.md`, `system.md`, `model-fleet.md` | **Stale** | All assume the control-plane architecture. `model-fleet.md` has no product left to describe. |
| `apps/desktop/README.md` | **Stale — naming** | Still "AOS Desktop." Signing-status and security-boundary sections are accurate and are the best-maintained doc in the repo. |

**Recommendation:** `PRODUCT.md`, `ROADMAP.md`, `README.md`, and `model-fleet.md` should be rewritten or retired, not patched. A reader today cannot tell what we are building. That is a real cost when the team is agents reading docs.

---

## 1. Feature matrix

Columns are the ones GLD-2 asked for. "Review artifact" is the key column: it is what the human is actually asked to look at before saying yes.

| Product | Inter-agent comms | Ticketing | Review artifact | Local-first | BYO key | Cost | OS coverage | Signing / trust |
|---|---|---|---|---|---|---|---|---|
| **Claude Code CLI** | **Yes** — Agent Teams: mailbox for direct teammate↔teammate messages, shared task list with dependencies, file locks. Experimental, off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) | Shared task list, populated by the lead at decomposition; not durable tickets | **Transcript** + diffs in terminal | Yes (runs locally) | Yes (subscription or API key) | $20 / $100 / $200 per month tiers; managed PR reviewer billed on top | mac / Win / Linux | Vendor-signed, first-party |
| **Codex CLI / Codex App** | Partial — subagents GA, 6 concurrent; ACP lets Codex run alongside other agents in one window | No | **Transcript**; GitHub-integrated auto-review posts PR comments | Yes | Yes | $20 / $100 / $200 per month tiers | mac / Win / Linux | Vendor-signed, first-party |
| **Conductor** | **No** — documented as isolated per-workspace agents | No — workspaces, not tickets | **Diff** → PR → merge → archive | Yes (Mac app, local worktrees) | Yes — requires your own Claude Code subscription | Free app; you pay the CLI subscription | **macOS only**; Windows waitlist | Signed Mac app **[assumption — not verified, but a distributed Mac app that is not blocked by Gatekeeper is signed]** |
| **Crystal** | No | No | **Diff** per session | Yes (Electron) | Yes | Free, MIT | mac / Win / Linux | **Deprecated Feb 2026** → replaced by Nimbalyst |
| **Nimbalyst** (Crystal successor) | Multi-agent workspace; agent↔agent messaging not documented | **Yes** — kanban with tagging/filtering | **Inline diffs**, plus visual mockups/diagrams | Yes | Yes | Free for individuals; MIT | mac / Win / Linux | **[assumption]** — not verified |
| **Vibe Kanban** | No — parallel/sequential orchestration, not agent↔agent | **Yes** — kanban issues you author | **Diff review with inline comments**; built-in browser + devtools | Yes | Yes | Free. **Bloop shut down 2026-04-10**; now community-maintained, Apache-2.0 | mac / Win / Linux **[assumption]** | Community-maintained; no vendor trust story |
| **Cursor (3.x)** | Parallel agents with per-agent model, approval policy, and history; no documented agent↔agent messaging | No | **Diff**, accept/reject at file or line level; Plan Mode before implementation | Hybrid — local editor plus cloud agent environments | Partial | Subscription | mac / Win / Linux | Signed |
| **Windsurf** | — | — | — | — | — | — | — | **Renamed Devin Desktop on 2026-06-02.** No longer an independent competitor; see Devin |
| **Zed** | Multiple ACP-compatible agents concurrently in one window, each in its own thread | No | **Diff** in editor | Yes | Yes | Free / paid tiers | mac / Win / Linux | Signed, open source |
| **Devin** | Multi-session; agent↔agent not documented | Session-level task tracking | **Transcript + PR**, hosted | **No** — hosted | No | $20/mo Core plus **$2.25 per ACU** (~15 min of work); $500/mo Team incl. 250 ACUs at $2.00 | Browser / hosted; Devin Desktop on desktop | Vendor-hosted |
| **Factory** | Multi-agent Missions, worker/validator patterns | **[assumption]** | **Transcript + PR** | No — hosted, BYOK/enterprise deployment options exist | Yes, via BYOK | ~$20/mo Pro, $200 Max, $80/mo Teams + $40/seat **[assumption — pricing pages not directly verified]** | Hosted + CLI | Vendor-hosted |
| **OpenHands** | Multi-agent **[assumption]** | No | **Transcript** | Yes — self-hostable | Yes, 100+ providers incl. local | Free, open source | mac / Win / Linux | Open source; self-built |
| **Aider** | No | No | **Diff** in terminal | Yes | Yes — Ollama, LM Studio, llama.cpp | Free, open source | mac / Win / Linux | Open source |
| **Goose** | Subagents | Recipes, not tickets | **Transcript** | Yes — fully offline with Ollama | Yes — 15+ providers | Free, open source (Linux Foundation AAIF, 2026) | mac / Win / Linux desktop + CLI | Open source |
| **Guildly** | Agents message each other in channels/threads | **Yes** — tickets and PRDs | **Diff + human approval gate**; "sandbox" is a Git branch | Yes — state stays on your machine, prompts go to Anthropic | Uses your Claude subscription | **[assumption]** — not verified | mac / Win / Linux | Distributed from a public releases repo |
| **Docket — 2026-08-14** | **No** (team room shell exists; agents do not talk) | **Data model only** (`room.ts`: id, owner, state, raisedBy, evidence) | **Terminal output** — no packet | **Yes** | **Yes** | Undecided | **mac arm64+x64 / Win x64 / Linux x64 — 9 installers, green CI** | **Unsigned on macOS and Windows** |
| **Docket — 2026-08-15** | No change | Board writes tickets; still not agent-raised | **Evidence packet** — intent, real check output with exit codes, changed files, references outside the change, ranked findings. Not a diff, not a transcript | Yes | Yes | Undecided | Unchanged | **Still unsigned** |
| **Docket — target** | Cross-vendor, persistent, human-addressable | Agent-raised, durable, owned | **Evidence packet + signed decision** | Yes | Yes | Undecided | 3 OSes | Signed + notarized |

### Two corrections to the brief's competitive framing

1. **"None make the agents talk to each other" is no longer true of the baseline.** Claude Code Agent Teams shipped in February 2026 with a mailbox for direct agent-to-agent messages, a shared task list with enforced dependencies, and file locks to prevent concurrent-write conflicts. It is experimental and off by default, but it exists inside the CLI we wrap. The claim is still true of Conductor, Crystal/Nimbalyst, and Vibe Kanban.
2. **Windsurf and Devin are the same company's product line now.** Windsurf was renamed Devin Desktop on 2026-06-02. Treating "IDE-embedded" and "cloud autonomous" as opposite camps is out of date — Cognition sits in both, and Cursor 3.x runs up to eight parallel agents on isolated worktrees, which is the outer-loop behaviour we assumed IDEs would not do.

---

## 2. What nobody does yet

Six gaps. Each is scoped to the products reviewed above.

### Gap 1 — The review artifact is always a diff or a transcript. Nobody assembles a packet.

**Evidence:** Conductor's flow is "review the diff, open a pull request, merge, and archive." Vibe Kanban offers "review diffs and leave inline comments." Nimbalyst offers "inline diff review." Cursor offers accept/reject at file or line level. Claude Code and Codex give a terminal transcript; Codex's GitHub auto-review posts comments *on a diff*. Devin and Factory give a transcript plus a PR.

Not one of them assembles, as a single object: the intent that was requested, the behavioural change (not the textual diff), which checks actually ran and their exit codes, what the agent could **not** verify, and the one decision being asked for. The 2026 supply-chain and audit literature is explicitly asking for this shape — signed attestations recording the model, task specification, allowed tools, and tests behind each change — but no shipping desktop agent tool produces it.

**Confidence:** high for the named products.

### Gap 2 — Agent-to-agent communication exists, but only inside one vendor, ephemerally, and unreviewably.

**Evidence:** Claude Code Agent Teams has a mailbox where "teammates can send messages directly to each other without routing through you or the lead." That is real agent-to-agent traffic. But it is Anthropic-only, lives in a terminal session, is not durable past the session, and the human cannot address a specific teammate mid-flight in a persistent place.

The gap is therefore **not** "agents talking." It is: **a cross-vendor, persistent, human-addressable channel** where a Claude Code agent and a Codex agent hand work to each other and the human interjects in the same surface. Nobody ships that.

**Confidence:** high on Agent Teams' existence; the cross-vendor gap is an absence claim over the reviewed set.

### Gap 3 — An agent cannot file a durable ticket at another agent.

**Evidence:** Vibe Kanban's kanban issues are ones *you* author to plan work. Nimbalyst's kanban is tagging and filtering over sessions. Conductor has no ticketing at all. Claude Code's shared task list is populated by the lead at decomposition time — it is a work queue, not a ticket someone raises when blocked.

Nobody has: a ticket **raised by an agent**, **addressed at** another agent or the human, with an owner, a state, attached evidence, and a life longer than the session. Our `room.ts` already models exactly this (`raisedBy`, `owner`, `state`, `evidence`) and nothing writes to it yet.

**Confidence:** high.

### Gap 4 — "What the agent could not verify" is nobody's output.

Every product surfaces what was done. None surfaces the negative space: which paths went untested, which assumptions were made, which files were touched outside the stated scope, which claim in the summary has no evidence behind it. This is the single highest-value field in a review packet, because it is where a reviewer's attention should go first.

**Confidence:** medium — this is an absence-of-documentation claim. **[assumption]** that none of these products has an undocumented equivalent.

### Gap 5 — The review decision is never bound to a tamper-evident local record.

**Evidence:** Hosted agents (Devin, Factory) keep server-side history you do not own. Local tools keep a scrollback buffer, which is mutable by construction. The 2026 compliance literature is direct that a mutable log is not evidence — regulatory-grade trails require write-once storage and cryptographic signatures. No reviewed desktop agent tool emits a signed, append-only record binding run → checks → human decision.

We have already specified the format (`docs/architecture/receipts.md`) and not built it.

**Confidence:** high on the absence; the compliance framing is from secondary 2026 sources.

### Gap 6 — The category is consolidating, and the local-first, three-OS, outer-loop slot is empty.

**Evidence:** Crystal deprecated in February 2026 in favour of Nimbalyst. Bloop, the company behind Vibe Kanban, shut down on 2026-04-10; Vibe Kanban is now community-maintained under Apache-2.0. Conductor remains macOS-only with a Windows waitlist. JetBrains Air is a macOS-only preview. Windsurf was absorbed into Devin.

A developer on Windows or Linux who runs Claude Code or Codex and wants a maintained multi-agent desktop surface has close to no commercially-supported option. We already build nine installers across three OSes with green CI. **This is our most under-exploited asset and it is a distribution advantage, not a feature.**

**Confidence:** high on each consolidation event; the "no maintained option" conclusion is my inference from them.

---

## 3. The uniqueness thesis

> Every product in this category has made the same two choices: the unit of review is the diff, and the unit of coordination is the human. Docket inverts both. The agents coordinate with each other in a durable, human-readable room that spans vendors — so a Claude Code agent and a Codex agent can hand work to each other and raise tickets at each other, and the human can step into that conversation at any point rather than being the message bus. And the thing the human is asked to review is neither the transcript nor the diff, but an **evidence packet**: the intent that was requested, what behaviour actually changed, which checks ran and what they returned, what the agent could not verify, and the single decision being asked for — sealed with an append-only record of who decided what. All of it on the developer's machine, with their own CLI and their own credentials, on all three desktop operating systems. Scrolling a transcript to decide whether to trust a change is the tax this whole category currently charges its users. We are the only ones treating that tax as the product.

### The three features that express it, ranked

Ranked by differentiation × effort — highest value per unit of effort first.

| # | Feature | Differentiation | Effort | Why this rank |
|---|---|---|---|---|
| **1** | **The evidence packet** — a generated, reviewable artifact per unit of agent work, with an approve / request-changes decision attached | **Highest.** No reviewed product ships anything but a diff or transcript (Gap 1, Gap 4) | High, but bounded: assembly + one new view, no backend | This *is* the thesis. Nothing else matters if this does not land. Every other feature decorates it |
| **2** | **Signed, append-only decision record** (local receipts, v1 profile) | High — Gap 5, and it is the thing that makes the packet credible rather than decorative | **Low-to-medium** — the envelope is already fully specified in `docs/architecture/receipts.md`; needs a local-only profile, not a design | Cheapest credibility in the product. Ranked above the room because it costs a fraction as much and it is what turns "a nice summary screen" into evidence |
| **3** | **Cross-vendor agent-to-agent room with agent-raised tickets** | High but **contested** — Claude Code Agent Teams already half-occupies it inside one vendor (Gap 2) | **Highest.** Requires a message bus over PTY sessions: parsing addressed messages out of agent output and injecting into another agent's stdin. Fragile, and the wrapped CLIs keep changing their output | This is the headline framing in the brief, and I am ranking it third deliberately. It is the most expensive to build, the most fragile to maintain, and the only one of the three a competitor already partly ships. It should follow the packet, not precede it |

**The uncomfortable version of that ranking:** the Discord framing is the part of the pitch that demos best and differentiates least. The evidence packet is the part that differentiates most and demos worst. Build the one that differentiates.

---

## 4. Where we are weakest

Three, stated plainly.

### 1. We are unsigned, and it is cheap to fix — which makes it a choice, not a constraint.

Gatekeeper blocks the macOS DMG. SmartScreen flags the Windows installer as an unrecognised publisher. The `.deb` and `.rpm` are unsigned with no published repository.

The cost of fixing this: Apple Developer Program is **$99/year and includes notarization at no additional fee**. Windows signing via Azure Trusted Signing is **$9.99/month** on the Basic tier (up to 5,000 signatures), now open to individual developers in public preview; a traditional EV certificate is $280–900/year. Note that from 2026-02-23 the CA/B Forum capped code-signing certificate lifetime at 459 days, so renewals are more frequent.

We are asking a developer to right-click-open an unsigned binary that will hold their repository, read their filesystem, and shell out to their credentialed CLI — while selling them a product whose entire thesis is *trust and evidence*. This is the most damaging contradiction in the product, and roughly $220 in year one closes it. Every named competitor is either vendor-signed, first-party, or open-source-and-self-built.

### 2. The thesis is entirely unbuilt, and our docs describe a different product.

What exists in the repo: a team-room shell, per-repository agent roster detection, provider detection, a restricted-PTY session start, a terminal surface, and a `Ticket` type nothing writes to. There is no evidence packet, no agent-to-agent messaging, no receipt implementation, and no review decision surface.

Meanwhile Conductor, Nimbalyst, Vibe Kanban, Cursor, and Zed all ship working parallel-agent workflows today. **Our differentiation is currently 100% documentation** — and per §0, that documentation describes AOS, a model-fleet router we are not building. A new teammate reading this repo cannot determine what the product is.

> **Partly resolved 2026-08-15.** The ranked-#1 feature is built and merged. Docket discovers the checks a repository declares for itself, runs them without constructing a shell string, notices when their definitions were edited since the last commit, reads what changed from Git, finds what else references the changed symbols, and assembles that into a packet with a verdict and ranked findings. Intent is captured and bound to its workspace. 102 tests cover it.
>
> Two of this section's claims therefore no longer hold: the differentiation is no longer only documentation, and the docs no longer describe AOS.
>
> Three claims **do** still hold, and are the honest remainder:
>
> - **Still unsigned.** §4.1 is untouched and is now the oldest open weakness in the product.
> - **No agent-to-agent room, and tickets are still not agent-raised.** Gap 3 is open exactly as written.
> - **No receipt implementation and no decision record.** The packet is assembled and displayed but nothing is sealed, so §3's ranked-#2 feature — the thing that makes the packet evidence rather than a summary screen — has not been started. Gap 5 is open.
>
> A check also still runs with the same reach as the person who launched Docket, which is a weakness this document did not anticipate and which container isolation is meant to close.

### 3. We are wrapping products that are absorbing our layer, and we have no answer for price or discovery.

Claude Code Agent Teams (mailbox, shared tasks, file locks) and Codex subagents (6 concurrent, GA, Smart Approvals) both ship *inside the CLIs we wrap*. Cursor 3.x runs eight parallel agents on isolated worktrees. The coordination layer is being commoditized by the vendors underneath us, on their release cadence, not ours. Docket has to stay valuable on a day when the wrapped CLI ships our roadmap.

At the same time: closed-source, no public repo, unsigned, and distributed only from our own site means near-zero organic discovery — in a category where Conductor is free, Nimbalyst is free for individuals, Vibe Kanban is Apache-2.0, and Goose, Aider, and OpenHands are open source. We have not stated what a developer pays for or why. Guildly, the closest structural analogue, has the same team-room and ticket model we just adopted; our only stated divergence is the review surface, which is the one thing we have not built.

---

## 5. Open contradictions with the product documents

**Added 2026-08-15.** This document and the merged product documents disagree on two points. Both are product decisions, not research findings, so neither is resolved here. They are written down because two documents quietly asserting opposite things is how a repository stops being readable — the failure §0 was about.

### Licensing and business model

This document assumes Docket is **proprietary, closed-source, local-first, with no backend**, and §4.3 treats near-zero organic discovery as a consequence to answer for.

[`PRODUCT.md`](../PRODUCT.md) still carries a business-model table with an open-source Community edition, a hosted Team tier, a self-hosted Enterprise tier, and managed inference. It is labelled a hypothesis requiring customer discovery, but it is the only statement in the repository on the question.

These cannot both be the plan. The decision changes packaging, distribution, the signing budget in §4.1, and whether §4.3's discovery problem is real or self-inflicted. **Nothing else should be built on either assumption until it is settled.**

### Whether Docket ever routes work between models

This document states plainly that we do not pick models, users bring a CLI, and that `model-fleet.md` "has no product left to describe."

[`ROADMAP.md`](../ROADMAP.md) keeps the model fleet, router, and capability certification, sequenced at **Phase 4** — after the gate is trusted — on the reasoning that routing unverified work distributes the review problem rather than solving it.

The practical distance between these is smaller than it reads: both agree nothing about routing happens next, and Phase 4 is far enough out that it constrains nothing today. The disagreement is whether it is deferred or abandoned. It matters for what `model-fleet.md` and `system.md` are *for* — a design for later, or dead weight a reader has to route around.

**A note on the third apparent conflict, which is not one.** This document ranks the evidence packet first and the agent-to-agent room third, with "build the one that differentiates." The merged roadmap sequences the gate first and defers the team-room surface. Those are the same instruction reached independently from different competitive sets, which is the strongest signal in either document.

---

## Research limitations

- Point-in-time review of public material on 2026-08-14. This category is consolidating fast; three of the named competitors changed status in the six months before this date.
- Absence claims are scoped to public documentation. A product may have an undocumented capability.
- Pricing for Factory, and signing status for Conductor and Nimbalyst, were not directly verified and are marked as assumptions in the matrix.
- Competitor marketing pages (including Nimbalyst's comparison posts) were used for feature enumeration only; their comparative judgements were not adopted.
- No competitor product was installed or run. No performance claim here is benchmarked.
- **Revision policy (2026-08-15):** competitor findings are frozen at the research date. Only claims about our own repository are updated, and each correction is marked inline rather than applied silently, so the document still shows what was true when the conclusions were drawn.
