# Intent versus diff

**Date:** 2026-08-18
**Status:** shipped

The packet has recorded a stated intent since the day it existed and never once
looked at it. Every other field traces to something Docket ran or read; the
intent sat beside them as decoration — which is worse than it sounds, because a
reviewer seeing it printed next to observed facts reads it as one of them.

This compares it against what actually changed.

## What it may conclude: nothing

A claim about intent is not a claim Docket can prove. The intent is English
written by a person; the change is paths and declaration names. No amount of
string matching establishes that a change does what was asked.

So the output is a question, never a verdict:

> The intent names `src/main/token-usage.ts`; nothing in this change matches it.

and the finding is a **note**. It cannot block, and it cannot make a packet
unclean. If it could, a string-matching heuristic would sit in the same column
as an observed test failure, and the reader would be right to stop trusting the
column.

## What counts as checkable

Only terms that unambiguously name something in a repository: a path separator,
a file extension, or the casing of code (`checkRunner`, `check_runner`).
Backticked and quoted spans are taken whole, since someone writing
`` `src/main/runner.ts` `` has named a thing deliberately.

Matching folds case and separators, so `tokenUsage`, `token_usage`,
`token-usage` and `TokenUsage` all match each other. A reviewer who wrote one
and shipped another has done nothing wrong and should not be asked about it.

### The rule that was wrong first

The first version treated any hyphenated compound as filename-shaped. Pointed
at this repository's own diff, it asked about **`intent-versus-diff`** — a
roadmap item and a branch name, not a file.

English hyphenates as readily as filesystems do, and the costs are not
symmetric. A missed question is one the reviewer would have asked anyway; a
false question about a change that is fine is how a reviewer learns to skip the
section. So bare hyphenated terms never raise a question, at the price of no
longer asking about `check-runner`. That price is stated rather than hidden.

## An intent with nothing checkable in it says so

"Make the room feel calmer" names nothing a path can be held against. The packet
reports that plainly rather than staying silent, because silence here reads as a
comparison that ran and was satisfied.

Non-specific terms are carried in the packet too, unreported. A packet that
shows what it looked at is the difference between *checked and found nothing*
and *did not look*.

## What this does not cover

**Symbols from new files were invisible to it.** `changedSymbols()` read
`git diff HEAD`, which covers tracked files only, so a change that added a
brand-new module contributed no symbols at all — a diff containing a new
`src/shared/intent.ts` with eight exported declarations produced an empty
symbol list.

> **Amendment 2026-08-18:** fixed in `workspace-diff.ts`. New files are now read
> directly, since `git diff` has nothing to compare an untracked file against.
> On the same repository the symbol list went from empty to fourteen names, and
> the intent comparison began matching `untrackedSymbols` where it could not
> before. A capped scan and an unreadable file are each reported in the packet
> rather than leaving a short list to be read as "declared nothing".

**It cannot tell a covered intent from an uncovered one.** Everything above is
about whether the *words* and the *diff* line up. Whether the change is the
right change remains a person's judgement, which is the point.
