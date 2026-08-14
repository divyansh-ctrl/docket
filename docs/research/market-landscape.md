# Market and user research

**Research date:** 2026-08-13  
**Question:** What must an open-weight agent operations system provide that users cannot already assemble from existing coding agents, model routers, and team dashboards?

## Bottom line

“Guildly with open models” is not a durable differentiation. Parallel agents, worktrees, model selection, local inference, background execution, and team-like roles already exist in several products. The credible gap is a combined **trust and control loop**:

> user-owned local or hosted models + capability certification + automatic work-unit routing + durable orchestration + real isolation + independent verification + review compression + immutable receipts + outcome learning

No product reviewed publicly documents that full combination as one self-hostable system. This is a scoped market observation, not a universal non-existence claim.

## What users are actually struggling with

### Review throughput and accountability

More generation can create more review work. The 2025 Stack Overflow survey reports that 46% of respondents distrust AI tool accuracy versus 33% who trust it; 66% cited solutions that are “almost right,” and 45% reported that debugging AI-generated code takes more time ([survey](https://survey.stackoverflow.co/2025/ai)). DORA frames a similar tension: time saved in creation can move into verification, while increased adoption can coincide with both higher throughput and instability ([analysis](https://dora.dev/insights/balancing-ai-tensions/)).

Maintainer discussions describe large or irrelevant generated pull requests increasing review burden ([scikit-learn issue](https://github.com/scikit-learn/scikit-learn/issues/31679)). These discussions demonstrate a failure mode, not its prevalence.

**Product implication:** optimize evidence quality and reviewer time, and attribute every effect to an owner and receipt.

### Duplicate, looping, hung, or lost work

Issue reports across orchestration systems describe duplicate subagents, redispatched nodes, missing timeouts, and work continuing without useful progress ([Claude Code](https://github.com/anthropics/claude-code/issues/55586), [LangGraph](https://github.com/langchain-ai/langgraph/issues/7417), [Claude Code timeout request](https://github.com/anthropics/claude-code/issues/61405)).

**Product implication:** multi-agent execution must be treated as a distributed system: leases, heartbeats, idempotency, deadlines, retry budgets, and cancellation propagation are core product behavior, not backend polish.

### Context bloat and drift

Users report tiny tasks accumulating large contexts, subagents polluting parent context, and sessions becoming unrecoverable ([Cline reports](https://github.com/cline/cline/issues/7048), [Claude Code report](https://github.com/anthropics/claude-code/issues/16209)).

**Product implication:** use bounded context packets with lineage and summarization checkpoints. Do not market an indiscriminate “shared brain.”

### Runaway cost

Recursive delegation and retry loops can make headline token pricing meaningless; one public Claude Code issue describes more than 1.2 million tokens from recursive delegation ([issue](https://github.com/anthropics/claude-code/issues/68619)).

**Product implication:** expose expected total cost per accepted outcome, with hard budgets for retries, children, verification, and escalation.

### Security controls that do not compose

Public reports describe permission inheritance surprises and audit evidence residing within an agent-writable area ([permission report](https://github.com/anthropics/claude-code/issues/23983), [audit report](https://github.com/anthropics/claude-code/issues/81782)). Cursor's own background-agent documentation warns that internet access and automatic terminal commands create prompt-injection and data-exfiltration risk ([documentation](https://docs.cursor.com/background-agent)).

NIST and OWASP treat prompt injection and poisoned tool metadata as structural agent risks, not prompt-writing mistakes ([NIST](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition), [OWASP MCP Tool Poisoning](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning)).

**Product implication:** keep authorization, credentials, network policy, and append-only evidence outside model-controlled context and filesystems.

### Local-model support without predictable reliability

OpenHands documents practical caveats for local-model use ([documentation](https://docs.openhands.dev/openhands/usage/llms/local-llms)); individual user reports describe destructive or malformed edits from weaker local models ([Aider issue](https://github.com/Aider-AI/aider/issues/590)).

**Product implication:** certify the exact model + quantization + server + hardware combination and continuously detect drift. A provider dropdown is not a capability guarantee.

### Weak proof of what ran

Teams often see a configured model name but lack provider-reported identity, context lineage, tool manifests, effect logs, and validation evidence. Requests for better agent analytics recur in public issue trackers ([Claude Code analytics request](https://github.com/anthropics/claude-code/issues/33978)). GitHub notes that some Copilot features do not expose a user-selectable model and publishes model/billing behavior separately ([documentation](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

**Product implication:** produce a portable receipt that distinguishes requested model, routed model, and provider-reported model and records every fallback.

### Collaboration remains fragmented

Anthropic documents Agent Teams as experimental and lists limitations around session resumption, task coordination, permissions, and shutdown behavior ([documentation](https://code.claude.com/docs/en/agent-teams)).

**Product implication:** durable ownership, dependencies, approvals, handoffs, and decision records must survive a model session.

## Competitive landscape

Capabilities below reflect public material reviewed on the research date. Products evolve quickly; absence means “not established in the cited public material,” not “impossible.”

| Product/category | Publicly documented strength | Implication for Docket |
|---|---|---|
| [Guildly](https://www.tryguildly.com/docs) | cohesive desktop team UX, roles, shared workflow, review, intervention | team UI and agent personas alone are not a moat |
| [GitHub Copilot coding agent](https://github.com/features/copilot/agents) | asynchronous agent work in GitHub, parallel tasks, established review surface | repository-native background work is already mainstream |
| [Copilot auto model selection](https://docs.github.com/en/copilot/concepts/models/auto-model-selection) and [BYOK](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models) | automatic model choice in supported contexts and local/BYOK options in the app | “we switch models” and “we support Ollama” are insufficient claims |
| [Factory](https://docs.factory.ai/cli/user-guides/become-a-power-user) | multi-agent Missions, worker/validator patterns, CLI workflows | Docket needs stronger proof, isolation, and review economics, not more orchestration vocabulary |
| [Factory BYOK/enterprise](https://docs.factory.ai/cli/byok/overview) | provider choice, observability, and enterprise deployment options | BYOK, air-gap, and telemetry are expected in serious deployments |
| [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) | peer agents, shared task list, inter-agent messages | persistent named teams exist; durable recovery and policy remain opportunities |
| [Cursor background agents](https://docs.cursor.com/background-agent) | remote asynchronous coding integrated with an IDE | convenience must be paired with explicit network and effect boundaries |
| [OpenHands](https://docs.openhands.dev/overview/faqs) | open platform, SDK/runtime options, local models | an open runtime is available; Docket should orchestrate and verify rather than rebuild all execution primitives |
| [Goose](https://block.github.io/goose/) | open-source desktop/CLI, MCP extensions, recipes, local providers and subagents | host neutrality and local execution are becoming table stakes |
| [Roo Code modes](https://roocodeinc.github.io/Roo-Code/basic-usage/using-modes/) and [providers](https://roocodeinc.github.io/Roo-Code/providers/) | mode-specific behavior and provider/model mapping | role-to-model routing already exists; certification and outcome learning are the differentiators |
| [Braid](https://getbraid.dev) | parallel Claude/Codex/terminal agents in worktrees and relay workflows | worktree-based parallel sessions are not novel |
| [Cairn](https://cairn.computer/) | issue-centric recipes, worktrees, continuity, and agent messaging | persistent work coordination is an active category |
| [Paperclip](https://github.com/getpaperclipai/paperclip) | open-source agent-company control plane and budgets | org charts and budget dashboards alone do not solve verification |
| [Kern](https://kern-ai.com/) | self-hosted agent runtime and operational dashboards | self-hosted operations must be assumed in the enterprise segment |
| [OpenCode](https://opencode.ai/docs) | open-source coding agent with broad provider support | a new terminal agent is not the wedge |

## What is already commoditizing

- multiple simultaneous agent sessions;
- persona or role templates;
- Git worktrees and branch-per-task execution;
- a kanban board and activity feed;
- manual model/provider dropdowns;
- basic automatic model selection;
- Ollama or OpenAI-compatible endpoint support;
- MCP tool connectivity;
- simple token and budget charts;
- a second model called “reviewer.”

These remain necessary integration features. They should not lead positioning.

## The defensible product gap

### 1. Capability certification on connection

Benchmark the exact endpoint against tool calling, structured output, patch application, repository navigation, long-context behavior, latency, and stability. Store signed results and expire them after model, server, prompt-template, quantization, or hardware changes.

### 2. Outcome-based work-unit routing

Select among only policy-eligible models, then optimize expected total cost rather than input-token price. Route architecture, implementation, tests, Markdown, and review separately. Learn from accepted outcomes, retries, regressions, and reviewer overrides.

### 3. Durable orchestration semantics

Use event-sourced state and distributed-systems controls so a crash, duplicate delivery, or cancelled parent cannot silently create extra side effects.

### 4. Security boundary per work unit

Combine worktrees with a disposable container or microVM, read-only source, default-deny network, allowlisted dependency proxy, resource caps, and leased credentials. A branch is merge hygiene; the runtime boundary provides containment.

### 5. Verifiable receipts

Record policy version, requested model, provider-reported model, endpoint, context/artifact fingerprints, tool-manifest hash, actions, test results, cost, latency, retry/fallback chain, data policy, and final human decision in an append-only store.

### 6. Review compression

Generate a packet optimized for judgment: requested intent, behavioral changes, invariant map, high-risk diff regions, deterministic evidence, reviewer-model disagreements, assumptions, and exact questions. Link every summary statement back to evidence.

### 7. Self-hosted human collaboration

Provide ownership, mentions, approvals, decision records, service levels, incident escalation, and portable artifacts without requiring a vendor's hosted model or storage plane.

## Open-weight model strategy

The product should say **open-weight** unless a model satisfies the full [OSI definition](https://opensource.org/ai/open-source-ai-definition). License metadata and acceptable-use rules belong in routing policy.

Candidate pools to evaluate, not hard-coded defaults:

| Pool | Candidate | Public rationale | Operational caveat |
|---|---|---|---|
| laptop/private | [`gpt-oss-20b`](https://openai.com/index/introducing-gpt-oss/) | Apache 2.0; OpenAI describes an approximately 16 GB memory target | actual speed and tool reliability depend on quantization and runtime |
| balanced | [`Qwen3.6-35B-A3B-FP8`](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) | Apache 2.0 model card; mixture-of-experts and long context | all weights still consume memory even when active parameters are lower |
| code/review | [`Qwen3-Coder-Next-FP8`](https://huggingface.co/Qwen/Qwen3-Coder-Next-FP8) | Apache 2.0 model card focused on coding-agent work | benchmark tool use and patch quality on private tasks |
| larger on-prem review | `gpt-oss-120b` | Apache 2.0 release and high-capacity option in the same [OpenAI announcement](https://openai.com/index/introducing-gpt-oss/) | requires substantially larger hardware |
| premium open-weight escalation | [`GLM-5.2`](https://huggingface.co/zai-org/GLM-5.2) | published weights and model card for a large MoE model | expensive multi-GPU serving; not an always-on MVP default |

Serving should use interchangeable adapters: `llama.cpp` for desktop/private use, vLLM for broadly supported production serving, and SGLang when it provides better support for a selected MoE model. `llama.cpp` documents OpenAI-compatible and Anthropic-compatible server surfaces plus tool use and structured output ([server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)). Ollama can be a convenience adapter, not the control plane.

Long advertised context windows should not become the default operating mode. Prefer 32K–128K bounded packets, retrieval, and checkpointed compaction until private evaluation proves a larger window improves accepted outcomes.

## Evaluation strategy

Public evaluations such as SWE-bench Verified, Terminal-Bench, LiveCodeBench, and Berkeley Function-Calling Leaderboard are useful admission signals. They are not sufficient for routing. The decision signal should come from a frozen, versioned set of customer-approved repository tasks with:

- deterministic acceptance checks;
- blind human review samples;
- measured rework and regression outcomes;
- separate scores for implementation, tests, documentation, review, and tool use;
- cost, latency, retry, and hardware-stability measurements;
- prompt-template and serving-version fingerprints.

The METR study of experienced open-source developers found participants took 19% longer with early-2025 AI tools in the studied setting despite expecting to be faster ([study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)). It should not be generalized to all tools or teams, but it is a strong reason to measure real completed work rather than perceived speed.

## Positioning

### Recommended

> Docket is the open, auditable operating system for human and AI engineering teams. It assigns every work unit to the cheapest verified local or cloud model, proves the work, and escalates only what needs human judgment.

### Avoid

- “AI employees that replace your engineering team”;
- “one shared brain for every agent”;
- “automatically switches any app's main model”;
- “open source” as a blanket label for all supported weights;
- “cheapest router” without accounting for verification and rework;
- benchmark-only claims detached from customer repositories.

## Initial wedge and adoption path

1. Import one repository.
2. Detect one local endpoint and one optional hosted BYOK endpoint.
3. Certify both on a small task suite.
4. Accept a mixed request and create bounded work units.
5. Route low-risk work locally; escalate uncertain or high-risk work by policy.
6. Execute each unit in an isolated workspace.
7. Return deterministic evidence, optional independent review, and a portable receipt.
8. Ask the human one narrow approval question.
9. Compare reviewer time and total accepted-outcome cost against the team's existing workflow.

The first “aha” is not watching agents collaborate. It is seeing a documentation or test unit finish locally, a risky code unit escalate automatically, and one concise review packet explain both.

## Research limitations and provenance

- This is a point-in-time review of public materials, not exhaustive competitive intelligence.
- GitHub issues and community reports show plausible failure classes but do not establish incident rates.
- Model specifications come from publisher/model-card claims and require independent measurement.
- Commercial terms and product capabilities can change; they must be re-checked before launch or procurement.
- An Adaptive Model Router delegation was attempted during discovery but its transport was unavailable. No external worker-model execution is claimed; the synthesis here relies on the linked sources and host analysis.
