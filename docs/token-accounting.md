# Counting tokens

**Date:** 2026-08-18
**Status:** shipped

The desk panel said `ctx not measured` from the day it was written, because
nothing counted and showing a number nobody counted is the failure this
product exists to remove. This counts them.

## Where the numbers come from

The CLI writes a transcript for every session under
`~/.claude/projects/<slug>/*.jsonl`, and every assistant turn in it carries a
`usage` block. That is the only authoritative record of what was spent, so it
is the one Docket reads. Docket keeps no running total of its own — a second
tally would drift from the record that actually matters.

Only `usage`, `cwd`, `model`, `timestamp` and `requestId` are read. The
conversation itself is none of Docket's business and is never held; there is a
test asserting no content survives into the reading.

The workspace is matched to its transcripts by the CLI's directory naming, and
then **confirmed** against the `cwd` each record carries. A guess about another
tool's layout is never trusted on its own: a mismatch reports no reading rather
than someone else's numbers.

## Three things it refuses to do

**It does not attribute tokens to individual agents.** This is the big one, and
it is why the rail still does not show a per-agent meter. The transcripts carry
no per-subagent marking — 90 files and 60,000 records on the machine this was
built on, not one turn attributed to a subagent. Splitting a session figure
between the nine faces in the rail would be arithmetic on an assumption. The
panel says "this whole session, not *Atlas* alone" instead.

**It does not add cache reads to fresh input.** A cached read is charged at a
fraction of a fresh one. On this repository's own session the split is 17,452
fresh against 239,892,837 cached — summing them would overstate the bill by
four orders of magnitude, in exactly the case where a person is checking
whether they are about to run out.

**It does not show a percentage of a context window.** That needs a
denominator, and the window size is something Docket would be assuming rather
than reading. The prompt size on the most recent request is a measurement;
"62% full" would be a guess wearing a measurement's clothes.

## The bug worth recording

The first working version was wrong by two to three times, and looked entirely
reasonable while it was.

A single API request is written to the transcript as **several records** — the
text, the thinking, each tool call — and every one of them repeats the *same*
usage block. Summing records instead of requests counted most turns two or
three times. It was caught by running the reader against this repository's real
transcript and noticing the turn count was implausible; deduplicating by
`requestId` halved every figure.

Nothing in the unit tests would have found it, because the fixtures were
written from the same misunderstanding as the code. What found it was pointing
the thing at reality and looking at the answer.

## What it looks like

```
ctx 517k   in 17k   cached 240M   out 634k
This whole session, over 789 turns — not Atlas alone.
The CLI does not record which agent spent what.
```

Hovering any figure gives the exact count and what it means.

## It reads one CLI's format

These are the **Claude Code** CLI's transcripts. Docket can be driven by Codex
too, and a Codex-led session writes nothing here — so for one of those the
answer is "not measured", permanently.

The reason text says which CLI is leading rather than saying "no transcript
yet", because "yet" reads as "one is coming" and for Codex none ever is.
Telling someone to wait for a thing that will never arrive is worse than
telling them it is not available.

This was found by running the finished feature against the real app, whose
open repository happened to be a Codex-led one.

## Not in the packet

Deliberately. The evidence packet is about whether a change is safe to merge;
what a session cost is operational information for the person driving the
office. Putting cost in the packet would dilute the one artifact whose job is
to be read before a merge decision.
