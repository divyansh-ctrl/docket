# AOS model fleet, serving, and routing

Status: proposed production baseline  
Fleet snapshot: 2026-08-13

## Positioning: open-weight first

AOS should be described as an **open, provider-neutral control plane with an open-weight-first model fleet**. It must not describe every downloadable model as “open-source AI.”

The [Open Source AI Definition 1.0](https://opensource.org/ai/open-source-ai-definition) requires the freedoms to use, study, modify, and share and identifies data information, training/run code, and parameters as the preferred form for modification. Weight availability or a permissive weight license alone may not satisfy that definition. The registry therefore records these concepts separately:

- `weightAvailability`: downloadable, hosted-only, or unavailable.
- `weightLicense`: exact license identifier/text and obligations.
- `codeLicense`: inference, training, tokenizer, and agent-harness licenses.
- `trainingTransparency`: declared data information and training recipe availability.
- `osiOpenSourceAI`: `verified`, `not-verified`, or `not-applicable`; never inferred from “Apache-2.0 weights.”
- `commercialUse`: allowed, conditional, prohibited, or review-required.

Product copy may say “open-weight” when weights are available under stated terms. “Open-source AI” requires a completed legal/technical review against the current OSI definition.

## Fleet principles

1. **The user owns the policy.** Locality, providers, regions, licenses, spend, and task risk are hard constraints.
2. **A model name is not a capability.** Every model/quantization/runtime/hardware tuple must pass certification.
3. **Route work units, not whole conversations.** Switching at bounded cache/context boundaries avoids repeatedly paying for a growing transcript.
4. **Local first is a preference, not a quality claim.** Local routes must meet the same acceptance and validation bars.
5. **Optimize verified total cost.** Inference cost alone ignores retries, escalations, validator compute, and reviewer time.
6. **No silent substitution.** Requested, selected, and provider-reported model identities are all shown in the receipt.
7. **Worker confidence is not evidence.** Routing learns from external outcomes only.

## Initial portfolio

The following is a candidate portfolio, not an allowlist. A model becomes routable only after license review, artifact pinning, capability certification, safety policy approval, and hardware-specific load tests.

| Pool | Candidate | Intended role | Why it is considered | Admission note |
| --- | --- | --- | --- | --- |
| Laptop/private | [gpt-oss-20b](https://openai.com/index/introducing-gpt-oss/) | Private drafting, extraction, focused code tasks | Apache-2.0 open weights; OpenAI documents a 16 GB memory deployment profile | Text-only; certify exact quantization and tool template |
| Laptop/private alternative | [Devstral Small 2 24B](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512) | Local agentic coding | Apache-2.0 model card and software-engineering focus | Hardware fit depends on quantization; measure, do not assume |
| Fast shared | [GLM-4.7-Flash](https://huggingface.co/zai-org/GLM-4.7-Flash) | Low-cost code/docs and recovery triage | MIT-licensed 30B-A3B MoE model card; vLLM/SGLang recipes | Benchmark claims are vendor-reported; validate privately |
| Balanced shared | [Qwen3.6-35B-A3B-FP8](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) | General implementation and multimodal repository inputs | Apache-2.0 card, MoE deployment profile, image/text interface | Require vision-data policy and exact server support |
| Coding/review | [Qwen3-Coder-Next-FP8](https://huggingface.co/Qwen/Qwen3-Coder-Next-FP8) | Multi-file coding and independent review | Apache-2.0 card with vLLM/SGLang tool-call examples | Do not use as its own reviewer |
| On-prem deep | [gpt-oss-120b](https://openai.com/index/introducing-gpt-oss/) | Deep reasoning and independent review | Apache-2.0 open weights; OpenAI documents a single 80 GB GPU profile | Text-only; safety/use policy is separate registry metadata |
| Rented deep | [DeepSeek-V4-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash) | Escalated long-context implementation/review | MIT model card and OpenAI-compatible serving recipe | Large weights; benchmark and provider identity need independent checks |
| Premium/experimental | [GLM-5.2](https://huggingface.co/zai-org/GLM-5.2) | Rare long-horizon deep tasks | MIT model card and documented 1M context | Very large deployment; not an MVP always-on pool |

MVP should start with three operational tiers, not seven always-on models:

1. One laptop/private model (`gpt-oss-20b` or certified Devstral quantization).
2. One fast/balanced shared model (`GLM-4.7-Flash` or `Qwen3.6-35B-A3B-FP8`).
3. One independent coding/review or deep escalation pool (`Qwen3-Coder-Next`, `gpt-oss-120b`, or a rented certified endpoint).

Additional models are admitted only when they improve a measured route frontier: verified success, total cost, latency, privacy, or language/domain coverage.

### MoE capacity caveat

Active parameter count describes compute per token, not the full memory required to hold model weights. Capacity planning uses the exact artifact bytes, quantization, KV-cache size, context target, concurrency, runtime overhead, and measured headroom. Marketing context limits are not default operating context; begin with 32K–128K windows plus retrieval and compaction unless an evaluation proves a longer window improves the target work.

## Model identity and registry

Every routable deployment has a stable `deploymentId` separate from its friendly model name:

```yaml
deploymentId: dep_qwen36_fp8_sglang_h200_v3
model:
  publisher: Qwen
  repository: Qwen/Qwen3.6-35B-A3B-FP8
  revision: "<immutable-revision>"
  weightDigest: "sha256:<manifest-digest>"
  tokenizerDigest: "sha256:<digest>"
  chatTemplateDigest: "sha256:<digest>"
license:
  weightSpdx: Apache-2.0
  reviewId: legal_2026_0813_04
runtime:
  engine: sglang
  imageDigest: "sha256:<digest>"
  configDigest: "sha256:<digest>"
  hardwareClass: h200
  executionEnvironment: local
serving:
  maxContextTokens: 131072
  maxOutputTokens: 16384
  supports: [streaming, json_schema, tools, vision, cancellation]
certification:
  certificateId: cert_01J...
  suiteVersion: aos-cert-v1
  validUntil: 2026-09-12T00:00:00Z
```

Registry invariants:

- Mutable aliases such as `latest` are prohibited in production routes.
- Quantizations are separate model artifacts and require separate certification.
- Chat templates, tokenizers, tool parsers, speculative draft models, LoRA adapters, and runtime images are part of deployment identity.
- A changed digest or serving flag invalidates the certificate.
- A provider-hosted model without downloadable weights records a provider model/version and terms snapshot; the provider-reported identity remains evidence, not cryptographic proof.
- Local model artifacts are verified on load and periodically sampled. Stronger runtime attestation may bind hardware and image identity, but AOS must not claim proof of the mathematical computation without an appropriate verifiable-inference/TEE design.

## Serving architecture

### Runtime selection

| Runtime | Default use | Reason |
| --- | --- | --- |
| [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) | Laptop, CPU/Metal/CUDA edge, quantized private models | Lightweight; OpenAI- and Anthropic-compatible routes, tool use, structured JSON, monitoring |
| [vLLM](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/) | Broad GPU cluster serving | Mature OpenAI-compatible serving and broad model ecosystem |
| [SGLang](https://docs.sglang.io/docs/basic_usage/openai_api_completions) | New MoE/long-context models where validated | Strong model-specific support and OpenAI-compatible API surface |
| Ollama / LM Studio adapters | Developer convenience and discovery | Easy setup; never the production policy or audit authority |

Runtime choice is empirical. The same model may use llama.cpp on a laptop and vLLM/SGLang in a cluster, but each tuple has its own certification, limits, and receipt identity.

### Normalized provider adapter

All adapters implement the following semantic contract even if wire formats differ:

```text
discover() -> identity, limits, capabilities, price, locality, health
generate(request, idempotencyKey, deadline, cancellationToken)
  -> stream(events), providerRequestId, providerReportedModel, usage, finishReason
cancel(providerRequestId) -> acknowledged | unsupported | unknown
health() -> capacity, queue, recent error classes
```

The canonical request includes ordered messages, bounded tools, response schema, temperature/reasoning controls, maximum output, and stop conditions. The adapter must explicitly report unsupported fields; it may not silently drop a JSON schema, tool restriction, or token limit.

The inference gateway:

- terminates host-compatible OpenAI/Anthropic APIs;
- authenticates the work unit and reads its already-decided route;
- applies model-specific prompt/tool adapters;
- meters input, cached, reasoning, and output usage when the provider exposes them;
- records request and response fingerprints without raw content by default;
- enforces deadline, stream size, cancellation, and circuit breakers;
- never owns orchestration state or approval authority.

## Capability certification

Provider “supports tools” metadata is insufficient. Certification is a reproducible test run against an exact deployment identity.

### Static gates

- License text, usage policy, commercial/redistribution obligations, attribution, export restrictions, and revision provenance reviewed.
- Weights, tokenizer, chat template, runtime image, configuration, and optional adapters pinned by digest.
- Model architecture supported without unreviewed remote code.
- Context/output limits and special token handling reconciled between model card and server.
- Data retention, training, residency, and subprocess/telemetry behavior documented.

### Dynamic gates

| Capability | Minimum test |
| --- | --- |
| Basic generation | Deterministic canary set, Unicode, stop sequences, finish reasons |
| Structured output | Valid JSON Schema adherence across adversarial values and retries |
| Tool use | Correct selection, arguments, abstention, serial/parallel calls, malformed return recovery |
| Patch fidelity | Applies a conventional diff without unrelated edits or path escape |
| Repository reasoning | Private frozen tasks with known invariants and hidden tests |
| Long context | Recall and reasoning at certified operating lengths, not just successful allocation |
| Cancellation | Stream ends and compute/lease is released within the declared bound |
| Isolation/privacy | No unexpected outbound traffic or telemetry; logs respect content policy |
| Stability | Soak test under target concurrency, context distribution, OOM and restart scenarios |
| Usage accuracy | Reported token/cost fields reconcile within documented tolerance |

External suites supplement but do not replace private tasks:

- [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/) for repository issue resolution.
- [Terminal-Bench](https://github.com/harbor-framework/terminal-bench) for terminal-agent workflows.
- [Berkeley Function Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard) for tool-call behavior.
- [LiveCodeBench](https://github.com/LiveCodeBench/LiveCodeBench) for time-windowed coding evaluation.

The highest-weight signal is a frozen, versioned suite drawn from the user's own repositories with hidden tests, realistic tool permissions, and human-review labels.

Certificates contain suite version, task-set digest, sampling settings, pass metrics, latency distributions, resource profile, observed defects, issuer, and expiry. Daily canaries detect drift; weekly or change-triggered full certification renews eligibility.

## Routing policy

### Hard gates before scoring

1. Tenant and project allowlist.
2. Data-class maximum, local/private requirement, provider, region, and retention terms.
3. Model and runtime license eligibility for the use case.
4. Required capabilities with a valid, unexpired certificate.
5. Risk tier floor and independent-review availability.
6. Context/output capacity and media support.
7. Credential readiness, healthy circuit, queue capacity, and deadline feasibility.
8. Worst-case attempt plus mandatory validation within the remaining budget.

Unknown price may appear in planning but is not eligible for live cost-constrained execution. Policy can tighten user preferences but cannot be weakened by a prompt.

### Work-type floors

| Work type | Minimum tier | Typical route |
| --- | --- | --- |
| Formatting, extraction, sourced Markdown | Fast | Local/cheap model with source validation |
| Ordinary implementation, focused tests, refactor | Balanced | Certified coding model + deterministic validator |
| Architecture, ambiguous debugging, concurrency | Deep | Deep worker + explicit acceptance evidence |
| Security, auth, migration, critical operations | Deep/high risk | Deep worker + independent model/provider or qualified human |

### Ranking objective

For candidates that pass all gates, rank expected verified utility rather than raw benchmark score:

```text
expected_total_cost = inference
                    + P(retry) * retry_cost
                    + required_validation_cost
                    + P(escalation) * escalation_cost
                    + expected_human_review_minutes * review_minute_value

utility = P(accepted_without_regression) * task_value
        - expected_total_cost
        - latency_penalty
        - reliability_penalty
```

The policy stores normalized features and weights under a signed version. The receipt records eligible models, rejection reasons, selected candidate, score components, and constraint fingerprint. Stable tie-breaking is required for reproducibility.

### Routing modes

| Mode | Ranking change | Constraints that never change |
| --- | --- | --- |
| `private` | Only deployments marked local | Data, risk, capabilities, budget, validation |
| `economy` | Favors the cheapest sufficient certified tier | Same hard gates and risk floor |
| `balanced` | Trades verified quality, total cost, and latency | Same hard gates |
| `quality` | Favors verified success and reviewer savings | Same data/provider/region/budget ceilings |
| `manual` | User selects among eligible deployments | Ineligible models remain unavailable |
| `off` | No delegated worker execution | Host remains responsible |

“Private” applies to the delegated route only. It does not retroactively make the host controller local or change where text already sent to a host was processed.

## Independent validation

- Generator and reviewer are different attempts with different trace/receipt IDs.
- When the fleet permits, the reviewer uses a different model family and provider/runtime from the generator.
- If separation is unavailable, the result is marked non-independent and waits for qualified human review.
- A reviewer sees objective, acceptance criteria, patch, relevant source, and deterministic evidence—not the generator's hidden reasoning.
- Reviewer output is structured: verdict, violated invariant, evidence location, severity, confidence, and required follow-up.
- Deterministic gates have precedence over reviewer opinion. A model cannot waive a failing test or policy violation.

## Outcome-learning router

The learning loop consumes only externally verified outcomes:

- deterministic test pass/fail and flaky classification;
- patch acceptance, human edits, reviewer findings, rollback, and later regression;
- attempts, latency, token usage, cost, cancellation responsiveness, and tool errors;
- task features such as work type, language, repository size band, risk, and required capabilities.

It does not train on secrets, raw source, full prompts, hidden reasoning, protected user traits, or worker self-confidence.

### Safe learning design

1. Key performance by exact deployment certificate, not friendly model name.
2. Use time-decayed reliability so stale versions do not dominate.
3. Train offline on delayed outcomes; evaluate against a frozen holdout and replay logged decisions.
4. Run new policies in shadow mode and compare counterfactual route feasibility before activation.
5. Permit limited exploration only on low-risk units within an explicit exploration budget.
6. Disable online exploration for confidential/high-risk work, migrations, security, and production actions.
7. Require signed policy promotion, rollback, fairness/provider-concentration review, and drift monitoring.
8. Keep a deterministic fallback ranking for learning-service failure.

No model automatically earns broader data access, tool authority, or lower validation requirements from a high success rate.

## Capacity and operations

- Batch only compatible tenant/privacy classes and never mix request content in logs or caches.
- Separate interactive and background queues; reserve capacity for cancellation, validation, and critical recovery.
- Autoscale on queue age, token throughput, KV-cache pressure, OOM rate, and deadline miss risk—not GPU utilization alone.
- Set certified concurrency and context buckets. Admission uses worst-case KV/cache memory for the requested bucket.
- Drain a deployment before model/runtime updates; new digests create a new deployment ID and certificate.
- Circuit breakers classify provider capacity, authentication, policy, content refusal, malformed output, and infrastructure failure separately.
- A safety refusal never triggers automatic fallback to a weaker policy model.
- Publish fleet health and model-selection receipts to users without exposing tenant data or proprietary provider internals.

## Model onboarding checklist

- [ ] Immutable model, tokenizer, template, runtime, and configuration digests recorded.
- [ ] Weight/code/data-information licenses and commercial terms reviewed.
- [ ] Provider retention, training, region, and identity reporting documented.
- [ ] Exact deployment passes static and dynamic certification.
- [ ] Private repository evaluation meets tier thresholds.
- [ ] Cancellation, usage metering, structured output, and tool abstention verified.
- [ ] Hardware capacity, cold start, concurrency, and failure modes load-tested.
- [ ] Safety policy and prohibited-use behavior reviewed for local and hosted paths.
- [ ] Independent reviewer separation defined.
- [ ] Rollback, revocation, and certificate-expiry paths tested.

