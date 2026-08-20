# A model is named by who serves it

Which model an agent runs used to be one word — `opus`, `sonnet`, `inherit` —
and that was enough while every agent ran on Anthropic through Claude Code. It
stops being enough the moment a second service can serve a model, because a bare
name does not say who serves it.

`z-ai/glm-5.2:free` on OpenRouter and the same weights pulled into a local Ollama
are the same model and **not the same configuration**: different endpoint,
different credential, different cost, different rate limit, and a different
answer to "why did this agent stop". Collapsing them to one label would make the
difference invisible in exactly the place someone would look for it.

So identity is the pair, in `src/shared/agent-model.ts`:

```ts
{ provider: "openrouter", model: "z-ai/glm-5.2:free", credential: "openrouter" }
```

## The credential is named, never held

`credential` is the *name* of a stored credential. This record is written into
Docket's own configuration file, which is not built to hold a secret at rest —
secret storage arrives separately, and until it does this field names something
that does not exist yet rather than holding something it should not.

The config-store test that asserts no credential reaches that file used to match
the whole text against `/api[_-]?key|credential|password|secret|token/i`. It
began failing the moment a field was honestly *named* `credential` while holding
null — it was catching the word rather than the thing. It now walks the parsed
values and runs the gate's own `scanSecrets` rules over them, which is stricter
about what matters and blind to what does not.

## What reaches each CLI

- **Anthropic keeps its alias**, because that is what Claude Code's subagent
  system reads from `.claude/agents/<handle>.md`.
- **Anything else emits the model id.** Reaching it means pointing Claude Code at
  a gateway, and the far end wants the id the gateway maps — not a word that
  only means something to Anthropic.
- **Inheriting writes no `model:` key at all.** The literal word `inherit` in
  frontmatter would be a setting; the point is that Docket is not setting one.
- **`AGENTS.md` now says so.** The model column carries `qwen3-coder via ollama`
  rather than a bare id, and the file states plainly that nothing reads the
  model from it — Codex does not, and changing it there changes nothing. That
  correction was already recorded in the platform plan; this is it applied.

## Migration

`schemaVersion` moves to 4. A stored bare string still loads: every value the old
shape could hold was an Anthropic alias, so the service is not a guess — it is
the only thing it could have meant. A value naming a service but nothing to run,
or a service Docket does not know, is dropped rather than carried, on the same
reasoning as everything else in that file: a half-understood model would be
written into a real charter and discovered when the agent failed to spawn.

## Not done here

No UI. The settings surface still offers the four Anthropic aliases and
inheriting — what Docket could already reach — because an option with no
credential behind it is a control that silently does nothing. A stored choice
with no offered equivalent shows as unselected rather than quietly reading as
the first option in the list.
