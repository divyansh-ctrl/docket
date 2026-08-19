/**
 * Credential-shaped strings added by a change.
 *
 * Cheap, deterministic, and exactly the kind of check this product prefers to
 * a model opinion: a private key header is a private key header, and no
 * judgement is involved in noticing one.
 *
 * Four rules shape everything below.
 *
 * **The finding never carries the value.** A packet is written to disk, pasted
 * into reviews, and attached to CI runs. A scanner that quotes the secret it
 * found has published it further than the commit did. Every finding here
 * carries a path, a line number, the rule that matched, and a masked preview
 * that cannot be used to reconstruct the string.
 *
 * **It reports a shape, never a fact about the world.** Docket has not checked
 * whether the key is live, whether it is a fixture, or whether it was revoked
 * an hour ago. What it observed is that something matching a credential's shape
 * was added, and that is exactly what the wording says. "A secret was leaked"
 * would be a claim about the world; "this line matches the shape of an AWS
 * access key id" is a claim about the line.
 *
 * **A placeholder is not a credential.** `password = "changeme"` and
 * `apiKey: process.env.API_KEY` are the normal, correct shapes of code that
 * handles secrets properly. Reporting them trains a reviewer to dismiss the
 * section, which costs more than the rare miss.
 *
 * **Confidence is separated, not averaged.** A `BEGIN PRIVATE KEY` header and
 * a long string assigned to a variable called `token` are not the same
 * evidence. They are reported at different levels rather than blended into one
 * number that means neither.
 */

export type SecretRule = Readonly<{
  id: string;
  /** What the reviewer is told matched, in their terms. */
  label: string;
  pattern: RegExp;
  /**
   * `named` shapes identify their issuer and are near-unmistakable. `generic`
   * shapes are a guess about a variable name and a long string.
   */
  confidence: "named" | "generic";
}>;

/**
 * Shapes that name their own issuer. A string in one of these forms is not
 * plausibly anything else, which is what makes them worth reporting loudly.
 */
export const RULES: readonly SecretRule[] = Object.freeze([
  {
    id: "private-key",
    label: "a private key block",
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
    confidence: "named",
  },
  {
    id: "aws-access-key",
    label: "an AWS access key id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    confidence: "named",
  },
  {
    id: "github-token",
    label: "a GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    confidence: "named",
  },
  {
    id: "slack-token",
    label: "a Slack token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
    confidence: "named",
  },
  {
    id: "stripe-key",
    label: "a live Stripe secret key",
    pattern: /\bsk_live_[0-9A-Za-z]{16,}\b/,
    confidence: "named",
  },
  {
    id: "google-api-key",
    label: "a Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    confidence: "named",
  },
  {
    id: "anthropic-key",
    label: "an Anthropic API key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    confidence: "named",
  },
  {
    id: "openai-key",
    label: "an OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/,
    confidence: "named",
  },
  {
    id: "json-web-token",
    label: "a signed JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    confidence: "named",
  },
  {
    // Deliberately last and deliberately generic: a secret-ish name, then a
    // quoted value long enough to be a real one. No word boundary before the
    // name, because `dbPassword` and `userApiKey` are how these are actually
    // written and a leading \b missed every one of them.
    id: "assigned-secret",
    label: "a long value assigned to a secret-sounding name",
    pattern:
      /(?:secret|password|passwd|pwd|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential)s?\s*[:=]\s*["'`]([^"'`\n]{12,})["'`]/i,
    confidence: "generic",
  },
]);

/**
 * Values that are references to a credential rather than one.
 *
 * These are the shapes of code that handles secrets *correctly* -- reading from
 * the environment, interpolating, or documenting a field. They are suppressed
 * whatever rule matched them, because none of them is ever a live credential.
 */
const REFERENCES = [
  /^process\.env\b/,
  /^import\.meta\.env\b/,
  /^os\.environ\b/,
  /^\$\{[^}]*\}$/,
  /^<[^>]*>$/,
  /^\s*$/,
  /^(.)\1+$/,
  /^\.{3,}$/,
] as const;

/**
 * Weaker suppressions, applied only to the generic rule.
 *
 * The first version applied these to every rule, and one of them --
 * `^[A-Z0-9_]+$`, meant to catch a bare `API_KEY` -- silently swallowed
 * **every AWS access key id**, because an AWS key id is also nothing
 * but capitals and digits. The scanner reported a clean line while never having
 * looked at it, which is the precise failure this product exists to catch,
 * committed by the part of it that does the catching.
 *
 * An issuer-named shape is specific enough to speak for itself. Only the guess
 * -- a secret-sounding variable and a long string -- needs help from a
 * vocabulary of placeholder words.
 */
const PLACEHOLDER_WORDS = [
  /^\$?\{?[A-Z0-9_]+\}?$/,
  /x{6,}/i,
  /\b(?:changeme|placeholder|example|redacted|dummy|sample|your[_-]?|my[_-]?|test[_-]?|fake|todo|none|null|undefined)\b/i,
] as const;

/**
 * Whether a matched value is a reference or a placeholder rather than a
 * credential. Named shapes get only the unambiguous suppressions; see above for
 * what happened when they got all of them.
 */
export function isPlaceholder(value: string, confidence: SecretRule["confidence"] = "generic"): boolean {
  const trimmed = value.trim();
  if (REFERENCES.some((pattern) => pattern.test(trimmed))) return true;
  return confidence === "generic" && PLACEHOLDER_WORDS.some((pattern) => pattern.test(trimmed));
}

/**
 * A value reduced to something safe to print.
 *
 * Enough to find the line and recognise the string when you open the file;
 * never enough to use it. The length is given because "24 characters" tells a
 * reviewer more about what they are looking at than any prefix does.
 */
export function mask(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return `${"*".repeat(trimmed.length)} (${trimmed.length} characters)`;
  return `${trimmed.slice(0, 4)}${"*".repeat(Math.min(8, trimmed.length - 4))} (${trimmed.length} characters)`;
}

/**
 * Paths whose credential shapes are usually deliberate.
 *
 * Run against this repository, the scanner's first real outing produced
 * twenty-two findings and every one was a fixture in its own test file. A gate
 * that blocks its own repository forever is a gate people learn to override,
 * which costs more than the class of secret it was guarding.
 *
 * So position lowers the level, and never the report. The fact is identical
 * either way -- a credential shape was added at this line -- because an agent
 * that wanted to smuggle a live key past this would put it exactly here, and a
 * rule that stayed silent in test directories would be a published instruction
 * for how to do it.
 */
const FIXTURE_PATH =
  /(?:^|\/)(?:tests?|__tests__|specs?|fixtures?|testdata|examples?|docs?)(?:\/|$)|\.(?:test|spec)\.[A-Za-z]+$/i;

export function looksLikeFixture(path: string): boolean {
  return FIXTURE_PATH.test(path);
}

export type AddedLine = Readonly<{ path: string; line: number; text: string }>;

export type SecretMatch = Readonly<{
  ruleId: string;
  label: string;
  confidence: SecretRule["confidence"];
  path: string;
  line: number;
  /** Masked. The value itself never leaves this module. */
  preview: string;
  /**
   * True when the path reads as test, fixture or documentation material. It
   * lowers how loudly the match is reported and changes nothing about whether
   * it is reported.
   */
  fixture: boolean;
}>;

/** Beyond this the finding list stops informing and starts scrolling. */
const MAX_MATCHES = 40;
/** A minified bundle is one line and megabytes long; it is not review material. */
const MAX_LINE_LENGTH = 2000;

export type SecretScan = Readonly<{
  matches: readonly SecretMatch[];
  /** True when the scan stopped at its cap, so the list is partial. */
  truncated: boolean;
  /** Lines skipped for being longer than any reviewable line. */
  skippedLongLines: number;
}>;

/**
 * Scans added lines for credential shapes.
 *
 * Pure, and separated from Git so the suite can hold it to the rules above
 * without a repository on disk. One match per line: a line that trips two rules
 * is one thing for a person to look at, and the more specific rule is reported
 * because `RULES` is ordered with the generic one last.
 */
export function scanSecrets(lines: Iterable<AddedLine>): SecretScan {
  const matches: SecretMatch[] = [];
  let truncated = false;
  let skippedLongLines = 0;

  for (const entry of lines) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    if (entry.text.length > MAX_LINE_LENGTH) {
      skippedLongLines += 1;
      continue;
    }

    for (const rule of RULES) {
      const found = rule.pattern.exec(entry.text);
      if (!found) continue;
      // Group 1 where a rule captures the value; otherwise the whole match.
      const value = found[1] ?? found[0];
      if (isPlaceholder(value, rule.confidence)) break;
      matches.push({
        ruleId: rule.id,
        label: rule.label,
        confidence: rule.confidence,
        path: entry.path,
        line: entry.line,
        preview: mask(value),
        fixture: looksLikeFixture(entry.path),
      });
      break;
    }
  }

  return { matches, truncated, skippedLongLines };
}
