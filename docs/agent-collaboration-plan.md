# Nine agents that actually collaborate

What Docket has today, what the four asks need, and the order forced by the
dependencies between them. Everything in the first section was read out of the
code or run against the installed CLIs; where something is unverified it says so.

## The short answer to "how are the agents communicating?"

**Docket routes nothing.** It has no transport, no queue, no message bus, and no
handoff. What it has is a renderer-local chat surface over an activity log.

But "the agents do not communicate" would be wrong, and the distinction matters
for what to build next:

- The charters Docket writes are **real Claude Code subagent definitions** —
  `name`, `description`, `tools`, `model` frontmatter (`agent-roster.ts:433-441`).
  `description` is documented as *when the lead should hand work to this agent*.
- The Lead charter is delegation instructions in prose: implementation to
  `@engineer`, verification to `@tests` (`agent-roster.ts:88-101`).
- So **delegation happens inside the one CLI process**, and Docket watches it
  through `SubagentStart` / `SubagentStop` hooks.

Docket configures the collaboration and observes it. It never carries a message
between two agents. Every "conversation" on screen is one of: a detector result
restated, a hook event printed, or something a person typed.

The app already admits this where it matters — the Send button under each desk
in the Office says so in a toast: *"Delivery to its session is not built yet."*

## What is true today

### Agents are files, not processes

One PTY for the whole application. The per-purpose rule at
`pty-manager.ts:241-243` permits one terminal per purpose per window, there is
only ever one window (`index.ts:99-100`), and IPC is refused from anywhere else
(`ipc-handlers.ts:484-499`). `MAX_GLOBAL_TERMINALS = 8` is therefore unreachable;
the real ceiling is **one session, app-wide**.

Three further locks, each deliberate:

- **argv is an exact-match allowlist** with empty args for a session
  (`security-policy.ts:10-27`), so `--agent`, `--model`, `-p` and a prompt are
  not expressible at spawn.
- **Nothing in the spawn path carries an agent id** — not the request
  (`ipc-contract.ts:125-130`), not the options (`pty-manager.ts:36-54`), not the
  result.
- **The environment is built from scratch** off a fixed name allowlist with
  `PATH` overwritten (`platform-layout.ts:279-328`), so no credential or model
  can be injected.

What *is* open is stdin: `terminalWrite` reaches the PTY (`ipc-handlers.ts:446`),
and the Stream composer forwards every typed line to the controller CLI
(`app.tsx:271`). Prompts flow continuously; only the argument vector is closed.

Per-agent model choice also already works, but only on one side — it is written
into `.claude/agents/*.md` frontmatter, which Claude Code reads, and into a prose
table in `AGENTS.md`, which Codex does not read as configuration.

### The room is renderer state and nothing more

`Room`, `Message`, `Ticket` and `Channel` are a real, immutable, well-typed model
(`room.ts:18-54`) living in one `useState` (`app.tsx:44`).

- `room.ts` is imported by exactly four renderer files and by nothing in `main/`
  or `preload/`.
- `Ticket`, `Room` and `Message` appear **zero times** in `ipc-contract.ts`.
- Nothing is persisted at any layer. Close the window and every message and
  ticket is gone.

`channelId` is half a data field and half a tab selector: two of the four
channels swap in a different component rather than filtering messages.

### No agent has ever raised a ticket

Five charters instruct the model to "raise a ticket" (`agent-roster.ts:102`,
`:107`, `:126`, `:153`, `:477`). That is English written into a markdown file.
There is no tool, no output format, and no parser. The only thing that parses
agent output is `claims.ts:117-142`, which extracts test, lint, typecheck and
build pass/fail for the evidence packet and has no notion of a ticket.

So the ticket panel's own empty state — *"Agents raise one when a unit is
blocked"* — describes a code path that does not exist.

### Positions exist as discipline, not as territory

Nine agents, each with a hand-written charter of 15-25 lines. Genuinely distinct
specialities, nothing templated. `role` even renders under a column headed
**"Owns"** in `AGENTS.md`.

But "Owns schema and migrations" is prose. `AgentDefinition`
(`agent-roster.ts:66-86`) has no path, glob, subsystem or layer field, and
neither does `AgentTeamMember` in the IPC contract. Nothing constrains an agent
to any part of the repository at runtime.

**The territory is already computed and then thrown away.** `detect-agents.ts`
matches real path patterns — `/(^|\/)migrations?\//` selects `data`,
`/\.(tsx|jsx|vue|svelte)$/` selects `interface` — to decide whether an agent
joins the team, and returns `{id, reason, evidence}` where the evidence *is the
matching paths*. After selection they are discarded. This is the single most
useful fact in this document: ownership does not need inventing, it needs
keeping.

### A pipeline model exists and is one third wired

`Zone` is `intake → desk → review → lab → waiting → shipped`, documented as a
left-to-right pipeline, and `Presence` carries `toward: AgentId | null` — an
explicit agent-to-agent edge (`office-scene.ts:32-50`).

Only two of the six zones are ever set from a real event: `app.tsx:149` assigns
`desk` on start and `shipped` on stop. The other four, and every non-null
`toward`, came from a demo fixture in `office.tsx` — which is imported for a
*type only* (`app.tsx:27`), so the component never renders. The arcs showing one
agent handing to another are unreachable code.

### The board, measured against Jira

Three hardcoded columns (Open, Blocked, Resolved), draggable cards, a modal
detail sheet, and a redundant flat list in the side panel — the same ticket can
be on screen three ways.

A ticket has eight fields. Missing against any real tracker: **persistence of
any kind**, comments, history, reorder within a column, edit, delete, filter,
search, sort, priority, labels, links between tickets, and keyboard movement.
`at` is set on every ticket and rendered nowhere.

Three defects worth naming separately, because they are bugs rather than absences:

- **The assign chips are a hardcoded list of eight ids that omits `lead` and is
  not filtered by the detected team**, so work can be assigned to an agent that
  is not on this repository.
- **The evidence chips can never appear.** Neither caller of `raiseTicket` passes
  evidence, and both render sites are guarded on a non-empty list.
- **The `#tickets` composer path is dead code.** The Board replaces the Stream
  for that channel, so the branch that promotes a message into a ticket cannot
  run. There is exactly one create path, not two.

## What has to be built, and why in this order

### 1. Tickets that outlive the window

Move `Room` out of React state into the main process, persisted per workspace,
carried over IPC. Nothing else on this list is worth building on top of state
that a window close destroys. This is also what makes the board Jira-shaped
rather than Jira-coloured — comments and history are cheap once there is a
store, and impossible before it.

### 2. Ownership as data, not prose

Keep what detection already found. Add an owned-paths field to the team member
record, seeded from the detection evidence and editable per agent.

Two things become possible immediately, neither needing agent sessions:

- **`AGENTS.md` can state territory**, so the Lead delegates by path rather than
  by guessing from a role description.
- **A ticket can route itself** — the diff touches `migrations/`, the ticket goes
  to `data` — instead of relying on a person typing the right `@mention`.

Ownership must overlap gracefully. Two agents owning `src/api/` is normal; the
answer is a ranked list, not an error.

### 3. A ticket protocol an agent can actually use

Prose in a charter is not an interface. Agents need a way to emit a ticket that
Docket can parse, held to the same standard as `claims.ts`: a stated format, a
parser, and a test that a malformed emission is reported rather than dropped.

Until this exists, "agents raise tickets" is a sentence in a markdown file.

### 4. Agent sessions

Plan step 6, unchanged and still the gate. Until an agent is a process, there is
nothing to hand off *to*, no per-agent metering that is not an estimate, and no
way to walk into a session because there is no session.

### 5. Handoff, once 2, 3 and 4 exist

A handoff is then a real sequence rather than an animation: an agent finishes a
unit, emits a claim and a ticket, Docket routes it to the owner of the paths the
change touched, and that agent's session picks it up. The `toward` edge in the
scene model finally has something to draw, and the four unwired zones get real
events instead of a fixture.

### 6. The board as a tracker

Persistence, comments, history, filters, priority, links. Worth doing last
because every one of them is more useful when tickets come from agents than when
they come only from a person typing.

## The honest part

**More agents is not automatically better than one session**, and a plan that
assumes it is will produce a slower, more expensive version of what Claude Code
already does — its subagent system delegates today, inside one process, for free.

The gains that are real and specific:

- **Bounded context per agent.** Nine seats each holding one concern beats one
  context holding all nine, and a blown context takes one agent down rather than
  the team.
- **Parallelism**, which one process cannot give at all.
- **Per-agent provider and model** — the cheap agent on a cheap model, the
  reviewer on the strong one — which needs sessions to mean anything on Codex.
- **Per-agent metering and evidence**, because Docket spawned the process and
  knows whose work it was. Transcripts carry no subagent attribution, so this is
  only obtainable this way.

Those are worth building. "Nine is better than one" on its own is not, and the
product should not claim it.

## Verified while writing this

- **Docket's hook shape works.** `agent-events.ts` writes a hook as
  `{type: "command", command: "/bin/sh", args: [...]}`, which is not the
  single-string form the documentation shows. Both shapes were configured side by
  side and fired identically, producing the same 522-byte payload. The concern
  that Docket's form was invalid is unfounded.
- **What remains unverified** is the `SubagentStop` payload. A `SessionStart`
  hook delivers `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
  `source`. Whether `SubagentStop` carries the `agent_type` and
  `last_assistant_message` keys the parser expects has not been observed against
  a real subagent run, and the divergence demonstration used a hand-written log
  line. This should be confirmed before anything else is built on it.
