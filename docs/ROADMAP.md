# Docket delivery roadmap

**Status:** outcome-gated proposal  
**Date:** 2026-08-13

This roadmap is organized around risk retirement, not feature volume. Dates should be assigned only after two design partners supply representative repositories, policies, and frozen evaluation tasks.

## Product principles

- Prove one safe delegated outcome before adding more agents.
- Treat orchestration as a distributed system from the first executable prototype.
- Make cancellation, evidence, and data policy part of the work-unit contract.
- Prefer deterministic checks over model opinions.
- Route bounded units; never hand an entire unscoped conversation to a cheaper model.
- Measure reviewer time and escaped defects, not generated tokens.
- Keep provider and host adapters replaceable.
- Label simulations and hypotheses honestly.

## Phase 0 — Product and interaction proof

**Goal:** make the proposed control loop understandable before building the runtime.

### Deliverables

- original interactive dashboard prototype with simulated queue, route changes, receipt, risk, budget, and approval states;
- documented Guildly teardown and market landscape;
- work-unit, receipt, certification, policy, and event vocabulary;
- five customer-interview scripts for engineering leads, platform leads, reviewers, security, and individual developers;
- clickable end-to-end story: mixed request → local worker → escalation → validation → human decision.

### Exit criteria

- five target users can explain what ran, why it ran, and what needs their decision after a five-minute walkthrough;
- no participant believes the prototype changed the host model or ran a real worker;
- at least three design partners agree to provide anonymized workflow data and a frozen task suite;
- top three review-packet fields are consistent across interviews.

## Phase 1 — Private local alpha

**Goal:** produce one verifiable, low-risk work unit on one workstation.

### Runtime

- local daemon and CLI;
- SQLite event log with schema versioning;
- work-unit state machine with idempotency key, lease, heartbeat, deadline, retry budget, and cancellation;
- repository import and disposable Git worktree;
- container executor with read-only source, constrained writable workspace, resource limits, and default-deny egress;
- local artifact and append-only receipt store outside worker write scope.

### Model fleet

- adapters for `llama.cpp` and one OpenAI-compatible endpoint;
- endpoint/model identity capture;
- initial capability certification: structured output, tool calling, patching, repository navigation, context, latency, and stability;
- private, economy, balanced, and quality policies with inspectable eligibility reasons;
- one local candidate and one optional hosted escalation candidate.

### Verification

- configurable lint, test, typecheck, and build hooks;
- patch-scope and secret-detection checks;
- receipt containing route, provider-reported identity, inputs/artifact fingerprints, actions, checks, cost estimate, latency, and terminal outcome;
- CLI approve, request-changes, retry, and stop.

### Exit criteria

- 1,000-work-unit fault-injection soak test with zero duplicate side-effecting executions;
- p95 cancellation propagation below 10 seconds for supported executors;
- complete receipt for every terminal state;
- clean recovery after controller restart, worker crash, lost heartbeat, and duplicate queue delivery;
- first validated work unit within 20 minutes on a documented supported workstation;
- no durable credential available inside worker prompts or files.

## Phase 2 — Review-value beta

**Goal:** demonstrate that Docket lowers review time without lowering quality.

### Deliverables

- mixed-request decomposition into typed, dependency-aware work units;
- risk classifier with visible reasons and human override;
- independent verifier route with separation from worker context when policy requires it;
- review packet: intent-versus-diff, invariant map, risk hotspots, deterministic evidence, assumptions, reviewer disagreement, and exact questions;
- full dashboard backed by real event streams;
- fleet health, certification expiry, budget, route history, and failure-recovery views;
- GitHub-compatible pull-request export with linked receipt;
- MCP, CLI, and API adapters for host-neutral delegated execution;
- OpenTelemetry-compatible traces with content redaction controls.

### Evaluation

- frozen task suites from at least three design partners;
- randomized comparison with each team's current agent workflow;
- blind review samples for correctness and hidden-risk detection;
- cost model including inference, validation, retries, escalation, and measured human review time.

### Exit criteria

- at least 30% lower median review minutes on non-trivial accepted work units;
- no statistically meaningful increase in escaped regression rate in the measured cohort;
- at least 25% lower model spend versus an agreed quality-equivalent single-frontier-model baseline;
- 90% of route decisions accepted without manual model override;
- less than 1% orphaned or indeterminate work units, with every case recoverable from the event log;
- ten weekly active design-partner teams and four-week retention above 60%.

## Phase 3 — Team and security readiness

**Goal:** make the control plane credible for production repositories and multiple humans.

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
- disaster-recovery exercise meets defined RPO/RTO;
- audit demonstrates every effect is attributable to an identity, policy, work unit, and receipt;
- tenant-isolation and authorization tests cover all supported effect paths;
- three teams run Docket on production repositories for eight weeks under an approved security review.

## Phase 4 — Outcome-learning platform

**Goal:** make routing and verification improve from real outcomes while preserving customer control.

### Deliverables

- offline policy evaluation against versioned historical outcomes;
- contextual-bandit or constrained optimizer for eligible-model ranking;
- drift detection across model, quantization, server, prompt template, hardware, and repository class;
- automatic re-certification and safe rollback;
- repository-specific policy recommendations with counterfactual cost/quality estimates;
- privacy-preserving aggregate benchmarks that require explicit opt-in;
- portable policy, receipt, and evaluation exports to reduce lock-in.

### Safety gates

- no online routing-policy update without shadow evaluation and rollback criteria;
- never optimize only for acceptance rate, because an overly agreeable reviewer can inflate it;
- include regressions, rework, security findings, latency, cost, and reviewer overrides in the objective;
- keep risk and data-residency constraints hard, not learned preferences;
- require human approval before policy broadens an allowed effect or data destination.

### Exit criteria

- learned ranking beats static policy on total accepted-outcome cost in offline and shadow tests;
- no degradation of high-risk defect detection;
- every automatic policy change is explainable, versioned, reversible, and attributable;
- customers can export or delete outcome history according to retention policy.

## Cross-cutting workstreams

### Evaluation corpus

- begin with public SWE-bench Verified, Terminal-Bench, LiveCodeBench, and function-calling tasks for admission testing;
- prioritize frozen private repository tasks for routing decisions;
- version prompts, harness, tools, models, serving stack, and hardware;
- retain failed attempts and reviewer overrides as first-class signals;
- publish methodology before publishing comparative claims.

### Model and license governance

- call models open-weight unless they meet the full [Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition);
- record license, acceptable-use restrictions, data-processing terms, and commercial obligations;
- block routes that conflict with customer or project policy;
- re-check terms before every bundled-model release;
- make model removal and replacement non-destructive to historical receipts.

### Developer experience

- one-command local install for a documented hardware matrix;
- diagnostic command that explains endpoint, sandbox, permission, and routing failures;
- dry-run route preview before any code or provider call;
- stable schemas and compatibility tests for MCP, CLI, API, and receipt formats;
- sample repositories that demonstrate success and bounded failure.

### Product learning

- interview reviewers separately from agent enthusiasts;
- instrument time-to-decision, not screen time;
- collect reason codes for every manual route change, retry, and rejection;
- compare “attention-first” dashboard views with raw activity feeds;
- test whether teams prefer work-unit ownership over persistent agent personas.

## Deferred until evidence supports it

- virtual-office visualization or gamified agent personas;
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
- [ ] Supported host, model, server, hardware, and operating-system matrix published.
- [ ] Work-unit and receipt schemas versioned and migration-tested.
- [ ] Cancellation and idempotency soak tests meet Phase 1 targets.
- [ ] Threat model, dependency review, and penetration test complete.
- [ ] Data-flow diagram and privacy documentation match observed telemetry.
- [ ] Every supported provider returns or clearly lacks provider-reported model identity.
- [ ] Model licenses and data-processing terms re-verified.
- [ ] Review-time and regression claims reproduced on frozen customer tasks.
- [ ] Backup, recovery, incident response, and security-contact paths tested.
- [ ] Demo and simulated data unmistakably labeled.
- [ ] Users can export receipts, policies, artifacts, and evaluation history.
