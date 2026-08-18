# Running the gate without a window

**Date:** 2026-08-18
**Status:** shipped

Docket's gate never needed a window. Discovery, the runner, containment,
evidence assembly and the decision log are all plain Node modules; the only
two files that import Electron are the app's entry point and its IPC
handlers. What stood between this product and a build machine was that the
packet was assembled *inside* one of those two files.

So the assembly moved out, into `src/main/packet.ts`, and both the app and
the command line call it. That is not tidiness. A gate whose CI answer is
assembled by different code from its on-screen answer is a gate that can tell
two people two different things about one commit.

## The command

```
docket check --workspace . --require-isolation --json
```

| Flag | What it does |
|------|--------------|
| `--workspace <path>` | The repository to check. Default: the current directory. |
| `--require-isolation` | Refuse to run at all unless every check runs contained. The same fail-closed switch the app has, meaning the same thing. |
| `--claims <path>` | An agent activity log (JSONL). What agents said about the checks is compared against what actually ran. |
| `--intent <text>` | What the change is meant to do, in your words. |
| `--timeout <ms>` | Per-check timeout. |
| `--json` | Print the packet as JSON instead of as text. |

## The exit codes are the point

```
0  A packet was produced and nothing in it should stop a merge.
1  A packet was produced and something in it should stop a merge.
2  No packet could be produced. The gate did not run.
```

**1 and 2 must never be conflated.** "This should not merge" and "I could not
tell you whether this should merge" are opposite statements. A CI job that
treats a missing container runtime the same as a failing test reports the
second as the first, and the person reading the red build has been told
something nobody observed. That is the exact failure this product exists to
remove, so it would be a poor thing to commit in its own exit code.

`--require-isolation` on a machine with no usable runtime is a 2, not a 1.
Nothing failed. Nothing ran.

## What it produces

The same packet the app shows, from the same function, including:

- the divergence comparison, when `--claims` points at an activity log;
- check drift, when a check's definition was edited since the last commit;
- the isolation qualification on every result that ran on the host.

## Building it

```
npm run build:cli     # bundles to dist-cli/docket-check.cjs
npm run smoke:cli     # builds, then runs the binary and checks what it does
```

The smoke test is not ceremony. The first working version of this CLI
typechecked, linted, bundled and unit-tested clean while doing **nothing at
all** when executed: the entry point guarded `main()` behind a check on
`process.argv[1]`, the bundle is emitted under a different name than its
source file, and so the built gate ran nothing, printed nothing, and exited 0
on a repository with a failing test and an agent claiming it passed.

A gate that passes everything in silence is the worst outcome this product
has. The unit suite could not see it, because it imports `main()` from source.
Only running the artifact could. `smoke:cli` runs the artifact, asserts the
exit codes, and asserts that stdout is **not empty** — because an exit code
with no packet behind it looks exactly like a working gate.

## Windows

Checks do not run on Windows yet. npm is a `.cmd` shim that will not launch
without a shell, and putting a shell back into the path that executes
repository scripts is the one fix that is not allowed (roadmap 2.3).

The gate knows this and is honest about it. A packet from a Windows run says
`npm run test did not finish` with the reason, which is **an absence of
evidence -- not a pass and not a failure**. The packet is therefore not clean,
so the command exits 1 and does not wave the change through. That is the
correct behaviour for a gate: unproven is not the same as proven good.

The smoke test pins this rather than skipping it, including the assertion that
a Windows packet must never say `npm run test failed` for a check that never
ran. When 2.3 lands, that assertion is what will tell you.

## Using it in CI

```yaml
- run: npx docket-check --workspace . --require-isolation
```

Exit 1 fails the job with a packet explaining why. Exit 2 fails the job too,
but the message says the gate could not run — which is a different thing to
go and fix.
