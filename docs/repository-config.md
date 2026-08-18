# `docket.json` — a repository declaring its own checks

**Date:** 2026-08-18
**Status:** shipped

Until this, Docket could only serve repositories with a `package.json`.
Discovery reads npm scripts and the container image was fixed at
`node:22-bookworm`, so a Python or Go project was not served badly — it was
not served at all.

A repository can now declare itself:

```json
{
  "image": "python:3.12-bookworm",
  "checks": [
    { "kind": "test", "command": ["pytest", "-q"] },
    { "kind": "lint", "command": ["ruff", "check", "."] }
  ]
}
```

`kind` is one of `typecheck`, `lint`, `test`, `build`. When `docket.json`
declares checks, it is the single source of truth for that repository — npm
scripts are not merged in, because a packet that ran some checks the
repository declared and some it did not could not say which was which.

## A command is an argv array, never a string

This is the whole safety argument, so it is worth being plain about.

```json
"command": ["pytest", "-k", "not slow"]     ✅
"command": "pytest -k 'not slow'"           ❌ refused
```

A string would have to be run through a shell, and a shell turns the
repository's data into Docket's code. With an array, no shell is ever
involved: `["pytest", "-k", "a; rm -rf /"]` runs `pytest` with two arguments,
the second of which happens to contain a semicolon. The semicolon is data and
stays data.

Docket does not filter metacharacters out of arguments, and that is
deliberate — filtering would imply the safety came from the filter. It comes
from there being no shell.

## A check that names an image never runs on the host

If a check declares `python:3.12-bookworm`, and no container runtime is
available, the check does not run. It is not silently attempted against
whatever this machine happens to have.

The point of naming an image is that the check needs that environment.
Running `pytest` against the host's Python is a *different check*, and
reporting its result as this one's would be a false statement about what was
verified. So the result is `refused` — neither a pass nor a failure — and the
packet says why.

This is stronger than `--require-isolation`, and it is not optional.

## Drift applies, and matters more here

Editing `docket.json` is by far the cheapest way to make a gate pass. Turning
`["pytest", "-q"]` into `["true"]` leaves a green result and no trace in the
test files.

So the working tree's declaration is compared against the one committed in
HEAD, exactly as npm scripts are, and a change is a blocking finding that
outranks the pass it produced. Reformatting is not drift — the comparison is
over the parsed commands, not the file's bytes.

The declaration is also re-read at the moment a check runs, not just when it
was discovered. For an npm check a stale discovery means a wrong script name;
for a declared command the argv *is* the process, so a stale one would be the
wrong program running.

## A broken config blocks; it does not fall back

A `docket.json` that does not parse produces a **blocking** finding and no
checks. It does not quietly fall back to npm discovery.

That fallback would be the most useful lie available to an agent: corrupt one
file, and the declared gate is replaced by a different one with nothing said
about it. "No checks found" and "the checks could not be read" are different
statements, and only one of them is true.

## What is not here yet

Discovery for a second ecosystem — recognising a `pyproject.toml` or a
`go.mod` and inferring checks the way npm scripts are inferred. This release
is the config half of roadmap 2.2 deliberately: a repository can always say
what it wants, and inference can be added underneath without changing what a
declared repository does.
