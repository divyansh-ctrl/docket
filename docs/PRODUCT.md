# Docket product definition

**Status:** working product brief  
**Date:** 2026-08-13  
**Name:** Docket is a working name, adopted in place of the earlier codename AOS. Trademark and domain screening are not complete.

## Product in one sentence

Docket is an open, auditable control plane that assigns bounded engineering work to the cheapest verified local or hosted model, proves what happened, and escalates only the decisions that need human judgment.

## The outcome

A software team should be able to increase useful agent throughput without increasing review backlog, security ambiguity, or surprise spend. The dashboard should answer four questions in seconds:

1. What outcome is being attempted?
2. Which model and tools are acting on which data, and why?
3. What evidence says the result is safe to accept?
4. What, exactly, needs a human decision now?

The primary object is a **work unit**, not an agent persona. Models are replaceable workers; policies, evidence, and durable state belong to the system.

## Terminology

- **Controller:** the host agent or Docket service that plans and coordinates work. Installing Docket does not silently replace this model.
- **Work unit:** a bounded task with inputs, allowed effects, risk, budget, acceptance criteria, and a terminal outcome.
- **Worker:** the model and execution environment assigned to a work unit.
- **Verifier:** deterministic checks and, when policy requires it, an independently selected reviewer model.
- **Receipt:** append-only evidence of routing, execution, artifacts, checks, cost, latency, retries, and decisions.
- **Open-weight:** weights are available under stated terms. This does not imply the complete system satisfies the [Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition).

## Ideal customers

### Primary ICP

Engineering organizations with roughly 10–200 developers that already use coding agents and now face a coordination or trust bottleneck. The initial buyer is a head of engineering, platform lead, or AI enablement lead; the daily users are tech leads, reviewers, and developers.

High-fit signals:

- more agent-generated changes are waiting for review than humans can safely inspect;
- two or more coding agents/providers are already in use;
- private repositories or customer data make model placement important;
- the team needs cost attribution, approval policy, or audit evidence;
- background runs occasionally duplicate work, stall, or exceed intended scope.

### Secondary ICPs

- power users running a local and cloud model fleet;
- consultancies managing parallel delivery across customer repositories;
- regulated or air-gapped teams that require self-hosted inference and evidence;
- open-source maintainers who need to compress review without lowering contribution standards.

### Not the initial customer

Teams seeking a general-purpose virtual office, a no-code autonomous company, or a consumer chatbot. Docket starts with software delivery because the artifacts and acceptance checks are unusually measurable.

## Jobs to be done

| When… | Help me… | So I can… |
|---|---|---|
| a request mixes architecture, code, tests, and documentation | split and route each part by difficulty and risk | avoid paying a frontier model for mechanical work without compromising hard work |
| several agents run in parallel | see ownership, dependencies, health, and cancellation state | prevent duplicate, orphaned, or conflicting work |
| an agent proposes a change | receive a compact, evidence-backed review packet | approve or reject it quickly and responsibly |
| source code cannot leave my environment | enforce locality, network, and credential policy | use agents without making a policy exception |
| a model or provider changes | re-certify its capabilities and compare outcomes | switch providers without betting the workflow on marketing claims |
| spend or latency rises | understand the cost of accepted outcomes, retries, and verification | tune policy based on real total cost rather than token price alone |

## Problems worth solving

### 1. Generation is faster than responsible review

The 2025 Stack Overflow survey reports more developers distrust AI output accuracy than trust it, while “almost right” answers and time spent debugging AI-generated code remain common ([survey](https://survey.stackoverflow.co/2025/ai)). DORA describes AI productivity gains being reallocated to verification and reports tensions between adoption, trust, throughput, and stability ([DORA analysis](https://dora.dev/insights/balancing-ai-tensions/)). These are broad signals, not proof that every team has the same outcome.

**Product response:** optimize reviewer minutes per accepted change, not lines of code or simultaneous agents.

### 2. Parallel agents fail as distributed systems

Public issue reports describe duplicate workers, silent redispatch, hangs, and absent cancellation or timeout behavior ([Claude Code duplicate-worker report](https://github.com/anthropics/claude-code/issues/55586), [LangGraph redispatch report](https://github.com/langchain-ai/langgraph/issues/7417), [Claude Code timeout report](https://github.com/anthropics/claude-code/issues/61405)). Issue reports are anecdotal and may be version-specific, but the failure classes are predictable.

**Product response:** event-sourced work-unit state, leases, heartbeats, idempotency keys, bounded retries, spawn-depth limits, and cancellation propagation.

### 3. Context and retries hide the true cost

Users report context bloat, parent-context pollution, and recursive delegation consuming unexpectedly large token volumes ([Cline context report](https://github.com/cline/cline/issues/4389), [Claude Code subagent context report](https://github.com/anthropics/claude-code/issues/16209), [recursive delegation report](https://github.com/anthropics/claude-code/issues/68619)).

**Product response:** scoped context packets with provenance, explicit retry budgets, and routing that minimizes expected total cost: inference + validation + retries + escalation.

### 4. A Git branch is not a security boundary

Git worktrees are useful for change isolation, but they do not constrain process access, network egress, or credentials. NIST highlights prompt injection as a central agent-security problem ([NIST](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition)), and OWASP documents MCP tool-poisoning and related controls ([attack](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning), [security cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html)).

**Product response:** worktree plus container or microVM, read-only inputs, disposable writes, default-deny network, scoped credentials, out-of-band approvals, and receipts stored beyond the worker's write permissions.

### 5. “Supports local models” does not mean “reliably delegates to them”

OpenHands explicitly documents limitations and configuration work for local models ([documentation](https://docs.openhands.dev/openhands/usage/llms/local-llms)). Model quality also varies by task, quantization, context, serving stack, and hardware.

**Product response:** certify every model/end-point pair on the customer's own hardware, then route only tasks for which it has demonstrated the required capability.

## Product thesis and differentiated wedge

Model routing, agent chat, worktrees, and local inference are each becoming common. The wedge is their integration into a trust and control loop:

```text
request
  → bounded work units
  → policy + certified capability route
  → isolated execution
  → deterministic checks
  → independent verification when warranted
  → compressed human review
  → immutable receipt
  → outcome-informed routing
```

No reviewed product was found to publicly document this entire loop as one user-owned, self-hostable system. That is a research finding as of the date above, not a claim that no private or newly released product has it.

### The ten product primitives

1. **Model fleet registry:** endpoints, model identity, locality, license, data policy, context limits, price, and health.
2. **Capability certification:** repeatable tool-use, patching, schema, test, latency, and stability probes.
3. **Policy router:** complexity, risk, privacy, budget, latency, and verified historical outcomes determine eligibility.
4. **Durable work graph:** dependencies, leases, heartbeats, idempotency, retries, timeouts, and cancellation.
5. **Scoped context:** the smallest sufficient packet, with source lineage and explicit write targets.
6. **Execution isolation:** one disposable environment, network policy, and credential lease per work unit.
7. **Verification pipeline:** deterministic checks first; independent model review only when its expected value is positive.
8. **Proof-of-work receipts:** requested and provider-reported model, context/artifact fingerprints, actions, tests, cost, latency, and route changes.
9. **Review compression:** intent-versus-diff, invariant map, risk hotspots, evidence, assumptions, and focused questions.
10. **Outcome learning:** acceptance, rework, regressions, cost, and latency update routing policy without training on private source by default.

## Integration model

### Advisory mode

A skill or MCP tool classifies a task and recommends a worker. This is easy to adopt but cannot force the host agent to invoke the tool or change its primary model.

### Delegated execution mode — MVP

The host submits a bounded work unit to Docket. Docket selects the eligible model, executes it, validates the result, and returns artifacts plus a receipt. This provides mechanical enforcement for delegated work while leaving the host/controller unchanged.

### Gateway mode — optional and provider-dependent

Teams may direct compatible provider traffic through a Docket proxy for policy and accounting. This is not a universal way to switch a host model: client compatibility, model-selection APIs, provider terms, and failure behavior must be evaluated per integration.

## MVP scope

### Must ship

- local repository import and GitHub-compatible remote metadata;
- endpoint discovery for local `llama.cpp`/Ollama and OpenAI-compatible vLLM or hosted BYOK providers;
- signed model identity plus capability certification suite;
- work-unit schema with risk, locality, budget, deadline, acceptance checks, and allowed effects;
- policy router with private, economy, balanced, and quality presets plus inspectable reasons;
- durable queue with idempotency, leases, heartbeats, timeouts, retry budgets, and cancellation;
- Git worktree plus container isolation, default-deny egress, and short-lived scoped secrets;
- deterministic test/lint/build/security hooks and an optional independent reviewer route;
- append-only receipt and artifact store outside the worker-writable workspace;
- dashboard for queue, intervention, evidence, fleet health, spend, and policy;
- compressed approval packet and explicit approve, request-changes, retry, and stop controls;
- MCP/CLI/API adapters that keep the orchestration kernel host-neutral.

### MVP model strategy

Start with a small, testable portfolio rather than an enormous catalog:

- a laptop/private pool such as `gpt-oss-20b`, published under Apache 2.0 and described as runnable with roughly 16 GB of memory ([OpenAI release](https://openai.com/index/introducing-gpt-oss/));
- a balanced general pool such as Qwen3.6-35B-A3B, whose model card publishes Apache 2.0 terms and long-context details ([model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8));
- a coding/review pool such as Qwen3-Coder-Next, also documented under Apache 2.0 ([model card](https://huggingface.co/Qwen/Qwen3-Coder-Next-FP8));
- an optional hosted escalation pool selected by customer policy.

These are candidates to benchmark, not permanent defaults or endorsements. Quantization, server, hardware, prompt format, license, and private evaluations determine actual eligibility.

### Explicit non-goals

- silently replacing the primary model inside Codex, Claude Code, or another host;
- claiming an MCP connection alone guarantees invocation or routing;
- building another IDE, chat app, or decorative virtual office;
- training a foundation model in the first product phase;
- autonomously merging high-risk code without policy and human approval;
- sharing one unbounded “team memory” across every agent;
- treating a branch as sufficient sandboxing;
- marking every downloadable model “open source”;
- optimizing token price while ignoring retries, verification, and human review cost;
- supporting every provider before the core outcome is proven.

## Experience principles

1. **Attention, not activity.** Default views show blocked decisions and risk, not a firehose of agent prose.
2. **Evidence adjacent to action.** Approval controls sit beside the receipt and relevant diff, never in a disconnected inbox.
3. **Status is textual and causal.** Color may reinforce “waiting for approval,” but never carries meaning alone.
4. **Every automatic decision is inspectable.** Show the eligible set, rejected candidates, route reason, and route changes.
5. **Stop means stop.** Cancellation propagates to workers, tools, and child work units and is visible in the receipt.
6. **Simulation is labeled.** Prototype and demo data must never imply a real model ran.
7. **Progressive disclosure.** Leads get a fleet view; reviewers get a narrow evidence packet; operators can drill into traces.

## Security and privacy baseline

- deny network egress unless an allowlist is attached to the work unit;
- mount source read-only and copy only required context into the disposable workspace;
- use short-lived, scope-limited credentials from a broker; never place durable secrets in prompts;
- keep approval policy and append-only receipts outside the agent-writable filesystem;
- record tool manifest hashes to detect MCP tool-description drift or poisoning;
- bind every effect to an identity, work unit, policy version, and idempotency key;
- support data-residency and local-only policies at the router, not as prompt instructions;
- redact secrets before model calls and observability export;
- make replay possible from fingerprints and events without retaining prohibited content.

## Business model hypothesis

The business model should align revenue with control and collaboration, not with marking up customer tokens.

| Edition | Proposed scope | Commercial hypothesis |
|---|---|---|
| Community | single-user local control plane, core adapters, receipts, basic UI | open-source license; free |
| Team | hosted coordination, shared policy, review queues, retention, managed updates | per active engineering seat with included run coordination |
| Enterprise | self-hosted control plane, SSO/SCIM, RBAC, private networking, compliance exports, support | annual platform contract |
| Managed inference | optional certified endpoints with transparent model and compute pricing | pass-through compute plus explicit operations fee |

The exact source license, feature boundary, and pricing require customer discovery. Portability of receipts and provider configuration should remain available in every edition to avoid lock-in.

## Success metrics

### North star

**Median human review minutes per accepted, non-trivial work unit**, segmented by risk and repository.

### Quality and trust

- first-pass acceptance rate after deterministic validation;
- escaped regression rate within 7 and 30 days;
- percentage of approvals with complete receipt and required evidence;
- reviewer override rate and reason;
- false-negative and false-positive rate for risk and escalation policy.

### Routing and operations

- total cost per accepted work unit, including retries and verification;
- percentage of eligible work completed locally;
- escalation rate from cheap to stronger models and success after escalation;
- duplicate execution rate;
- orphaned work-unit rate;
- p95 cancellation propagation time;
- p50/p95 queue-to-validated-result time;
- model certification failure and drift-detection rate.

### Product

- time from install to first validated work unit;
- weekly teams with at least three accepted work units;
- 4-week retained teams;
- review packets opened-to-decision conversion;
- percentage of users who inspect a receipt or route reason before approval.

### MVP exit targets

Targets are hypotheses to calibrate with design partners:

- zero duplicate side-effecting executions in a 1,000-work-unit soak test;
- p95 cancellation propagation under 10 seconds for supported executors;
- 100% receipt completion for terminal work-unit states;
- at least 30% reduction in median review time on a frozen customer task set without higher escaped regressions;
- at least 25% lower total model spend than an agreed quality-equivalent single-frontier-model baseline;
- first validated local work unit within 20 minutes of installation for a supported workstation.

## Critical hypotheses to test

1. Teams will trust outcome-based routing if eligibility and receipts are inspectable.
2. Review compression reduces time without hiding material risk.
3. Capability certification predicts real repository performance better than published benchmark scores alone.
4. Local/private execution is a buying driver, not merely a preference.
5. Buyers prefer predictable platform pricing over token markup.
6. The smallest valuable unit is a repository work unit, not a persistent named agent.
7. A controller-neutral MCP/CLI/API surface is enough to integrate into existing Codex, Claude Code, and terminal workflows.

## Decision policy

Do not advance a feature because it makes the dashboard look more autonomous. Advance it when it measurably improves accepted outcomes, reviewer time, safety, portability, or total cost.
