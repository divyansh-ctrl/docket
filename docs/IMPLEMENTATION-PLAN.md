# Docket implementation plan

**Status:** build sequence
**Date:** 2026-08-17

[ROADMAP.md](ROADMAP.md) says what has to become true and how we will know.
This says what to build, in what order, and why that order. It covers the
desktop app, the dashboard, and running Docket on a machine that is not this
one. It assigns no dates, for the reason the roadmap gives: dates before design
partners are guesses wearing a schedule.

## Where the build actually is

The gate's primitives exist and work: check discovery from the repository's own
manifest, drift detection against the committed declarations, real execution
with true output and process-group cancellation, a container executor with
default-deny egress, a fail-closed require-isolation setting, an evidence packet
with blast radius, and a hash-chained sealed decision record.

What does not exist is the thing those primitives are for. Nothing yet compares
what a change was supposed to do against what it did, and nothing yet catches an
agent claiming a check it did not run — the roadmap's Phase 1 exit criterion,
and the product's stated reason to exist.

## The finding that reorders the work

Running this repository's own desktop checks through Docket, contained, on a
working tree that is green on the host, produced **five failures**. None were in
the code. Three causes:

1. only the workspace was mounted, so tests reading a sibling package found
   nothing — **fixed**, the repository is now the mount;
2. `node_modules` is the host's, so a macOS-built native binary cannot load
   under Linux;
3. the container has no passwd entry for the host uid, so `os.homedir()`
   returns `/` and a test asserting on the home directory gets a different
   error than it expects.

Causes 2 and 3 remain. They matter more than any unbuilt feature. Docket's whole
claim is that its evidence is worth more than the agent's summary, and a
contained run that reports a repository's passing tests as failing is worth
less. It is also the harder failure to notice, because it looks like a finding.

So the first track is not a feature. It is making a contained result mean what a
reviewer will assume it means.

> **Amendment 2026-08-17.** Fixing the mount widened the suite that could run,
> and the same experiment then produced **eighteen** failures rather than five,
> from two causes the list above did not have. Both are worse than the ones it
> did have, because both break every repository rather than this one:
>
> 4. **The image had no Git.** `node:22-bookworm-slim` does not ship it, and
>    fifteen of the eighteen were `spawn git ENOENT`. Shelling out to Git is
>    among the most ordinary things a check does, and Docket's own drift
>    detection is one of the things doing it.
> 5. **A linked Git worktree has no Git inside the mount.** Its `.git` is a file
>    pointing into the main checkout, which is outside the mount and therefore
>    nowhere at all in the container.
>
> Causes 1, 3, 4 and 5 are now fixed and 2 is detected rather than fixed; the
> count is down to the two node-pty failures that 0.3 exists for. The lesson is
> worth more than the fixes: every one of these was found by running the gate
> against a real repository, and none of them by reasoning about it. Track 0.5
> is what makes that experiment repeatable instead of occasional.

## Track 0 — Contained evidence a reviewer can trust

Blocking. Everything below inherits its credibility from this.

**0.1 — Never report an environment failure as a test failure. — done.**
Docket already refuses to collapse "did not run" into "failed" for timeouts and
spawn errors. The same rule now reaches inside the container: a module that
cannot load for the wrong architecture, a program that is not installed, a
missing account entry. Those are `errored` with the line that said so, and
`isEvidence()` is false for them. The patterns are read from output, so they can
misfire; they are held narrow, and the residual risk points the safe way — a
false positive says "no evidence", which is never a false assertion, while the
failure it replaces would have said "your code is broken".

**0.2 — Detect the host/container mismatch before running, not after. — done.**
The mount probe proves the repository is visible. It does not prove the run will
be equivalent, and two preconditions now prove that separately: that the
installed dependencies contain a loadable object file for the container, and
that Git still works inside the mount. Either failing sends the check to the
host with the reason attached, exactly as an unreachable mount does.

The dependency probe is deliberately narrow. A package shipping a macOS binary
*next to* a Linux one is healthy — prebuildify puts every platform in one
tarball — so the finding is not the presence of a foreign binary but the absence
of a usable one.

**0.6 — An image that has what checks need. — done.**
`node:22-bookworm` rather than `-slim`, for Git. The full image also carries the
compiler that 0.3's install needs for any dependency without a Linux prebuild,
so the same change serves both. A per-repository image is Track 2.2.

**0.3 — Give the container its own dependencies. — done.**
The real fix for 0.2. The install happens inside the image, into a named volume
that shadows `node_modules` for the run, and the two phases have opposite
policies: install reaches the registry and cannot write the repository; run
writes the repository and cannot reach the network.

The volume is named for the lockfile, so a dependency set is installed once and
reused until the repository changes it, and a changed lockfile lands on a new
volume instead of mutating one an earlier run may still be reading. A marker
file written at the end distinguishes a finished install from an abandoned one,
because a volume that exists is not a volume that is populated.

npm workspaces are refused rather than half-served: one install at the root
populates several `node_modules`, and shadowing one of them would hand the check
a tree that is partly the container's and partly the host's. Those repositories
fall back to 0.2's probe, which is why it survives 0.3 rather than being
replaced by it.

*Done:* this repository's suite is green contained and on the host, from a fresh
clone with no `node_modules` at all, and the run phase still has
`--network none`.

**0.4 — A real home directory and a real user. — done.**
`--user 501:20` with no matching passwd entry left `HOME=/`. `HOME` is now
`/tmp`: writable by any uid, present in every image, and on the container's own
layer rather than in the mounted repository, so a cache written there cannot
appear as a change to review. The uid still has no account entry, which is
visible to anything calling `os.userInfo()` rather than `os.homedir()`; nothing
observed has needed it.

**0.5 — Equivalence as a test, not a hope. — done.**
A test that runs the same check both ways and asserts the outcomes agree, in
both directions: a contained run that fails what the host passes is a false
finding, and one that passes what the host fails is a missed one. It builds its
fixture under the home directory rather than the temp directory, because on
macOS the temp directory is the one place the runtime cannot reach, and a test
that skips on the machine where the failures were found guards nothing.

It earned itself on the first run, catching a defect the manual experiment had
missed: with the repository mounted read-only the runtime cannot create the
`node_modules` mount point, so the install failed on any checkout that did not
already have one — which is every fresh clone, and therefore every build
machine. The experiment had happened to run somewhere the directory existed.

## Track 1 — Finish the gate

This is Phase 1. It is the whole product.

**1.1 — Intent versus diff.**
The packet records a stated intent and never compares it to anything. Compare
the intent against the changed files and symbols, and state disagreement as an
open question rather than a verdict — a claim about intent is not a claim Docket
can prove, and overstating it would break the rule the rest of the packet keeps.
*Files:* `src/shared/evidence.ts`, `src/main/workspace-diff.ts`.

**1.2 — The divergence case.** *Machinery landed; demonstration still owed.*
An agent says the tests pass. Docket runs them. Where those disagree is the
product. Claims are now extracted in the main process from the CLI's own hook
events -- verbatim, attributed, never from anything the renderer supplies --
compared against observed results in the packet, and a claim of green over an
observed red is the packet's first finding, ahead of drift. Agreement is
recorded as a checked fact; an unverified claim says so; extraction is
deliberately narrow, because an invented claim would put words in an agent's
mouth inside an evidence record.
*Done.* Demonstrated on 2026-08-18 against a repository with a real defect: an
agent claim of "2 of 2 passing" reached the packet through the hook-log path,
Docket's own runner observed the suite exit 1 in a container, and the packet led
with the disagreement — ahead of the failure it is about. Fixing the defect made
the finding disappear, so the comparison is sensitive in both directions. The
run is recorded in [`divergence-demonstration.md`](divergence-demonstration.md),
including what it does *not* establish: the extractor is narrow, and a packet
with no claim findings means no claim was recognised, not that the agent said
nothing wrong.

**1.3 — Patch scope and secret detection.**
Files touched outside the stated scope, and anything credential-shaped in the
diff. Both are cheap, deterministic, and exactly the kind of check the product
prefers to a model opinion.

**1.4 — Durability.**
A SQLite event log with schema versioning, and a work-unit state machine with
lease, heartbeat, deadline, and retry budget. The decision log is append-only
JSONL today, which is right for decisions and insufficient for runs.

## Track 2 — Running it on another machine

Three different questions get asked as one. They have different answers.

**2.1 — A headless mode.** The largest single lever, and the honest answer to
"can we run this in CI". The gate logic lives in main-process modules that need
no window: discovery, runner, container, evidence, decision log. Expose them as
a command that takes a workspace, runs the checks, and writes a packet as JSON.
That makes Docket runnable on a build machine, in a hook, or over SSH, and it
makes the desktop app one front end rather than the only one.
*Done when:* `docket check --workspace . --require-isolation --json` produces
the same packet the app shows, with no display.

> **Amendment 2026-08-18 — done. See [headless.md](headless.md).**
>
> The lever was smaller than it looked and the trap was bigger. Only two files
> in the whole main process import Electron, and the packet assembly happened
> to sit inside one of them; moving it into `src/main/packet.ts` is the entire
> structural change. The app and the CLI now call one function, so the answer
> a build machine gets and the answer on the desk are the same answer by
> construction rather than by intention.
>
> **The exit codes carry the product's own thesis.** 0 is a clean packet, 1 is
> a packet that should stop a merge, and 2 is *no packet at all*. Conflating 1
> and 2 would report "this should not merge" when what happened was "the gate
> could not run" — telling someone a failure nobody observed, which is the
> exact thing this product exists to remove. `--require-isolation` with no
> usable runtime is a 2.
>
> Verified end to end against a real repository with a genuine defect (a
> rotate that leaves the presented token valid) and a hook log in which an
> agent claims the suite passes. The headless packet leads with the divergence
> finding, exactly as the app does. Fixing the defect cleared it; committing
> the fix cleared a drift finding the gate raised because the test script had
> been edited since the last commit — caught headlessly, without being looked
> for.
>
> **The failure worth recording.** The first working version typechecked,
> linted, bundled and unit-tested clean while doing nothing at all when
> executed. The entry point guarded `main()` behind a test on
> `process.argv[1]` so the suite could import the helpers beside it; the
> bundle is emitted as `docket-check.cjs` and the guard was looking for
> `cli/check`. The built gate ran nothing, printed nothing, and exited **0**
> on a repository with a failing test and an agent lying about it.
>
> A gate that passes everything in silence is the worst outcome this product
> has, and every check in the suite was green while it was true. The unit
> tests import `main()` from source and are structurally blind to it. The fix
> is a separate entry file with no logic in it, and `npm run smoke:cli`, which
> runs the built binary, asserts the exit codes, and asserts stdout is not
> empty — an exit code with no packet behind it looks exactly like a working
> gate. Rebuilt with the original bug, the smoke test fails all five of its
> cases, including `a failing check must exit 1: 0 !== 1`.
>
> Also fixed on the way: eslint linted the build output, so `npm run lint`
> failed with thousands of errors about minified code as soon as anything had
> been built. `dist` and `dist-cli` are now ignored.

**2.2 — Per-repository image.** The image is fixed at `node:22-bookworm`
because discovery only understands npm scripts. A repository that is not
JavaScript is not served at all. Config first, then discovery for a second
ecosystem.

**2.3 — Windows.** Checks do not run there: npm is a `.cmd` shim that needs a
shell, and adding one would put shell construction back into the safe path.
Resolve it by resolving the real executable rather than the shim, or by treating
the container path as the only supported one on Windows. Not by turning on a
shell.

Treating the container path as the answer has its own catch, seen on the Windows
CI runner: a daemon in Windows-container mode answers `docker info` healthily
and then refuses a Linux image with `no matching manifest`. A runtime that is
running is not always a runtime that can run this, and `detectRuntime` does not
yet know the difference. Not reachable today, because checks are refused on
Windows before they get that far.

**2.4 — Distribution.** Every artifact is unsigned; macOS Gatekeeper blocks and
Windows SmartScreen warns. This is not a code problem — see the desktop README's
signing section. It needs an Apple Developer enrollment and a Windows
certificate, and both are yours to buy.

**2.5 — Runtime setup, documented honestly.** Colima does not survive a reboot
without `brew services start colima`. Docker Desktop shares only the paths in
its settings, and a repository outside them mounts empty. Docket detects the
second case; the first is a sentence in the README.

**2.6 — Docket inside a container.** Deferred, deliberately. Running the gate
itself on a server is the Kubernetes-executor direction in Phase 3, and it is
premature while the gate on one laptop is not yet trustworthy.

## Track 3 — The dashboard

`apps/dashboard` is the Phase 0 prototype: a full interaction design in which
every mission, cost, receipt, and model identity is simulated. It is a good
design reference and it is not a shipping surface.

The roadmap's launch checklist says no simulated data anywhere in the shipped
product, and the release currently ships none of it. The risk is not technical,
it is that a demo of it reads as a demo of Docket.

**Recommendation:** keep it, do not build on it, and do not show it as the
product. Mark it clearly as a prototype in the repository (its README already
does) and revisit in Phase 2, when there is a real event stream to render — at
which point the question is whether to rebuild the review surface in the desktop
app or as a served view. That decision needs real events to be worth making.

## What to start now

In order. Each is small enough to finish and to check.

1. ~~Track 0.1 — environment failures reported as errored, not failed.~~ Done.
2. ~~Track 0.2 — mismatch detected before the run.~~ Done, with 0.4 and 0.6.
3. ~~Track 0.3 — container-local dependencies, two-phase network policy.~~ Done.
4. ~~Track 0.5 — the equivalence test.~~ Done.
5. ~~Track 1.2 — the divergence case, on a real session.~~ Done.
6. Track 2.1 — headless mode.

**Track 0 is finished.** A contained result now means what a reviewer assumes it
means, and there is a test that fails when it stops meaning that. Step 5 is the
first time Docket does the thing it exists for. Step 6 is what lets anyone else
run it.

Two things Track 0 deliberately did not solve. The linked-worktree case stays a
fallback: making Git work there means mounting the real Git directory as well,
which is a second mount of a path outside the unit under review, and that price
is not worth one checkout layout while the workaround is "run from the main
checkout". And npm workspaces monorepos do not get a container-local install,
for the reason under 0.3 — they fall back to 0.2's probe, which is honest but
weaker, and a repository developed on macOS in that shape still cannot be run
contained.

## Blocked on a decision that is not the code's

- **Apple Developer enrollment** ($99/year) and a Windows code-signing
  certificate. Until then every download warns on first launch.
- **Design partners.** The roadmap's exit criteria are measurements, and there
  is nothing to measure without representative repositories and frozen tasks.
- **Whether the dashboard becomes the review surface.** Deferred above, on
  purpose.
