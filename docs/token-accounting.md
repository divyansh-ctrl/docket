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

> **Amendment 2026-08-18:** "Permanently" was wrong, and wrong in the way this
> document warns against — it stated a fact about the world on the strength of
> one directory being empty. Codex does record usage, in more detail than
> Claude Code does: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Docket now
> reads it. The paragraphs above stand as written because they were accurate
> about the file they looked in; what follows is what was found when someone
> looked elsewhere. See [Reading Codex](#reading-codex) below.

## Reading Codex

Codex writes a `token_count` event as it goes, and it carries more than the
Claude Code transcripts do — a running total, the turn inside it, the model's
context window, and the account's rate limit.

It also counts by three conventions that are each the **opposite** of the
Claude Code ones. Reusing the reader beside it would have misreported every
figure while looking entirely reasonable.

| | Claude Code | Codex |
|---|---|---|
| Totals | per record, deduplicated by request id | **cumulative** — only the last one counts |
| Cache reads | reported beside input | **inside** `input_tokens`; fresh input is `input − cached` |
| Context window | never stated | **stated** — so a percentage is read, not assumed |
| Rate limit | never stated | **stated** — used percent, window length, reset time |

### The prefix a resumed session inherits

A rollout file does not always start from zero. A resumed or forked session
opens on the running total of the conversation it continued. On the machine
this was written against, six files opened past 128 million tokens — five of
them on the *same* 128 million, forks of one point.

Summing per-file finals counted that prefix five times and overstated the true
figure by **780 million tokens, 14.5%**. So each file contributes what it
*added*: its final total minus the total it opened on. That opening total is
recoverable exactly, because the first event carries both the running total and
the turn inside it, and their difference is what came before.

This is the same defect that inflated the first Claude reader two to three
times before it deduplicated by request id, wearing different clothes. It is
worth naming as a class rather than a bug: **a transcript's totals belong to
the transcript, not to the record they appear on.** Both formats invite the
mistake and neither announces it.

### A percentage, at last

`model_context_window` is in the file, so a Codex session can be told it is
213k into a 258k window — 83% — with a denominator that was read rather than
assumed. Where a record omits it, and a handful do, there is no percentage
rather than a default.

The reader reports the window; **the desk panel does not draw it yet**. The
panel is guarded by the office walk gate, and the walk could not be done (see
below), so that change is held back to its own review rather than merged
unwalked.

### A limit that has reset is not a limit

`rate_limits` carries the window used, its length, and when it resets. These
files keep the *last* limit Codex was told about, and that can be months old:
the newest reading in one directory here resets in May and was read in August.

A window whose reset has passed has reset. The percentage in the file is a fact
about a window that no longer exists, so a limit past its reset is reported as
**no reading** rather than as a stale one. Showing "45% used" from May in August
is exactly the failure this product exists to remove.

### What is not verified

The reader was run against the real `~/.codex/sessions` directory — 162 files,
three workspaces, sub-second — and its arithmetic checked against the raw
files by hand.

The **desk panel showing a Codex reading has not been seen**, so the panel
change is not in this one. No Codex session has ever run in a Docket checkout,
so on this machine the panel would correctly report nothing to count, and
driving the app to a workspace that does have one was not available.

The office walk gate caught this on its own: the panel edit touched
`office-floor.tsx` and recorded no walk, and it failed the build for it. That
is the gate doing exactly its job on its author, which is the only test of it
that counts. The reader is verified; the pixels are unbuilt, not unchecked.

## Not in the packet

Deliberately. The evidence packet is about whether a change is safe to merge;
what a session cost is operational information for the person driving the
office. Putting cost in the packet would dilute the one artifact whose job is
to be read before a merge decision.
