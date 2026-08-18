/**
 * What an agent said about the checks, recorded to be checked -- never trusted.
 *
 * The packet's first rule is that nothing appears in it that was not observed,
 * and for as long as that rule has existed there has been no field for what an
 * agent *said*, because an agent's account of its own work is the thing the
 * packet replaces. This module is not a softening of that rule; it is the
 * other half of it. A claim is recorded verbatim, attributed, and compared
 * against the observed result -- and the place where the two disagree is the
 * packet's most important finding, because an agent reporting green over a red
 * suite is precisely the failure this product exists to catch.
 *
 * Extraction is deliberately narrow. Only present-tense statements about a
 * recognizable check kind, with a clear pass or fail direction, become claims.
 * A missed claim costs one comparison; an invented one puts words in an
 * agent's mouth inside an evidence record, which is the one thing this file
 * must never do. Every pattern here was written against real summary lines,
 * and the verbatim text always travels with the claim so a reader can judge
 * the reading.
 */
import type { CheckKind } from "./checks";
import type { AgentId } from "./agent-roster";

export type ClaimVerdict = "passed" | "failed";

export type AgentClaim = Readonly<{
  /** The sentence as the agent produced it. Never paraphrased. */
  text: string;
  /** Which of the repository's check kinds it speaks about. */
  kind: CheckKind;
  /** The direction of the statement. */
  verdict: ClaimVerdict;
  /** Who said it, from the CLI's own hook event. */
  agentId: AgentId;
  /** When it was said. */
  at: number;
}>;

type Rule = Readonly<{
  pattern: RegExp;
  kind: CheckKind;
  /** Fixed verdict, or derived from the match. */
  verdict: ClaimVerdict | ((match: RegExpMatchArray) => ClaimVerdict);
}>;

/**
 * Present tense only. "Tests will pass", "make the tests pass", and "tests
 * should pass" are plans, not claims, and none of them match here.
 */
const RULES: readonly Rule[] = [
  {
    // "42 of 42 passing" -- and "12 of 15 passing" is a *failure* claim: the
    // agent itself reports three tests not passing.
    pattern: /\b(\d+) of (\d+)(?: tests?)? passing\b/i,
    kind: "test",
    verdict: (match) => (match[1] === match[2] ? "passed" : "failed"),
  },
  {
    // Before the generic forms: "0 tests failing" is a pass being reported
    // with a number, and the generic "tests failing" must not read it first.
    pattern: /\b(\d+) tests? fail(?:ing|s|ed)?\b/i,
    kind: "test",
    verdict: (match) => (match[1] === "0" ? "passed" : "failed"),
  },
  {
    pattern: /\b(?:all )?tests?(?: are| is)? (?:pass(?:ing|es)?|green)\b/i,
    kind: "test",
    verdict: "passed",
  },
  {
    pattern: /\btests?(?: are| is)? (?:fail(?:ing|s)?|red|broken)\b/i,
    kind: "test",
    verdict: "failed",
  },
  {
    pattern: /\blint(?:er|ing)?(?: is)? (?:clean|pass(?:ing|es)?|green)\b/i,
    kind: "lint",
    verdict: "passed",
  },
  {
    pattern: /\blint(?:er|ing)?(?: is)? fail(?:ing|s)?\b/i,
    kind: "lint",
    verdict: "failed",
  },
  {
    pattern: /\btype ?check(?:s|ing)?(?: is| are)? (?:clean|pass(?:ing|es)?|green)\b/i,
    kind: "typecheck",
    verdict: "passed",
  },
  {
    pattern: /\btype ?check(?:s|ing)?(?: is| are)? fail(?:ing|s)?\b/i,
    kind: "typecheck",
    verdict: "failed",
  },
  {
    pattern: /\bbuild(?: is)? (?:green|clean|succeed(?:s|ing)|pass(?:ing|es)?)\b/i,
    kind: "build",
    verdict: "passed",
  },
  {
    pattern: /\bbuild(?: is)? fail(?:ing|s)?\b/i,
    kind: "build",
    verdict: "failed",
  },
];

/** Words that mark a statement as a plan or a wish rather than a report. */
const ASPIRATIONAL = /\b(?:will|should|once|until|going to|need(?:s)? to|make|so that|before|after (?:fixing|the fix)|to be)\b/i;

/**
 * Reads claims out of one agent-produced text.
 *
 * The text is split into sentence-sized pieces so the verbatim quote is the
 * sentence that made the claim, not a paragraph around it. One claim per kind
 * per text: an agent restating itself is one claim, not growing confidence.
 */
export function extractClaims(text: string, agentId: AgentId, at: number): readonly AgentClaim[] {
  const claims: AgentClaim[] = [];
  const seen = new Set<CheckKind>();

  for (const piece of text.split(/[.;\n]+/)) {
    const sentence = piece.trim();
    if (sentence.length === 0 || sentence.length > 400) continue;
    if (ASPIRATIONAL.test(sentence)) continue;

    for (const rule of RULES) {
      if (seen.has(rule.kind)) continue;
      const match = sentence.match(rule.pattern);
      if (!match) continue;
      seen.add(rule.kind);
      claims.push({
        text: sentence.slice(0, 200),
        kind: rule.kind,
        verdict: typeof rule.verdict === "function" ? rule.verdict(match) : rule.verdict,
        agentId,
        at,
      });
    }
  }

  return claims;
}
