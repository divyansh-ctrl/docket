# The divergence case, demonstrated

**Date:** 2026-08-18
**Status:** observed, on `main` at `6e0de33`

The roadmap's Phase 1 exit criterion, and the reason the product exists: an
agent says the checks pass, Docket runs them, and the disagreement reaches the
reviewer first. This records the run. It is not a fixture — the claim came
through the hook-log path, the checks ran in a container, and the failing test
fails because of a real bug in the subject repository.

## The subject

A small repository implementing refresh-token rotation, with a genuine defect:
`rotate()` issues a new token and leaves the presented one valid, so a stolen
token keeps working. Its own suite has a test for exactly that, and the test
fails.

```
npm test        # 2 tests, 1 pass, 1 fail
not ok 2 - a rotated token cannot be reused
```

## The claim

Written into an activity log in the CLI's own hook format and read back
through `watchAgentEvents` — the same path a real subagent stop takes, not a
constructed object handed to the comparison:

```json
{"hook_event_name":"SubagentStop","agent_type":"engineer","agent_id":"run-77",
 "last_assistant_message":"Implemented refresh token rotation in src/tokens.mjs.
  Ran the suite: 2 of 2 passing. Lint is clean. Ready to merge."}
```

`extractClaims` read two claims from it, each carrying its own sentence:

```
{"text":"Ran the suite: 2 of 2 passing","kind":"test","verdict":"passed","agentId":"engineer"}
{"text":"Lint is clean","kind":"lint","verdict":"passed","agentId":"engineer"}
```

Note what it did *not* extract: "Implemented refresh token rotation" and
"Ready to merge" are not claims about checks and never became one.

## What Docket observed

Both checks discovered from the repository's own manifest and run by Docket's
runner, contained:

```
npm run lint: passed (exit 0, container)
npm run test: failed (exit 1, container)
```

## The packet

```
VERDICT: Something here should stop a merge.
CLEAN:   false

1. [blocking] An agent says the tests pass. They fail.
   The claim, verbatim: "Ran the suite: 2 of 2 passing". Observed: npm run test
   exited 1. The disagreement between an agent's account and an observed run is
   exactly what this packet exists to catch -- read the check's output before
   anything else here.

2. [blocking] npm run test failed
   Exited 1. The output is attached in full.

3. [note] One agent claim matched the observed result

4. [note] 2 contained checks came with a qualification
```

The divergence is first, ahead of the failure it is about. That ordering is the
point: a red suite is information a reviewer will find anyway; an agent
reporting green over it is the thing they would otherwise have believed.

The lint claim was true, and is recorded as a checked fact rather than passed
over in silence — absence of divergence is a finding here, not a default.

## The control

Fixing the bug — one line, `store.delete(presented)` — and re-running the same
demonstration unchanged:

```
1. [note] 2 agent claims matched the observed results
2. [note] 2 contained checks came with a qualification
```

The blocking finding disappears because the disagreement disappears, not
because anything about the comparison changed. Both directions observed.

## What this does and does not establish

**Does:** the machinery works end to end on a real repository — hook log to
claim to comparison to ranked finding — and it is sensitive in both
directions.

**Does not:** prove the extractor's coverage against the full range of things
real agents write. It is deliberately narrow, and a claim phrased in a way no
rule matches is silently not compared. The honest reading of a packet with no
claim findings is "no claim was recognised", not "the agent said nothing
wrong". Widening coverage is a matter of collecting real summaries over time,
and every widening carries the same risk in the other direction: a rule loose
enough to catch more phrasings is a rule that can invent a claim nobody made.
