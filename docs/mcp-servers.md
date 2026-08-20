# One MCP server, two formats

Docket configures an MCP server once and hands it to whichever CLI an agent is
running. That would be a thin editor over a file if the two formats agreed. They
do not, and the disagreements are not cosmetic: the same server can arrive at the
other CLI missing its authentication, missing its tool restrictions, or looking
configured and failing only when an agent tries to use it.

`src/shared/mcp-config.ts` holds one canonical record and projects it into both.
Every projection reports what the target will not apply.

## How this was established

By round-tripping real entries through the installed CLIs — `codex-cli` 0.147.0
and Claude Code — not from documentation. On three points they disagree:

- `claude mcp add --transport` advertises `stdio, sse, http`. The schema also
  accepts `ws`, writes it, and Claude Code's own skip-warning names `ws` as a
  valid choice.
- Codex accepts `transport = "sse"`, ignores it, and reports the server back as
  `streamable_http`. It does the same with any unrecognised key — a made-up key
  in an `[mcp_servers.*]` block produces no error at all.
- `codex mcp list --json` omits `enabled_tools` and `disabled_tools` entirely,
  while `codex mcp get` shows both.

Reproduce any row below with a throwaway `CODEX_HOME`, or with
`claude mcp add-json <name> '<json>' --scope project` inside a scratch
repository. Never against a real home directory: these commands write.

## The matrix

| Concept | Claude Code `.mcp.json` | Codex `config.toml` |
|---|---|---|
| stdio command | `command` | `command` |
| arguments | `args` | `args` |
| environment | `env` | `[mcp_servers.X.env]` |
| forwarded variable names | — | `env_vars` |
| working directory | — (accepted, dropped) | `cwd` |
| remote address | `url` **and a required `type`** | `url` |
| remote transports | `http`, `sse`, `ws` | streamable HTTP only |
| literal headers | `headers` | `[mcp_servers.X.http_headers]` |
| header from a variable | — | `[mcp_servers.X.env_http_headers]` |
| bearer token from a variable | — | `bearer_token_env_var` |
| OAuth client | `oauth.clientId`, `oauth.callbackPort` | `[mcp_servers.X.oauth] client_id` † |
| off without deleting | — (accepted, dropped) | `enabled` |
| tool allowlist | — | `enabled_tools` |
| tool denylist | `tools[].permission_policy` ‡ | `disabled_tools` |
| startup timeout | — | `startup_timeout_sec` (default 10) |
| tool-call timeout | `timeout`, **milliseconds** | `tool_timeout_sec`, **seconds** (default 60) |

† `codex mcp add --oauth-client-id` writes this shape, so it is Codex's own, but
neither `codex mcp get` nor `codex mcp list --json` reports it back. Docket
writes it and says it cannot confirm it was applied.

‡ Claude Code's is a *permission* policy — `always_allow`, `always_ask`,
`always_deny` — not a filter. Codex hides a disabled tool; Claude Code offers it
and refuses the call. It is accepted on `http` and `sse` entries and **silently
stripped from `stdio` ones**, so the same field is carried in one place and lost
in the other. There is no way to express an allowlist: naming what is permitted
needs the full set of tools a server offers, which Docket has not asked for.

Codex infers the transport from the presence of `url`; it has no `type` key.
Claude Code requires `type` on any entry with a `url` and skips entries without
it. Docket writes `type` on every entry including stdio, where it would be
inferred, because inference is what produces the failure in the first place.

## Some fields are carried, but changed

`losses` means *not applied*. A second list, `notes`, means *applied
differently*, and they are kept apart because a person scanning warnings should
not have to read each one to learn which kind it is. A tool timeout survives the
trip and the number does not: Codex counts seconds, Claude Code milliseconds,
and Claude Code ignores anything under a second and falls back to its own
default — so a sub-second timeout is reported as dropped rather than written as
a setting that does nothing.

## Losses have a severity

Flattening "not applied" into one list is how a tool allowlist disappears among
formatting notes. Three levels, ranked worst first:

- **`unsupported`** — the server will not work here, so Docket does not write it.
  An SSE or WS server aimed at Codex. A bearer token aimed at Claude Code.
- **`weakened`** — it works, and is *less restricted* than configured. A tool
  allowlist or denylist that Claude Code cannot hold: every tool the server
  offers becomes available to the agent.
- **`dropped`** — a preference is not carried over. Behaviour may differ; nothing
  breaks and nothing is loosened. `cwd`, the timeouts, `env_vars`.

## Two refusals

**A credential is never inlined to make it fit.** `bearer_token_env_var` and
`env_http_headers` name a variable rather than holding a value, and `.mcp.json`
has no equivalent. The translation exists — resolve the variable, write the
literal — and it puts a live credential into a file whose whole purpose is to be
committed. Docket reports the loss instead of performing it.

**A disabled server is left out of `.mcp.json`, not written into it.** Claude
Code accepts an `enabled` key and drops it, so writing the entry would run a
server that was switched off. Omitting it is the only projection that preserves
the intent, and the omission is reported so it is never a silence.

## Editing Codex's file

`config.toml` holds a person's entire Codex setup — model, provider, sandbox
policy, approval rules. Reading it, re-serialising it and writing it back would
put all of that at the mercy of a TOML writer in order to edit one section.

So Docket owns the text between two markers and nothing else:

```toml
# >>> generated by Docket: mcp servers >>>
# <<< generated by Docket: mcp servers <<<
```

`spliceCodexRegion()` replaces that span and preserves every other byte exactly,
including comments and formatting a parser would discard. It is pure, so the one
operation that can destroy a Codex setup is held by the suite rather than
discovered in the field. A file missing both markers gets the region appended. A
file with one marker of the pair, or with them in the wrong order, **throws** —
guessing which half to trust means guessing which span of configuration to
delete.

Reading is not attempted from TOML at all. `codex mcp list --json` makes Codex
parse its own format, which is the only way to read a file that may contain any
TOML a person can write. The cost is that the tool allowlist and denylist are
invisible in that output, so every import says so rather than implying it saw
everything.

## What a second look changed

The first version of this module reported four things as losses that are not.
Each was found by round-tripping against the installed CLIs a second time, not
by re-reading the code:

- **`.mcp.json` does support OAuth.** `oauth.clientId` and `oauth.callbackPort`
  round-trip. They were reported as Codex-only and dropped.
- **`.mcp.json` does support a tool-call timeout**, as `timeout` in
  milliseconds. It was reported as Codex-only and dropped.
- **`.mcp.json` does support per-tool permission policies** on remote entries,
  so a denylist survives rather than vanishing.
- **Codex's `oauth.client_id` cannot be shown to be read**, though Codex's own
  CLI writes it — the same standard that kept `required` out, applied
  inconsistently the first time.

The lesson is not about MCP. Three of the four were fields reported as *missing*
from a CLI that has them, and a projection that under-claims its target is as
wrong as one that over-claims it: it sends a person off to solve a problem they
do not have.

## The tab

Docket holds one list, stored in its own configuration, and both files are
projections of it. Neither CLI's file is the source of truth, because neither
can hold every field — reading either one back would silently drop whatever it
cannot express.

Three things the surface does that a plain editor would not:

- **Each row says where the server will run before Apply is pressed.** An `sse`
  or `ws` server shows Codex as unreachable, with the reason, at the moment it
  is added rather than in a report afterwards.
- **Applying reports three things separately** — what was written, what was
  carried across in a different shape, and what was not carried at all, ranked
  so a lost restriction never sits below a lost preference.
- **A server Docket does not manage is preserved byte for byte.** Entries
  already in `.mcp.json` are merged around Docket's own rather than parsed into
  the canonical record and back, because a round trip through a record that does
  not know a field is how the field gets deleted by a tool somebody opened to
  change something else.

### Importing reads both sides, in two passes

A server configured in one CLI is invisible in the other, so importing from a
single file would look complete while being half.

Codex's side takes two commands, and the second one is the point. `codex mcp
list --json` is the only safe way to read a TOML file that may contain any TOML
a person can write — Codex parses its own format — but that output omits
`enabled_tools` and `disabled_tools` entirely. Importing through it alone would
drop a tool restriction on the next write and tell nobody. So every server is
asked for again with `codex mcp get`, which prints both.

That second pass is a parse of human-facing text, which is the kind of thing
that breaks quietly when a CLI reformats, so it is written to fail loudly:

- An **absent line means absent**. A line that is present but yields nothing is
  reported as unreadable, because "no tools are blocked" and "the blocked tools
  could not be read" must not look the same to the caller.
- A server whose second pass fails is still imported, **with the loss stated**.
- The separator is a comma and a tool name may contain one. Nothing in the
  output distinguishes those cases, so a name containing a comma will split
  wrongly. Stated here because it cannot be detected.

`.mcp.json` is read first and wins a tie: it belongs to this repository, while
Codex's configuration is shared by every repository on the machine. A server
configured in both is reported as shadowed rather than silently merged.

Both reads go through an allowlist, exactly as a session spawn does, because
they reach the same executables and differ only in not getting a terminal.
`codex mcp get` takes a server name, which cannot be enumerated in advance, so
the verb is fixed and the argument is validated against the same pattern Docket
enforces when a server is created — a name that fails is one Docket could not
have written.

## The gate sees this file

An MCP server is a set of tools an agent can call, so `.mcp.json` decides what
an agent could have done. Docket's own patch-scope rules did not classify it
until Docket started writing it — the wrong order to notice that in — and the
same rule missed `.codex/config.toml` for the duller reason that it only matched
`.json`, and Codex's configuration has never been JSON. Both are now
`agent-config` in `src/shared/sensitive-paths.ts`, so a change to either is
called out in the packet like any other change to agent tooling.
