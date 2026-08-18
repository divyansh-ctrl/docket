/**
 * Comparing a stated intent against what actually changed.
 *
 * The packet has recorded an intent since the day it existed and never once
 * looked at it. Every other field traces to something Docket ran or read; the
 * intent sat beside them as decoration, which is worse than it sounds -- a
 * reviewer seeing it printed next to observed facts reads it as one.
 *
 * This compares it. What it must never do is turn the comparison into a
 * verdict, and that constraint shapes everything below.
 *
 * **A claim about intent is not a claim Docket can prove.** The intent is
 * English written by a person. The change is paths and declaration names. No
 * amount of string matching establishes that a change does what was asked, and
 * a packet that said so would break the rule the rest of it keeps. So the
 * output here is a question -- "the intent names this; nothing in the change
 * matches it; is that covered?" -- and never a finding that a change is wrong.
 *
 * **Only terms specific enough to be checkable are reported.** An intent like
 * "make the room feel calmer" contains nothing a path can be matched against.
 * Raising a question for every unmatched English word would bury the one case
 * that matters -- an intent naming `src/main/runner.ts` when no such file was
 * touched -- under a drift of noise about "feel" and "calmer". So a term is
 * only reported when it looks like a path or an identifier: it carries a
 * separator, an extension, or the casing of code.
 *
 * Plain words are still counted and still reported as *counted*, because the
 * alternative is a packet that looks at four words, says nothing, and leaves
 * the reader assuming it looked at the sentence. An intent with nothing
 * checkable in it is told so plainly -- that is a fact about the intent, and
 * one the person who wrote it can act on.
 *
 * The matching is deliberately generous in the direction that avoids false
 * questions. `token-usage`, `token_usage`, `tokenUsage` and `TokenUsage` all
 * match each other, because a reviewer who wrote one and shipped another has
 * done nothing wrong and should not be asked about it.
 */

/**
 * Words that appear in almost every intent and distinguish nothing. Kept short
 * on purpose: the real filter is the shape test below, and a long list of
 * banned words would be a second heuristic to keep honest.
 */
const COMMON = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "without", "into", "onto",
  "from", "that", "this", "these", "those", "when", "where", "which", "while",
  "then", "than", "them", "they", "there", "here", "have", "has", "had", "was",
  "were", "been", "being", "are", "not", "now", "its", "it's", "our", "out",
  "add", "adds", "added", "fix", "fixes", "fixed", "make", "makes", "made",
  "use", "uses", "used", "update", "updates", "updated", "remove", "removes",
  "removed", "change", "changes", "changed", "so", "to", "of", "in", "on", "is",
  "be", "do", "does", "did", "can", "will", "should", "would", "just", "also",
  "still", "only", "more", "less", "some", "any", "all", "new", "old",
]);

/** Everything that is not a letter or a digit, for comparing shapes fairly. */
const NOISE = /[^a-z0-9]+/g;

/** `token-usage`, `token_usage`, `tokenUsage` and `TokenUsage` all fold here. */
function fold(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(NOISE, "");
}

/**
 * Whether a term is shaped like something a repository contains.
 *
 * A path separator, a file extension, or the casing of code. This is the line
 * between a term worth asking about and an English word that happens not to
 * appear in a filename.
 */
export function looksSpecific(term: string): boolean {
  if (term.includes("/") || term.includes("\\")) return true;
  if (/\.[a-z]{1,5}$/i.test(term)) return true;
  if (/[a-z][A-Z]/.test(term)) return true;
  if (term.includes("_")) return true;
  // A bare hyphenated compound is deliberately *not* specific, though
  // `check-runner` is a real filename stem and this gives up asking about it.
  // Pointed at this repository's own history, the rule that accepted them
  // asked about `intent-versus-diff` -- a roadmap item and a branch name, not
  // a file. English hyphenates as readily as filesystems do, and the cost is
  // not symmetric: a missed question is a question the reviewer would have
  // asked anyway, and a false one teaches them to skip the section. Hyphenated
  // terms are still counted and still shown; they just never raise a finding.
  return false;
}

export type IntentTerm = Readonly<{
  /** The term as the intent wrote it, so the reader recognises their words. */
  text: string;
  /** Whether it is shaped like a path or an identifier. */
  specific: boolean;
  /** Whether anything in the change matched it. */
  matched: boolean;
}>;

export type IntentComparison = Readonly<{
  /**
   * Every term looked for, quoted and backticked spans first and the loose
   * words after. Non-specific terms are carried here without ever producing a
   * finding: a packet that shows what it looked at is telling the reader the
   * difference between "checked and found nothing" and "did not look".
   */
  terms: readonly IntentTerm[];
  /**
   * Specific terms with nothing in the change matching. The open questions,
   * and the only thing here that produces a finding.
   */
  unmatched: readonly string[];
  /** True when the intent contained no term specific enough to look for. */
  vague: boolean;
  /** True when there was no intent, or no change to compare it against. */
  skipped: boolean;
}>;

const EMPTY: IntentComparison = Object.freeze({
  terms: [],
  unmatched: [],
  vague: false,
  skipped: true,
});

/**
 * Pulls candidate terms out of an intent.
 *
 * Backticked and quoted spans are taken whole -- someone who writes
 * `src/main/runner.ts` in backticks has named a thing deliberately, and
 * splitting it on the dot would lose exactly the specificity that makes it
 * worth checking.
 */
export function intentTerms(intent: string): readonly string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const take = (raw: string): void => {
    const term = raw.trim().replace(/^[^\w/\\.]+|[^\w/\\.]+$/g, "");
    if (term.length < 3) return;
    const key = fold(term);
    if (key.length < 3 || seen.has(key)) return;
    if (!looksSpecific(term) && COMMON.has(term.toLowerCase())) return;
    seen.add(key);
    found.push(term);
  };

  let rest = intent;
  // Quoted and backticked spans first, then removed, so the words inside them
  // are not also offered as loose terms.
  for (const pattern of [/`([^`]+)`/g, /"([^"]+)"/g, /'([^']{3,})'/g]) {
    rest = rest.replace(pattern, (_whole, inner: string) => {
      take(inner);
      return " ";
    });
  }
  for (const word of rest.split(/[\s,;:()[\]{}<>]+/)) take(word);
  return found;
}

/**
 * Compares an intent against the paths and symbols a change actually touched.
 *
 * Matching is substring-wise over folded forms in both directions: an intent
 * saying `runner` matches `src/main/check-runner.ts`, and an intent naming
 * `check-runner.ts` matches it too. Being generous here costs a missed
 * question; being strict costs a false one, and a false question about a
 * change that is fine is how a reviewer learns to skip this section.
 */
export function compareIntent(
  intent: string,
  files: readonly string[],
  symbols: readonly string[],
): IntentComparison {
  if (intent.trim().length === 0 || (files.length === 0 && symbols.length === 0)) {
    return EMPTY;
  }

  const haystack = [...files, ...symbols].map(fold).filter((value) => value.length > 0);
  const terms = intentTerms(intent).map((text) => {
    const key = fold(text);
    const matched = haystack.some((entry) => entry.includes(key) || key.includes(entry));
    return { text, specific: looksSpecific(text), matched };
  });

  return {
    terms,
    unmatched: terms.filter((term) => term.specific && !term.matched).map((term) => term.text),
    vague: terms.length > 0 && !terms.some((term) => term.specific),
    skipped: false,
  };
}
