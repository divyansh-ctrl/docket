# Docket delivery roadmap

**Status:** outcome-gated proposal
**Date:** 2026-08-13
**Revised:** 2026-08-14 — resequenced gate-first. The model fleet, router, and capability certification moved from Phase 1 to Phase 4. See [competitive position](research/competitive-position.md) and [PRODUCT.md](PRODUCT.md).

This roadmap is organized around risk retirement, not feature volume. Dates should be assigned only after two design partners supply representative repositories, policies, and frozen evaluation tasks.

## Product principles

- Verify before routing. A cheaper model applied to unverified work distributes the review problem rather than solving it.
- Prove one safely accepted outcome before adding a second agent, a second model, or a second human.
- Treat orchestration as a distributed system from the first executable prototype.
- Make cancellation, evidence, and data policy part of the work-unit contract.
- Prefer deterministic checks over model opinions, and run those checks rather than believing a report of them.
- Measure reviewer time and escaped defects, not generated tokens.
- Keep provider and host adapters replaceable; Docket supplies neither the model nor the prompt loop.
- Label hypotheses honestly, and ship nothing simulated inside the product.

## Where the build actually is

Stated plainly, because the phases below are meaningless without it.

**Delivered:** Phase 0 in full, plus parts of Phase 1's host surface that were built ahead of sequence — provider detection, provider-owned login in a restricted PTY, workspace authorization and validation, a real controller session, per-repository agent-file generation, subagent activity from the CLI's own hooks, and the desktop trust boundary with tests.

**Delivered since:** the first gate primitives. Check discovery from the repository's own manifest, drift detection against the committed declarations, real execution with true output and process-group cancellation, the evidence packet with a stated intent, and a container executor used when a runtime is available — with a fail-closed setting that refuses to run rather than fall back to the host.

**Not started:** the receipt, routing, the model fleet, and capability certification.

The contained path is exercised for real on every push: the Linux CI job has a container runtime, so a check is executed inside the image with no network and every capability dropped, and the suite asserts the output came back from Debian rather than from the host. It had been running there unnoticed for two merges — the discovery came from a test that asserted the host argument vector and failed on the one runner that has Docker. A Git worktree remains [not a security boundary](architecture/security.md), which is the whole reason the container exists.

The nearest-term risk is not that Docket lacks features. It is that Docket's surface currently resembles products that are free and better resourced, while the part that would differentiate it is unbuilt.

## Phase 0 — Product and interaction proof

**Goal:** make the proposed control loop understandable before building the runtime.
**Status:** complete, with one revision.

### Deliverables

- original interactive dashboard prototype with simulated queue, receipt, risk, budget, and approval states;
- documented Guildly teardown and market landscape;
- work-unit, receipt, policy, and event vocabulary;
- competitive position review establishing the gate as the unclaimed wedge;
- clickable end-to-end story: request → isolated work → validation → human decision.

### Exit criteria

- five target users can explain what ran and what needs their decision after a five-minute walkthrough;
- no participant believes the prototype ran a real worker or changed the host model;
- at least three design partners agree to provide anonymized workflow data and a frozen task suite;
- top three evidence-packet fields are consistent across interviews.

## Phase 1 — The gate

**Goal:** take one work unit, run one installed agent against one repository inside a real boundary, and produce evidence a reviewer trusts more than the agent's own summary.

This is the whole product. Nothing below it matters until it is true.

### Isolation

- repository import and disposable Git worktree;
- container executor with read-only source, constrained writable workspace, resource limits, and default-deny egress;
- short-lived, scope-limited credentials; no durable secret reachable from the agent process;
- cancellation that propagates to the agent, its children, and its tools.

Adopt existing prior art (`container-use`, `packnplay`) rather than rebuilding a container runtime. Docker must be optional, not required — a hard Docker Desktop dependency is a named weakness of the closest comparable product.

### Verification

- discover and run the repository's own test, lint, typecheck, and build commands inside the unit's boundary;
- capture true output; report a failure as a failure;
- patch-scope and secret-detection checks;
- detect the divergence case: a check the agent reported as passing that did not run, or did not pass.

### Evidence

- evidence packet: intent versus diff, real check output, blast radius for changed symbols, agent claim versus observed behaviour, and the explicit open decision;
- append-only receipt and artifact store outside worker write scope;
- approve, request-changes, retry, and stop, sitting beside the evidence.

### Durability

- SQLite event log with schema versioning;
- work-unit state machine with idempotency key, lease, heartbeat, deadline, and retry budget.

### Exit criteria

- every terminal work unit produces a complete evidence packet;
- **Docket detects and surfaces at least one real case of an agent reporting a check it did not actually run** — this is the product's reason to exist, and it must be demonstrated, not asserted;
- check results shown in the packet reproduce exactly when re-run independently;
- no network egress from a work unit without an attached allowlist, verified by test;
- 1,000-work-unit fault-injection soak with zero duplicate side-effecting executions;
- p95 cancellation propagation below 10 seconds;
- clean recovery after controller restart, agent crash, lost heartbeat, and duplicate queue delivery;
- first gated work unit within 20 minutes on a documented supported workstation;
- no durable credential available inside agent prompts or files.

## Phase 2 — Review-value beta

**Goal:** demonstrate that the gate lowers review time without lowering quality.

### Deliverables

- mixed-request decomposition into typed, dependency-aware work units;
- risk classifier with visible reasons and human override;
- independent verifier route, kept separate from the agent's context, invoked only when its expected value is positive;
- evidence packet extended with invariant map, assumptions, reviewer disagreement, and exact open questions;
- review surface backed by real event streams, replacing all simulated data;
- GitHub-compatible pull-request export with the linked receipt;
- MCP, CLI, and API adapters for host-neutral delegated execution;
- OpenTelemetry-compatible traces with content redaction controls.

### Evaluation

- frozen task suites from at least three design partners;
- randomized comparison with each team's current agent workflow;
- blind review samples for correctness and hidden-risk detection;
- cost model including inference, validation, retries, and measured human review time.

### Exit criteria

- at least 30% lower median review minutes on non-trivial accepted work units;
- no statistically meaningful increase in escaped regression rate in the measured cohort;
- reviewers open the evidence packet before approving in at least 80% of accepted units;
- measurable rate of agent self-reporting errors caught by the gate, published with methodology;
- less than 1% orphaned or indeterminate work units, with every case recoverable from the event log;
- ten weekly active design-partner teams and four-week retention above 60%.

## Phase 3 — Team and security readiness

**Goal:** make the gate credible for production repositories and multiple humans.

### Identity and collaboration

- organizations, projects, roles, scoped service accounts, and least-privilege RBAC;
- SSO/OIDC, followed by SCIM when demanded by signed customers;
- ownership, mentions, approvals, handoffs, decision records, due times, and incident escalation;
- policy-as-code with versioned review and rollback;
- signed receipt export and retention policy.

### Containment

- Kubernetes executor with gVisor-class isolation for standard workloads;
- Firecracker-class microVM option for high-assurance work;
- egress allowlists, dependency proxy, DNS logging, and per-work-unit network receipts;
- short-lived credential broker with repository, tool, path, and operation scopes;
- tool-manifest signing and drift detection for MCP servers;
- approval service outside model context and worker write access;
- secret redaction and customer-controlled telemetry sinks.

### Reliability

- high-availability scheduler and queue;
- multi-region control-plane recovery without cross-residency content movement;
- backpressure, quotas, circuit breakers, and provider failover policy;
- replay tooling that uses event and artifact fingerprints without retaining prohibited prompt content;
- SLO dashboards and operator runbooks.

### Exit criteria

- independent threat model and penetration test completed with critical findings resolved;
- no configuration path allows a file or API input to become an executed command, verified by test and review;
- disaster-recovery exercise meets defined RPO/RTO;
- audit demonstrates every effect is attributable to an identity, policy, work unit, and receipt;
- tenant-isolation and authorization tests cover all supported effect paths;
- three teams run Docket on production repositories for eight weeks under an approved security review.

## Phase 4 — Model fleet, routing, and outcome learning

**Goal:** once the gate is trusted, make the work cheaper by routing each unit to the least expensive model that has proven it can do the job — and let real outcomes improve that choice.

Moved here from Phase 1 on 2026-08-14. Routing is an optimization of a verified loop. Attempted earlier, it optimizes a number nobody trusts.

### Model fleet

- adapters for `llama.cpp` and one OpenAI-compatible endpoint;
- endpoint and model identity capture, including provider-reported identity;
- capability certification: structured output, tool calling, patching, repository navigation, context, latency, and stability;
- private, economy, balanced, and quality policies with inspectable eligibility reasons;
- fleet health, certification expiry, budget, and route history views.

### Routing

- policy router selecting only among eligible models, optimizing expected total cost rather than input-token price;
- one local candidate and one optional hosted escalation candidate;
- dry-run route preview before any code or provider call;
- route changes recorded in the receipt.

### Outcome learning

- offline policy evaluation against versioned historical outcomes;
- contextual-bandit or constrained optimizer for eligible-model ranking;
- drift detection across model, quantization, server, prompt template, hardware, and repository class;
- automatic re-certification and safe rollback;
- privacy-preserving aggregate benchmarks that require explicit opt-in;
- portable policy, receipt, and evaluation exports to reduce lock-in.

### Safety gates

- no online routing-policy update without shadow evaluation and rollback criteria;
- never optimize only for acceptance rate, because an overly agreeable reviewer can inflate it;
- include regressions, rework, security findings, latency, cost, and reviewer overrides in the objective;
- keep risk and data-residency constraints hard, not learned preferences;
- require human approval before policy broadens an allowed effect or data destination.

### Exit criteria

- at least 25% lower model spend versus an agreed quality-equivalent single-frontier-model baseline, with no increase in escaped regressions;
- 90% of route decisions accepted without manual model override;
- learned ranking beats static policy on total accepted-outcome cost in offline and shadow tests;
- no degradation of high-risk defect detection;
- every automatic policy change is explainable, versioned, reversible, and attributable;
- customers can export or delete outcome history according to retention policy.

## Cross-cutting workstreams

### Evaluation corpus

- for the gate, prioritize frozen private repository tasks with known-correct outcomes and known agent failure cases;
- retain failed attempts, reviewer overrides, and caught self-reporting errors as first-class signals;
- for Phase 4 admission testing, use public SWE-bench Verified, Terminal-Bench, LiveCodeBench, and function-calling tasks;
- version prompts, harness, tools, models, serving stack, and hardware;
- publish methodology before publishing comparative claims.

### Model and license governance

- call models open-weight unless they meet the full [Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition);
- record license, acceptable-use restrictions, data-processing terms, and commercial obligations;
- block routes that conflict with customer or project policy;
- re-check terms before every bundled-model release;
- make model removal and replacement non-destructive to historical receipts.

### Developer experience

- one-command local install for a documented hardware matrix;
- diagnostic command that explains agent, sandbox, permission, and check-discovery failures;
- stable schemas and compatibility tests for MCP, CLI, API, and receipt formats;
- sample repositories that demonstrate a clean pass, a caught failure, and a bounded crash.

### Product learning

- interview reviewers separately from agent enthusiasts;
- instrument time-to-decision, not screen time;
- collect reason codes for every manual retry and rejection;
- test whether reviewers trust the packet enough to read less of the diff;
- test whether teams prefer work-unit ownership over persistent agent personas.

## Deferred until evidence supports it

- expanding the team-room surface: more channels, richer office visualization, or additional agent personas;
- org charts, per-persona budgets, and heartbeat scheduling;
- integrations with GitHub, Slack, Linear, Notion, or Drive beyond pull-request export;
- voice collaboration;
- a marketplace of unvetted third-party agents;
- automatic cross-repository changes;
- autonomous production deployment;
- foundation-model fine-tuning on customer code;
- hundreds of provider integrations;
- a universal proxy that claims to replace any host's main model;
- billing based on opaque token markup.

## First production launch checklist

- [ ] Product name, domain, trademark, and project license cleared.
- [ ] Supported host, agent, hardware, and operating-system matrix published.
- [ ] Work-unit and receipt schemas versioned and migration-tested.
- [ ] Cancellation and idempotency soak tests meet Phase 1 targets.
- [ ] Isolation verified: no egress without allowlist, no durable credential in agent scope.
- [ ] Threat model, dependency review, and penetration test complete.
- [ ] No configuration path can become an executed command.
- [ ] Data-flow diagram and privacy documentation match observed telemetry.
- [ ] Review-time and self-reporting-error claims reproduced on frozen customer tasks.
- [ ] Backup, recovery, incident response, and security-contact paths tested.
- [ ] No simulated data anywhere in the shipped product.
- [ ] Users can export receipts, policies, artifacts, and evaluation history.
