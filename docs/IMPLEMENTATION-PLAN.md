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

## Track 0 — Contained evidence a reviewer can trust

Blocking. Everything below inherits its credibility from this.

**0.1 — Never report an environment failure as a test failure.**
Docket already refuses to collapse "did not run" into "failed" for timeouts and
spawn errors. The same rule has to reach inside the container: a module that
cannot load for the wrong architecture, a missing interpreter, a manifest that
is not there. Classify those as `errored` with the reason, not `failed`.
*Files:* `src/main/check-runner.ts`, `src/shared/checks.ts`.
*Done when:* a check whose `node_modules` is the wrong platform is reported as
errored and named as such, and `isEvidence()` is false for it.

**0.2 — Detect the host/container mismatch before running, not after.**
The mount probe proves the repository is visible. It does not prove the run will
be equivalent. Extend it: if `node_modules` exists and contains native binaries
built for the host platform, the contained run is not equivalent, and the
reviewer must be told which one they are looking at.
*Files:* `src/main/container.ts`.
*Done when:* opening a macOS-installed repository on a Linux image produces an
explicit statement, not five red checks.

**0.3 — Give the container its own dependencies.**
The real fix for 0.2. Install inside the image, into a container-local
`node_modules`, then run the check with egress denied. Installing needs the
registry, so this is two phases with different network policy — which is the
dependency-proxy shape Phase 3 already calls for, arriving early because the
gate needs it now.
*Files:* `src/main/container.ts`, `src/main/check-runner.ts`.
*Done when:* this repository's desktop suite is green contained and on the host,
and the run phase still has `--network none`.

**0.4 — A real home directory and a real user.**
`--user 501:20` with no matching passwd entry leaves `HOME=/`. Set `HOME` to a
writable path inside the container.
*Done when:* `os.homedir()` inside the container is a real writable directory.

**0.5 — Equivalence as a test, not a hope.**
A test that runs the same check both ways and asserts the outcomes agree. It is
the only thing that stops 0.1–0.4 from regressing quietly.

## Track 1 — Finish the gate

This is Phase 1. It is the whole product.

**1.1 — Intent versus diff.**
The packet records a stated intent and never compares it to anything. Compare
the intent against the changed files and symbols, and state disagreement as an
open question rather than a verdict — a claim about intent is not a claim Docket
can prove, and overstating it would break the rule the rest of the packet keeps.
*Files:* `src/shared/evidence.ts`, `src/main/workspace-diff.ts`.

**1.2 — The divergence case.**
An agent says the tests pass. Docket runs them. Where those disagree is the
product. Record the agent's claim as an input, compare it to observed results,
and surface the mismatch as the packet's most prominent finding.
*Done when:* Docket surfaces one real instance, from a real session, not a
fixture. This is the roadmap's exit criterion and it must be demonstrated.

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

**2.2 — Per-repository image.** The image is fixed at `node:22-bookworm-slim`
because discovery only understands npm scripts. A repository that is not
JavaScript is not served at all. Config first, then discovery for a second
ecosystem.

**2.3 — Windows.** Checks do not run there: npm is a `.cmd` shim that needs a
shell, and adding one would put shell construction back into the safe path.
Resolve it by resolving the real executable rather than the shim, or by treating
the container path as the only supported one on Windows. Not by turning on a
shell.

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

1. Track 0.1 — environment failures reported as errored, not failed.
2. Track 0.2 — mismatch detected before the run.
3. Track 0.3 — container-local dependencies, two-phase network policy.
4. Track 0.5 — the equivalence test.
5. Track 1.2 — the divergence case, on a real session.
6. Track 2.1 — headless mode.

Steps 1 through 4 make a contained result mean something. Step 5 is the first
time Docket does the thing it exists for. Step 6 is what lets anyone else run
it.

## Blocked on a decision that is not the code's

- **Apple Developer enrollment** ($99/year) and a Windows code-signing
  certificate. Until then every download warns on first launch.
- **Design partners.** The roadmap's exit criteria are measurements, and there
  is nothing to measure without representative repositories and frozen tasks.
- **Whether the dashboard becomes the review surface.** Deferred above, on
  purpose.
