# Docket product definition

**Status:** working product brief
**Date:** 2026-08-13
**Revised:** 2026-08-14 — repositioned from an agent operations system to a merge gate. See [competitive position](research/competitive-position.md).
**Name:** Docket is a working name, adopted in place of the earlier codename AOS. Trademark and domain screening are not complete.

## Product in one sentence

Docket is a merge gate for agent-written code: it runs the coding agent a team already has inside a boundary that agent cannot escape, verifies the result with the repository's own checks, and hands a human the evidence needed to accept or reject the change.

## The outcome

A team should be able to accept more agent-written change without accepting more risk, and without a reviewer having to reconstruct what happened from a diff. The gate answers four questions in seconds:

1. What was this change supposed to do, and what did it actually do?
2. What evidence says it works — and did those checks really run?
3. What else does it touch?
4. What is the one decision left for me?

The primary object is a **work unit**, not an agent persona. Agents are replaceable; the evidence and the boundary belong to the system.

## Why this framing, and not the other one

An earlier version of this brief led with model routing, a user-owned model fleet, and capability certification. That design is still in the architecture documents and is still intended. It is no longer the lead, for three reasons established in the [competitive position review](research/competitive-position.md):

- **The governance layer is taken.** Paperclip ships org charts, tickets, per-agent budgets, and an append-only history under MIT, at scale. "We have tickets and immutable history" is now a check-box, not a wedge.
- **The team-room UX is taken and free.** Guildly ships a Slack-shaped agent workspace with a plan-approval step and five integrations, on three platforms, at no cost.
- **Routing without verification is not valuable.** Sending unverified work to a cheaper model distributes the review problem rather than solving it. Verification has to come first or the routing has nothing to optimize against.

What remains unclaimed is the gate: local, agent-neutral, isolating work *while it runs*, verifying it *before* it reaches a pull request.

## Terminology

- **Work unit:** a bounded task with inputs, allowed effects, risk, budget, acceptance criteria, and a terminal outcome.
- **Gate:** the boundary plus checks a work unit must pass before a human is asked to accept it.
- **Evidence packet:** what the gate produces — intent versus diff, real check output, blast radius, claim versus behaviour, and the open decision.
- **Agent:** the coding CLI doing the generating. Docket supplies neither the model nor the prompt loop.
- **Verifier:** deterministic checks first; an independently selected reviewer model only when its expected value is positive.
- **Receipt:** append-only evidence of execution, artifacts, checks, cost, latency, retries, and decisions.
- **Open-weight:** weights are available under stated terms. This does not imply the complete system satisfies the [Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition).

## Ideal customers

### Primary ICP

Engineering organizations with roughly 10–200 developers that already use coding agents and now face a review or trust bottleneck. The initial buyer is a head of engineering, platform lead, or AI enablement lead; the daily users are tech leads and reviewers.

High-fit signals:

- more agent-generated changes are waiting for review than humans can safely inspect;
- one or more coding agents are already in daily use;
- private repositories or customer data make execution locality important;
- the team needs audit evidence or approval policy;
- someone has already been burned by a confidently wrong agent change.

### Secondary ICPs

- consultancies managing parallel delivery across customer repositories;
- regulated or air-gapped teams that require local execution and evidence;
- open-source maintainers who need to compress review without lowering contribution standards;
- power users running a local and cloud model fleet.

### Not the initial customer

Teams seeking a general-purpose virtual office, a no-code autonomous company, or a consumer chatbot. Docket starts with software delivery because acceptance checks are unusually measurable there.

## Jobs to be done

| When… | Help me… | So I can… |
|---|---|---|
| an agent proposes a change | receive a compact, evidence-backed packet | approve or reject it quickly and responsibly |
| an agent says it ran the tests | see the actual command output | stop taking its word for it |
| a change touches shared code | see everything that calls it | judge blast radius before merging, not after |
| agents run against my repository | contain what they can reach and change | use them without making a policy exception |
| source code cannot leave my environment | keep execution and evidence local | adopt agents inside an existing data policy |
| a request mixes trivial and hard work | split and route each part by difficulty and risk | avoid paying a frontier model for mechanical work *(later phase)* |

## Problems worth solving

### 1. Generation is faster than responsible review

The 2025 Stack Overflow survey reports more developers distrust AI output accuracy than trust it, while "almost right" answers and time spent debugging AI-generated code remain common ([survey](https://survey.stackoverflow.co/2025/ai)). DORA describes AI productivity gains being reallocated to verification ([DORA analysis](https://dora.dev/insights/balancing-ai-tensions/)). These are broad signals, not proof that every team has the same outcome.

**Product response:** optimize reviewer minutes per accepted change, not lines of code or simultaneous agents.

### 2. An agent's self-report is not evidence

Agents summarize their own work, including work they did not finish and tests they did not run. Every competing product's "QA agent" inherits this problem, because it asks a model to grade a model.

**Product response:** Docket runs the repository's own checks itself and attaches the real output. The reviewer model, when used, reasons over verified results rather than over claims.

### 3. A Git branch is not a security boundary

Worktrees isolate *changes*, not *processes*. They do not constrain network egress, credential access, or what a command can read. NIST treats prompt injection as a structural agent risk ([NIST](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition)), and OWASP documents MCP tool poisoning ([attack](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning), [cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html)).

**Product response:** worktree plus container, read-only source, disposable writes, default-deny egress, scoped credentials, and receipts stored outside the worker's write scope.

### 4. The orchestrator is itself an attack surface

In August 2026, the most-adopted agent orchestrator disclosed three flaws, the most severe an unauthenticated remote code execution scoring 10.0, whose root cause was that agent configuration could become executable behaviour, compounded by a localhost trust model that treated any local request as an instance administrator ([disclosure](https://thehackernews.com/2026/08/paperclip-ai-flaws-let-attackers-run.html)). They were patched promptly; the architectural class is the lesson.

**Product response:** no generic shell or spawn API, no local HTTP listener, one typed IPC surface, allowlisted commands with fixed argument arrays, and capability fuses. See [security architecture](architecture/security.md) and [ADR-002](architecture/adr-002-desktop-runtime.md).

### 5. Parallel agents fail as distributed systems

Public issue reports describe duplicate workers, silent redispatch, hangs, and absent cancellation ([Claude Code](https://github.com/anthropics/claude-code/issues/55586), [LangGraph](https://github.com/langchain-ai/langgraph/issues/7417), [timeout report](https://github.com/anthropics/claude-code/issues/61405)). Issue reports are anecdotal, but the failure classes are predictable.

**Product response:** event-sourced work-unit state, leases, heartbeats, idempotency keys, bounded retries, and cancellation propagation.

### 6. Runaway cost

Recursive delegation and retry loops make headline token pricing meaningless; one public report describes more than 1.2 million tokens from recursive delegation ([issue](https://github.com/anthropics/claude-code/issues/68619)).

**Product response:** expose expected total cost per accepted outcome, with hard budgets for retries, children, and verification.

## Product thesis

```text
request
  → bounded work unit
  → isolated execution (worktree + container, default-deny egress)
  → deterministic checks, run by Docket
  → independent review only when warranted
  → evidence packet
  → human merge decision
  → immutable receipt
```

Routing, the model fleet, and capability certification attach to this loop later, at the point marked *isolated execution*. They are an optimization of a loop that must first exist and be trusted.

## Primitives, in build order

### The gate — what makes the product

1. **Evidence packet:** intent versus diff, real check output, blast radius, claim versus behaviour, and the explicit open decision.
2. **Verification pipeline:** the repository's own test, lint, and build commands executed by Docket inside the unit's boundary, with failures reported as failures.
3. **Execution isolation:** one disposable environment, network policy, and credential lease per work unit.
4. **Durable work graph:** dependencies, leases, heartbeats, idempotency, retries, timeouts, and cancellation.
5. **Proof-of-work receipts:** actions, checks, artifacts, cost, latency, and decisions, stored append-only outside the worker-writable workspace.

### The fleet — later, and only once the gate is trusted

6. **Scoped context:** the smallest sufficient packet, with source lineage and explicit write targets.
7. **Model fleet registry:** endpoints, model identity, locality, license, data policy, context limits, price, and health.
8. **Capability certification:** repeatable tool-use, patching, schema, test, latency, and stability probes.
9. **Policy router:** complexity, risk, privacy, budget, latency, and verified historical outcomes determine eligibility.
10. **Outcome learning:** acceptance, rework, regressions, cost, and latency update routing policy without training on private source by default.

## Integration model

### Host-neutral gate — the MVP

Docket runs the user's installed agent CLI against an authorized workspace, inside the boundary, and gates the result. The host stays the controller. This works today with Codex and Claude Code and requires no cooperation from either vendor.

### Delegated execution — later

A host submits a bounded work unit to Docket, which executes, validates, and returns artifacts plus a receipt. This gives mechanical enforcement for delegated work while leaving the host unchanged.

### Gateway mode — optional and provider-dependent

Teams may direct compatible provider traffic through a Docket proxy for policy and accounting. This is not a universal way to switch a host model: client compatibility, model-selection APIs, provider terms, and failure behaviour must be evaluated per integration.

## MVP scope

The MVP is the gate for **one agent, one repository, one work unit at a time**. Breadth is explicitly deferred.

### Must ship

- workspace authorization and repository import;
- work-unit schema with acceptance checks, allowed effects, and budget;
- disposable Git worktree plus container isolation with default-deny egress;
- deterministic test, lint, and build execution with captured real output;
- blast-radius analysis for changed symbols;
- the evidence packet, and a review surface where approve, request-changes, retry, and stop sit beside it;
- append-only receipt and artifact store outside the worker-writable workspace;
- cancellation that propagates to the agent process and is visible in the receipt;
- the existing trust boundary, kept tested.

### Deliberately not in the MVP

- model fleet, router, and capability certification;
- multi-agent parallelism and team coordination surfaces;
- hosted or team-shared coordination;
- integrations with GitHub, Slack, Linear, Notion, or Drive;
- an org chart, budgets per persona, or heartbeat scheduling.

### Explicit non-goals

- becoming another agent team room, office, or org chart — that surface is taken, free, and better resourced;
- becoming a general AI code reviewer competing with dedicated pull-request reviewers;
- silently replacing the primary model inside Codex, Claude Code, or another host;
- claiming an MCP connection alone guarantees invocation or routing;
- building another IDE or chat app;
- autonomously merging high-risk code without policy and human approval;
- sharing one unbounded "team memory" across every agent;
- treating a branch as sufficient sandboxing;
- marking every downloadable model "open source";
- optimizing token price while ignoring retries, verification, and human review cost.

## Experience principles

1. **Attention, not activity.** Default views show blocked decisions and risk, not a firehose of agent prose.
2. **Evidence adjacent to action.** Approval controls sit beside the evidence and the relevant diff, never in a disconnected inbox.
3. **Checks are quoted, not summarized.** Real command output is shown, because a summary of a test result is the thing being replaced.
4. **Status is textual and causal.** Color may reinforce "waiting for approval," but never carries meaning alone.
5. **Stop means stop.** Cancellation propagates to the agent, its tools, and child units, and is visible in the receipt.
6. **Nothing simulated ships in the product.** A demo pipeline inside a product whose pitch is proof undermines the pitch.
7. **Progressive disclosure.** Reviewers get a narrow evidence packet; operators can drill into traces.

## Security and privacy baseline

- deny network egress unless an allowlist is attached to the work unit;
- mount source read-only and copy only required context into the disposable workspace;
- use short-lived, scope-limited credentials from a broker; never place durable secrets in prompts;
- keep approval policy and append-only receipts outside the agent-writable filesystem;
- record tool manifest hashes to detect MCP tool-description drift or poisoning;
- bind every effect to an identity, work unit, policy version, and idempotency key;
- support data-residency and local-only policies at the boundary, not as prompt instructions;
- redact secrets before model calls and observability export;
- expose no local network listener, and accept no configuration that resolves to an executable command.

## Business model hypothesis

Revenue should align with control and collaboration, not with marking up customer tokens.

| Edition | Proposed scope | Commercial hypothesis |
|---|---|---|
| Community | single-user local gate, agent adapters, receipts, review surface | open-source license; free |
| Team | shared policy, review queues, retention, managed updates | per active engineering seat |
| Enterprise | self-hosted control plane, SSO/SCIM, RBAC, private networking, compliance exports, support | annual platform contract |
| Managed inference | optional certified endpoints with transparent model and compute pricing | pass-through compute plus operations fee |

The exact source license, feature boundary, and pricing require customer discovery. Receipt and configuration portability should remain in every edition to avoid lock-in.

## Success metrics

### North star

**Median human review minutes per accepted, non-trivial work unit**, segmented by risk and repository.

### Quality and trust

- first-pass acceptance rate after deterministic validation;
- escaped regression rate within 7 and 30 days;
- percentage of approvals with a complete evidence packet;
- reviewer override rate and reason;
- rate at which a check the agent claimed to run had not actually run.

### Operations

- duplicate execution rate;
- orphaned work-unit rate;
- p95 cancellation propagation time;
- p50/p95 queue-to-validated-result time;
- total cost per accepted work unit, including retries and verification.

### Product

- time from install to first gated work unit;
- weekly teams with at least three accepted work units;
- 4-week retained teams;
- percentage of users who open the evidence packet before approving.

### MVP exit targets

Hypotheses to calibrate with design partners:

- 100% receipt completion for terminal work-unit states;
- zero duplicate side-effecting executions in a 1,000-work-unit soak test;
- p95 cancellation propagation under 10 seconds;
- at least 30% reduction in median review time on a frozen customer task set without higher escaped regressions;
- first gated work unit within 20 minutes of installation.

## Critical hypotheses to test

1. Reviewers will trust an evidence packet enough to spend less time on the diff.
2. Review compression reduces time without hiding material risk.
3. Independently executed checks catch a material rate of agent self-reporting errors.
4. Local execution and evidence are a buying driver, not merely a preference.
5. Teams will adopt a gate that sits beside their existing agent rather than replacing it.
6. The smallest valuable unit is a repository work unit, not a persistent named agent.
7. Buyers prefer predictable platform pricing over token markup.

## Decision policy

Do not advance a feature because it makes the product look more autonomous, or because a competitor has it. Advance it when it measurably improves accepted outcomes, reviewer time, safety, portability, or total cost.
