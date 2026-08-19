# What governs the verification

**Date:** 2026-08-19
**Status:** shipped — second half of Track 1.3

Everything else in a packet answers *is this change correct*. This answers a
prior question: **is the rest of this packet worth what it appears to be
worth.**

A suite that passes proves less if the same change edited the workflow that runs
it, the lockfile that supplies its dependencies, or the ignore rules that decide
what Docket can see at all.

## Why "stated scope" became this

The roadmap called 1.3 "files touched outside the stated scope". Nothing in
Docket declares a scope, so that phrase had no referent, and there were two ways
to give it one:

**Intent-derived** — files changed that the intent never names. It is the mirror
of the [intent comparison](intent-versus-diff.md), and it reuses that term
extraction. It was rejected: almost every real change touches tests, docs and
lockfiles the intent does not mention, so the finding would fire on nearly
everything and mean nearly nothing. A second heuristic layered on the first also
compounds the false-question problem that one already had to be narrowed to
avoid.

**Position-derived** — the categories below. Deterministic, no drift, and it
strengthens the packet's central claim instead of adding a guess. That is what
shipped.

## The categories

| Category | Why it repays a look |
|---|---|
| CI configuration | The checks here ran under a configuration this change edits |
| Git hooks | The local gate runs before anything here sees the change |
| `docket.json` | Decides which checks exist at all |
| Agent tooling config | Decides which hooks fire, and so which claims this packet could ever compare |
| Container definitions | Decides what "contained" covered |
| Install lifecycle scripts | Run on any machine that installs the project, before any check |
| Ignore rules | Can remove a file from every diff here without removing it from the repository |
| Dependency lockfiles | Decide what code the checks actually ran against |

Check drift already covers a check whose *definition* moved. This covers the
machinery around it, none of which is a declared check.

## Two things it is careful about

**It states a fact, not a suspicion.** A path changed; that is observed and it is
all that is claimed. Editing CI is ordinary work. The wording says what the
change means for the other evidence — never that something is wrong, and never
that an intent was concealed. A test asserts the detail text contains no
accusatory vocabulary.

**Nothing here blocks.** A gate that stopped every branch touching
`.github/workflows` would be overridden within a week and would then be stopping
nothing. These sit at the level that makes a reviewer read the diff, which is
the action actually wanted. Lockfiles are quieter still — a `note` — because they
move constantly.

## `package.json` is decided by content, not by path

A manifest edit is not interesting; a manifest edit that *adds a `postinstall`*
is. So the install-hook category is matched against the added lines rather than
the filename. Every `package.json` change would otherwise be reported, and almost
none of them adds a lifecycle script.

Read as text rather than as JSON, because the input is a diff: a manifest may not
parse mid-change, and only the added lines are the change.

## What it does not do

**It does not know why.** A change can edit CI for entirely good reasons, and
this cannot tell those from the other kind. It puts the fact where a reviewer
will see it and stops there.

**It does not cover what it has not heard of.** The category list is grounded in
what real repositories carry. A build system nobody here has met is not in it,
and its absence from the findings means it was never looked for.
