# Agents you can open, configure, meter, and pay for

**Date:** 2026-08-20
**Status:** plan, nothing built

Five asks: walk into an agent's session from the office, one place to configure
every agent, one place to meter what they all spend, a first-run recommendation
of open models with real instructions for getting keys, and somewhere to put
those keys.

They are not five features. Four of them rest on one thing Docket does not have,
and that dependency is the whole plan.

## What is true today

Verified by reading, not recalled.

| Fact | Where |
|---|---|
| There is no tab shell. The app is a set of boolean overlays — `settingsOpen`, `providersOpen`, `officeOpen`, `terminalOpen` | `src/renderer/app.tsx:46-48` |
| The model vocabulary is Claude-only: `["opus","sonnet","haiku","fable","inherit"]` | `src/shared/agent-roster.ts:43` |
| **There is no secret storage of any kind.** No `safeStorage`, no keytar, no keychain. Config is plain JSON on disk | `src/main/config-store.ts`; grep finds nothing |
| The terminal IPC is already keyed by `terminalId`, and `PtyManager` holds a `Map<string, ManagedTerminal>` | `src/shared/ipc-contract.ts:108`, `src/main/pty-manager.ts:80` |
| But the UI runs **one** terminal, `purpose: "login" \| "session"` | `src/renderer/terminal-surface.tsx:11` |
| Nine agents exist as roster entries with charters | `src/shared/agent-roster.ts:290-402` |
| Usage is read from CLI transcripts and is **session-wide, never per agent** — the transcripts carry no subagent attribution | `src/main/token-usage.ts`, `src/main/codex-usage.ts` |

## The dependency everything else rests on

**The nine agents do not have sessions.** They are roster entries, charters, and
figures on a floor. There is one controller session, shared.

That single fact decides four of the five asks:

- **Walking into a session** has nothing to walk into.
- **A usage tab per agent** is impossible from transcripts. The token reader
  already says so in its own comment, and it was written that way after checking:
  ninety transcript files, sixty thousand records, not one turn attributed to a
  subagent. No amount of parsing fixes this. The only way Docket learns which
  agent spent what is by **being the thing that ran them**.
- **Configuring an agent's model** currently sets a field nothing reads at spawn.
- **An API key** has no consumer until something is spawned with it.

So Phase 0 is not optional and not cosmetic.

### Phase 0 — give each agent a real session

The good news is that this is smaller than it looks. `PtyManager` is already a
map keyed by id and the IPC already passes `terminalId` everywhere. What is
missing is a layer above it that owns *which* terminal belongs to *which* agent,
what it was spawned with, and what it has cost.

- An `AgentSession` record: agent id, terminal id, provider, model, resolved
  argv, environment overrides, started/ended, workspace.
- Spawn per agent on demand rather than all nine at once. Nine concurrent CLI
  processes on a laptop is not a feature.
- Session lifecycle in the same event log Track 1.4 is going to introduce. These
  are runs, and runs are what the append-only decision log is explicitly not for.

Everything below assumes this exists.

## 1. Walking into a session

The ask: scrolling or zooming into an agent's monitor takes you into their
session.

The office already has the camera work — `CAMERA.minDistance`, `easeDistance`,
`clampLookAt`, and label detail that already changes with distance
(`LABEL_LOD`). The scene knows how close you are. What it does not have is
anything to show on the monitor.

**Do not render a terminal inside WebGL.** A terminal is text, selection,
scrollback and a caret; as a canvas texture it is expensive and loses all of it.
Instead, project the monitor quad's screen-space rectangle each frame and align a
real DOM terminal over it, cross-fading as distance crosses a threshold. The 3D
screen shows a cheap static texture until the handover, then the DOM surface
takes over and the scene keeps running behind it.

Honest hard parts, none of which are blockers:

- The handover must be hysteretic or it will flicker at the threshold — enter at
  one distance, leave at a longer one.
- A DOM overlay tracking a projected quad drifts under orbit unless it is updated
  in the same frame as the render, not in a React effect.
- Reduced motion must skip the fly-in entirely, not shorten it. The office
  already learned this lesson once.
- Focus has to move to the terminal on entry and back to the canvas on exit, or
  keyboard users end up typing into the scene.

## 2. A configuration tab

The ask: one tab for every agent's configuration.

This is the cheapest of the five and the one that unblocks the rest, because it
forces the model identity problem into the open.

Today a model is one of five Claude words. It needs to become a triple —
**provider, model id, and where the credential comes from** — because
`z-ai/glm-5.2:free` on OpenRouter and the same weights on a local Ollama are not
the same configuration and must not collapse to one label.

Per agent: provider, model, reasoning effort where supported, isolation
requirement, and which workspace it may touch. The charter text already exists
and should be visible here rather than buried in a constant.

**This is also where the tab shell gets built.** Four overlay booleans is already
one too many, and this ask adds three more surfaces.

## 3. A usage tab

The ask: one tab metering every agent.

What can be built honestly:

- **Per agent, once sessions exist**, because Docket spawned the process and
  knows whose it was. This is real attribution, not inference.
- **Per provider**, from the two readers already written.
- **Rate limits**, but only for Codex — it records `rate_limits` with a reset
  time. Claude Code records none, and the panel already says so rather than
  inventing one.
- **A context percentage**, but only where a window was stated. Codex states
  `model_context_window`; Claude Code does not.

What must not be built: a per-agent split of historical transcript usage. There
is no attribution in those files, and dividing a session total across nine faces
would be arithmetic on an assumption — the one thing this product exists to
remove. Sessions started before this feature simply have no per-agent history,
and the tab should say that rather than showing nine plausible numbers.

## 4. First-run model recommendations

The ask: on install, recommend the best open models, with exact steps to get keys
and free options suited to each agent.

### The list must not be hardcoded

Any list written into the source is wrong within weeks. It can be **read**.
OpenRouter serves a public, unauthenticated catalogue at
`https://openrouter.ai/api/v1/models` — 414 models when queried on 2026-08-20 —
and each record carries `pricing`, `context_length`, `supported_parameters`,
`hugging_face_id`, and third-party `benchmarks`.

That gives three **checkable** filters instead of opinions:

1. `supported_parameters` contains `tools` — a model that cannot call tools
   cannot drive an agentic CLI at all. Of the 17 free models, exactly one fails
   this.
2. `hugging_face_id` is present — the weights are actually open.
3. `pricing.prompt == "0"` — the free tier.

Ranking uses `benchmarks.artificial_analysis`, which carries
`coding_index` and `agentic_index`. Those are Artificial Analysis's numbers,
not Docket's, and the UI must attribute them and date them.

### Measured on 2026-08-20

Open weights, tool-calling, ranked by coding index:

| Model | coding | agentic | context | $/Mtok in |
|---|---|---|---|---|
| `moonshotai/kimi-k3` | 76.2 | 54.3 | 1,048,576 | $3.00 |
| `qwen/qwen3.8-2.4t-a95b` | 71.9 | 57.1 | 1,048,576 | $2.00 |
| `deepseek/deepseek-v4-flash-0731` | 69.1 | 48.4 | 1,310,720 | $0.14 |
| `deepseek/deepseek-v4-pro-0813` | 68.8 | 49.6 | 1,048,576 | $1.19 |
| `z-ai/glm-5.2` | 68.8 | 45.7 | 1,048,576 | $0.97 |
| `z-ai/glm-5.2:batch` | 68.8 | 45.7 | 512,000 | $1.40 |

Free tier, same filters:

| Model | coding | agentic | context | price |
|---|---|---|---|---|
| `z-ai/glm-5.2:free` | 68.8 | 45.7 | 256,000 | free |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 49.3 | 27.5 | 1,000,000 | free |
| `google/gemma-4-31b-it:free` | 43.4 | 14.4 | 262,144 | free |
| `google/gemma-4-26b-a4b-it:free` | 39.3 | 11.0 | 262,144 | free |
| `nvidia/nemotron-3-super-120b-a12b:free` | 37.7 | 8.8 | 262,144 | free |
| `cohere/north-mini-code:free` | 36.5 | 3.1 | 256,000 | free |

Two things fall out of this that matter more than the ranking:

**The free tier has exactly one serious option.** `z-ai/glm-5.2:free` scores
68.8 coding and 45.7 agentic — within 7.4 coding points of the best paid
open-weight model. The next free model down is 49.3, and agentic collapses to
27.5 and below.

**Agentic index is the number that matters here, and it is not coding index.**
Several free models advertise tool support and score in single digits agentically.
They will accept a tool schema and then fail a multi-step edit-run-fix loop. A
recommendation that ranked on coding alone would send people to models that
cannot do the job Docket asks of them.

### Mapping to the nine agents

This is where "specific to the agents we created" becomes concrete. The roster
splits by how much autonomous tool use each charter demands:

- **High agentic** — lead, engineer, release. Multi-step, edit-run-fix.
  Below roughly 40 agentic index these fail in ways that look like laziness.
- **Medium** — review, security, tests. Read a lot, write a little, few steps.
- **Low** — docs, interface, data. Largely single-shot generation.

So the honest default is not one model for everything: the free GLM for the
demanding three, and much cheaper or smaller models for the rest. The tab should
show why each recommendation was made, with the number it was made from.

### Getting a key

Steps must be verified per provider and dated, and they should be **checked**
rather than trusted: after a key is entered, Docket makes one real call and
reports what came back. That turns "you have a key" into an observation.

Known and verified today:

- **OpenRouter** free variants are limited to **20 requests per minute and 50 per
  day**, rising to 1,000 per day after a $10 credit purchase.
- **Groq** publishes only Developer-plan limits; exact free-tier limits are
  account-specific and visible only in the console. Docket must not print a
  number it has not read.
- **Ollama** needs no key at all and Codex supports it as a built-in provider.
  This is the true zero-friction path and should be offered first to anyone with
  the hardware.

## 5. An API keys tab

The ask: one tab to configure keys for open models.

### Where keys go

Electron's `safeStorage` is the right primitive and it comes with a caveat that
must be surfaced rather than buried. On Linux it uses kwallet or gnome-libsecret
where available; **where no secret store exists it falls back to a hardcoded
plaintext password**, and `getSelectedStorageBackend()` returns `"basic_text"`.

So Docket checks that backend and says plainly when keys are not actually
encrypted. Silently storing a key in effective plaintext, under a UI that implies
safety, would be a worse failure than not offering the feature.

### How a key reaches a CLI

This is the part that decides the architecture, and the two CLIs are not
symmetric.

**Codex is native.** `~/.codex/config.toml` takes
`[model_providers.<id>]` with `name`, `base_url`, `env_key`, `wire_api`,
plus optional `query_params`, `http_headers`, `env_http_headers`,
`request_max_retries` and `stream_max_retries`. `model` and
`model_provider` select it. `--oss` uses `oss_provider`, which is
`ollama` or `lmstudio`. The built-in ids `openai`, `ollama` and
`lmstudio` cannot be overridden.

Critically, `env_key` names an **environment variable**, not a literal. So
Docket writes the provider block once and injects the secret into the spawned
process's environment at launch. **No key is ever written to `config.toml`.**

**Claude Code is not.** It speaks the Anthropic Messages wire format.
`ANTHROPIC_BASE_URL` overrides the endpoint but the thing at the other end must
still speak Anthropic. There is no documented OpenAI-compatible mode. Running an
open model through Claude Code therefore requires a **translating gateway**, and
Docket should say that rather than offering a base-URL box that produces
confusing failures.

`apiKeyHelper` is worth knowing about: a command whose output is sent as
`X-Api-Key` and `Authorization: Bearer`. It is a cleaner integration point
than `ANTHROPIC_API_KEY` because the secret never sits in an environment
variable that every child process inherits.

## Sequencing

Each step is shippable and each earns the next.

1. **Tab shell.** Four overlay booleans become a navigation model. Small,
   unblocks three asks, touches the office and so needs a walk.
2. **Model identity.** Replace the five Claude words with provider/model/credential.
   Pure types and config migration; no UI.
3. **Secret storage.** `safeStorage` with the `basic_text` disclosure. No UI
   yet — storage, retrieval, and the honest backend report.
4. **Keys tab + Codex provider writing.** First end-to-end open model: enter a
   key, Docket writes the provider block, injects the env var, one real call
   verifies it.
5. **Agent sessions.** Phase 0 proper. The largest single step.
6. **Configuration tab**, now that a configuration can actually be applied.
7. **Usage tab**, now that per-agent attribution is real.
8. **Walk-into-session.** Last, because it is the only one that is purely
   presentation, and it needs everything above to have something to present.
9. **First-run recommendations.** Can land any time after 4, but is most useful
   once 5 exists.

## What I could not establish

- **Benchmark numbers are third-party.** `coding_index` and `agentic_index`
  come from Artificial Analysis via OpenRouter. Docket reads them; it has not
  measured them, and the UI must say so.
- **Blog rankings disagree with each other.** Several August 2026 roundups give
  different figures for the same models. None is used above.
- **Free-tier limits vary per account** and, for Groq, are not published at all.
- **Whether GLM-5.2-free actually drives Docket's charters well is untested.**
  The agentic index is a proxy. The only real evidence is running the nine agents
  against a real repository and reading the packets, which is a day's work and
  should happen before any of this is recommended to a user in the product.
