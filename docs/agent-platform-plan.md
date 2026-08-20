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

## 6. One tab, and switching after setup

The ask: Codex or Claude is chosen when someone first sets up their agents; after
that, one tab lets them move to an open model or anything else, with the options
offered dynamically.

`selectedProvider` already exists and already carries the first-run choice. What
is missing is that it is **one global setting**, and this ask needs it per agent —
which is the model identity work in section 2, arriving from a different
direction.

The word "dynamic" is doing real work here and it is satisfiable: because the
catalogue is fetched rather than hardcoded (section 4), the list can be current
without a Docket release. The filters are the same three checkable ones.

**What the tab must not do is offer options that cannot work.** Whether an open
model is reachable depends on which CLI the agent runs:

- On **Codex** it is native. Write a provider block, inject the key, done.
- On **Claude Code** it is not. The far end must speak the Anthropic wire format,
  so an OpenAI-compatible endpoint needs a translating gateway in between.

A tab that lists every model for every agent and fails at spawn time would be
worse than one that lists fewer. So the option list is filtered by what the
agent's current CLI can actually reach, and choosing an unreachable combination
offers the gateway rather than an error later.

## 7. Starting again when limits reset

The ask: whichever CLI is behind an agent, when session limits reset the agents
resume on their own.

This is the most valuable of the additions and the one with the least symmetric
foundation.

### Codex tells you, in structured form

The rollout files carry `rate_limits` alongside every `token_count` event:
`used_percent`, `window_minutes`, and `resets_at` as epoch seconds.
`codex-usage.ts` already reads it, and already discards it once the reset has
passed rather than reporting a window that no longer exists. A parked session can
be woken from a real timestamp.

### Claude Code does not

There is no rate-limit block in its transcripts — the desk panel already says so
rather than inventing one — and the documentation describes no exit code and no
JSON error field a wrapper could read for this case in `-p` mode.

What it does do is **print the reset time**. The documented messages are:

```
You've hit your session limit · resets 3:45pm
You've hit your weekly limit · resets Mon 12:00am
You've hit your Opus limit · resets 3:45pm
```

Docket owns the PTY, so reading its own child process's output is an observation,
not an inference. But it is a **string**, and strings change between releases. So:

- The parse must fail safe. A session that stopped for an unrecognised reason is
  parked with **"reset time unknown"** and waits for a person. Docket must never
  guess a reset time, because a guessed one produces an agent that wakes up,
  burns the remaining allowance, and stops again.
- A parse failure is a finding, not a silence: if Docket sees a session end
  without recognising why, it says the wording may have changed.

### The Opus limit is a different case

Per the documentation, the session and weekly limits are shared across models, so
switching model does **not** restore access. The Opus limit is the exception —
switching does keep you working. So the honest response differs: wait for the
first two, offer a model downgrade for the third.

### There is precedent, including for the restraint

Claude Code's own desktop app carries an **"Auto-continue when limits reset"**
control, and it is **not offered for weekly limits**. That restraint is worth
copying rather than improving on. A twenty-minute session reset and a
multi-day weekly reset are different propositions: resuming automatically on
Monday, unattended, against a repository whose state has moved, is not the
feature anyone asked for.

### What resuming actually means

The CLI process is gone when a limit is hit. "Resume" is therefore **re-spawn
with the same charter and the same queued work**, not a continuation, and the
distinction has to be visible or people will assume conversational state
survived.

Bounds, because an unbounded version is a way to burn an allowance the instant it
returns:

- A cap on automatic resumes per agent per window, then it waits for a person.
- A global switch, off by default until it has been watched working.
- The resume is an event in the same log as everything else, so "why did this
  agent run at 3am" has an answer.

## 8. One tab for MCP servers

The ask: a tab to configure MCP servers.

Both CLIs support MCP and **neither stores it the same way**, so this tab cannot
be a thin editor over one file. It owns a canonical description and projects it
into two formats.

**Claude Code** uses `.mcp.json` with an `mcpServers` wrapper. Entries are either
stdio (`command`, `args`, `env`) or remote (`url` plus `type`, one of `http`,
`sse`, `ws`). Scope is `local` by default, or `project` or `user` via `--scope`,
and `claude mcp add` / `add-json` write it.

**Codex** uses `[mcp_servers.<id>]` in `config.toml`. stdio takes `command`,
`args`, `cwd`, `env`, `env_vars`; remote takes `url`, `http_headers`,
`env_http_headers`, `bearer_token_env_var`, and `auth` of `oauth` or `chatgpt`.
It also carries `enabled`, `required`, `startup_timeout_sec` (default 10),
`tool_timeout_sec` (default 60), `enabled_tools`, `disabled_tools`, and
per-tool approval modes.

### The edges are lossy, and that has to be visible

Some things exist on one side only:

- `tool_timeout_sec`, `enabled_tools`, `disabled_tools` and approval modes are
  **Codex-only**.
- The `ws` transport is **Claude Code-only**; Codex documents stdio and streamable
  HTTP.

A tab that silently dropped a tool allowlist when an agent moved from Codex to
Claude Code would be removing a security control without telling anyone. So the
canonical record keeps every field, and the tab states which ones the target CLI
will not apply — the same discipline the packet uses for a check that did not run.

### One footgun worth handling at the source

Claude Code reads an entry with a `url` and **no `type`** as a stdio server, and
it fails. Since Docket is generating these files rather than asking people to
hand-write them, it should simply never emit that shape — and should repair it
when importing an `mcpServers` block written for another client, which is the
common way people will bring servers in.

> **Amendment 2026-08-20:** built as `src/shared/mcp-config.ts`. Writing it meant
> round-tripping real entries through the installed CLIs (`codex-cli` 0.147.0,
> Claude Code), and four of the claims above did not survive that.
>
> - **The footgun is not what this said.** Claude Code does not read an untyped
>   `url` as stdio and fail. `claude mcp add-json` rejects it outright
>   (`Invalid configuration`), and a hand-written one is *skipped with a named
>   warning* that lists the valid choices itself. The rule — never emit that
>   shape — was right; the reason given for it was wrong.
> - **Importing does not repair it.** Claude Code's own warning offers three
>   choices, so picking one asserts a transport nobody stated for a server Docket
>   has never contacted. The entry is already inert; it is reported instead.
> - **`required` is not demonstrable in 0.147.0.** `enabled = false` round-trips
>   (`codex mcp get` reports the server as disabled); `required = true` produces
>   no output at all. It is not written until it can be shown to be read.
> - **`sse` is not a lossy field on Codex, it is an unsupported server.** Codex
>   accepts `transport = "sse"`, ignores it, and reports the server back as
>   `streamable_http` — as it does for any unrecognised key, which it never
>   rejects. So an SSE or WS server aimed at Codex would look configured, pass
>   inspection, and fail only when an agent used it. Docket declines to write it.
>
> Two findings the plan did not anticipate:
>
> - **`codex mcp list --json` omits `enabled_tools` and `disabled_tools`**, while
>   `codex mcp get` shows both. The structured read — the obvious way to import
>   Codex's config without hand-rolling a TOML parser — is lossy in exactly the
>   dimension this section calls a security control. Every import says so.
> - **Dropping a credential is not the same kind of loss as dropping a timeout.**
>   `bearer_token_env_var` has no equivalent in `.mcp.json`, and the only
>   translation available is to resolve the variable and write the literal into a
>   file meant to be committed. So losses carry a severity: `unsupported` (will
>   not work here), `weakened` (works, and is less restricted than you
>   configured), `dropped` (a preference, nothing breaks). Flattening those into
>   one list is how a tool allowlist disappears among formatting notes.

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
10. **MCP tab.** Independent of the model work and can be built in parallel from
    step 1 — it needs the tab shell and nothing else. Worth doing early because
    it is the one addition with no dependency on sessions.
11. **Resume on reset.** Last, and deliberately. It needs sessions (5) to have
    something to park and re-spawn, the usage reader for Codex's timestamp, and
    the event log from Track 1.4 so an unattended 3am resume is answerable.

## What I could not establish

- **Benchmark numbers are third-party.** `coding_index` and `agentic_index`
  come from Artificial Analysis via OpenRouter. Docket reads them; it has not
  measured them, and the UI must say so.
- **Blog rankings disagree with each other.** Several August 2026 roundups give
  different figures for the same models. None is used above.
- **Free-tier limits vary per account** and, for Groq, are not published at all.
- **Claude Code's limit messages are undocumented as an interface.** The three
  strings above are quoted from its error documentation, not from a stability
  guarantee. Anything built on them can break in a point release, which is why
  the parse fails safe rather than guessing.
- **No exit code or JSON field is documented** for a limit hit in `-p` mode, so
  the terminal string is the only signal found. If one exists undocumented, it
  would be strictly better and should replace the parse.
- **Whether GLM-5.2-free actually drives Docket's charters well is untested.**
  The agentic index is a proxy. The only real evidence is running the nine agents
  against a real repository and reading the packets, which is a day's work and
  should happen before any of this is recommended to a user in the product.
