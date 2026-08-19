# Credential shapes in a diff

**Date:** 2026-08-18
**Status:** shipped — first half of Track 1.3

Cheap, deterministic, and exactly the kind of check this product prefers to a
model opinion: a private key header is a private key header, and no judgement is
involved in noticing one.

## Four rules

**The finding never carries the value.** A packet is written to disk, pasted
into reviews, attached to CI runs. A scanner that quotes what it found has
published the secret further than the commit did. Findings carry a path, a line
number, the rule that matched, and a mask — `AKIA******** (20 characters)`.
There is a test asserting the raw value appears nowhere in the packet JSON.

**It reports a shape, never a fact about the world.** Docket has not checked
whether a key is live, a fixture, or revoked an hour ago. "A secret was leaked"
asserts all three. "This line matches the shape of an AWS access key id" is a
claim about the line, and that is what the packet says.

**A placeholder is not a credential.** `process.env.API_KEY` and
`password = "changeme"` are the shapes of code handling secrets *correctly*.

**Confidence is separated, not averaged.** An issuer-named shape blocks. A long
string on a secret-sounding variable is reported apart, at `attention`, because
it is a guess about a name.

## Position lowers the level, never the report

The scanner's first real run against this repository produced **twenty-two
findings, every one a fixture in its own test file**. A gate that blocks its own
repository forever is a gate people learn to override, which costs more than the
class of secret it guards.

So a path that reads as test, fixture or documentation material reports at
`attention` instead of `blocking` — with the paths listed, and with the reason
stated: a fixture is the usual explanation for a key shape in a test, *and it is
also where someone would put a real one to get it past a scanner*. A rule that
went silent in test directories would be a published instruction for where to
hide a live key.

## Three defects this found in itself

**It silently swallowed every AWS access key.** A placeholder rule meant to
catch a bare `API_KEY` was `^[A-Z0-9_]+$` — and an AWS key id is also nothing
but capitals and digits. The scanner reported a clean line it had never really
looked at: the precise failure this product exists to catch, committed by the
part of it that does the catching. Placeholder words now apply only to the
generic rule; issuer-named shapes are specific enough to speak for themselves.

**The generic rule matched almost nothing.** A leading `\b` before
`password|token|secret` missed `dbPassword`, `userApiKey`, and every other name
real code uses.

**The fixture finding blocked on itself.** It was called
`secret-shapes-fixture`, and the cleanliness check tested
`id.startsWith("secret-shapes")` — so the finding that exists to let fixtures
past was caught by the prefix meant to stop real ones. Found by the test that
asserts a fixture does not block.

## What it does not cover

**Only added lines.** A credential already committed is not found by this; it is
a scan of the change, not an audit of the repository.

**Entropy is not measured.** The generic rule is a variable name and a length,
not a statistical judgement about randomness.

**A shape is not a secret and a miss is not an all-clear.** A capped scan says
so, and a new file that could not be read is counted — a clean result covers
what was read and says nothing about what was not.

**Source files should not contain credential shapes.** Writing an example key
into a comment in `secrets.ts` made Docket's own packet block, correctly. The
fix was to stop writing the shape, not to teach the scanner to ignore it.
