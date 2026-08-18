/**
 * `docket.json` -- a repository declaring its own checks, for repositories
 * that are not JavaScript.
 *
 * Until now the gate could only serve projects with a `package.json`, because
 * discovery reads npm scripts and the container image is fixed at
 * `node:22-bookworm`. A Python or Go repository was not served badly; it was
 * not served at all.
 *
 * Everything in this file is parsing input written by whoever can commit to
 * the repository -- which, on a floor of agents, is the agents. So it is
 * written the way you write a parser for a hostile document:
 *
 *   **A command is an argv array, never a string.** A string implies a shell,
 *   and the moment a shell is involved the repository can write anything it
 *   likes into a command line Docket assembled. `["pytest", "-q"]` cannot
 *   grow a `; curl ... | sh` no matter what is in the strings, because no
 *   shell ever sees them.
 *
 *   **A malformed config is a finding, not a fallback.** Silently ignoring a
 *   broken `docket.json` and carrying on with npm discovery would let an
 *   agent disable the gate's checks by corrupting one file, and the packet
 *   would say nothing. The parse error travels to the reviewer.
 *
 *   **Nothing here is trusted to be small.** A config declaring ten thousand
 *   checks is not a configuration, it is a way to make a packet unreadable.
 */
import { CHECK_KIND_ORDER, type CheckKind } from "./checks";

export type ConfiguredCheck = Readonly<{
  kind: CheckKind;
  /** argv. Never a shell string, and never empty. */
  command: readonly string[];
}>;

export type RepoConfig = Readonly<{
  /** The container image these checks need. Null means Docket's default. */
  image: string | null;
  checks: readonly ConfiguredCheck[];
}>;

export type ConfigResult =
  | Readonly<{ ok: true; config: RepoConfig }>
  | Readonly<{ ok: false; error: string }>;

/** The file a repository declares itself in, at the workspace root. */
export const CONFIG_FILE = "docket.json";

/** More than this is not configuration; it is noise aimed at the reviewer. */
const MAX_CHECKS = 12;
const MAX_ARGV = 64;
const MAX_ARG_LENGTH = 400;

/**
 * A conservative image reference: registry, path, tag or digest.
 *
 * Deliberately narrower than what a runtime would accept. This string is
 * handed to `docker run` as an argument -- not through a shell, so it cannot
 * inject a second command -- but a reference containing an option-looking
 * prefix could still be read as a flag, and there is no reason a real image
 * name needs a space, a quote, or a leading dash.
 */
const IMAGE = /^[a-z0-9][a-z0-9._\-/]{0,180}(:[a-zA-Z0-9._-]{1,128})?(@sha256:[a-f0-9]{64})?$/;

const KINDS = new Set<string>(CHECK_KIND_ORDER);

/**
 * Parses the config text. Returns the reason rather than throwing, because
 * the reason is going in front of a person.
 */
export function parseRepoConfig(source: string): ConfigResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: `${CONFIG_FILE} is not valid JSON: ${(error as Error).message}` };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${CONFIG_FILE} must be a JSON object.` };
  }
  const document = raw as Record<string, unknown>;

  let image: string | null = null;
  if (document.image !== undefined) {
    if (typeof document.image !== "string" || !IMAGE.test(document.image)) {
      return {
        ok: false,
        error: `${CONFIG_FILE}: "image" must be a plain image reference such as "python:3.12-bookworm".`,
      };
    }
    image = document.image;
  }

  if (document.checks === undefined) {
    return { ok: true, config: { image, checks: [] } };
  }
  if (!Array.isArray(document.checks)) {
    return { ok: false, error: `${CONFIG_FILE}: "checks" must be an array.` };
  }
  if (document.checks.length > MAX_CHECKS) {
    return {
      ok: false,
      error: `${CONFIG_FILE}: ${document.checks.length} checks declared, which is more than the ${MAX_CHECKS} this reads.`,
    };
  }

  const checks: ConfiguredCheck[] = [];
  const seen = new Set<CheckKind>();

  for (const [index, entry] of document.checks.entries()) {
    const at = `${CONFIG_FILE}: checks[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `${at} must be an object.` };
    }
    const { kind, command } = entry as Record<string, unknown>;

    if (typeof kind !== "string" || !KINDS.has(kind)) {
      return {
        ok: false,
        error: `${at}: "kind" must be one of ${CHECK_KIND_ORDER.join(", ")}.`,
      };
    }
    // Two declarations for one kind is an ambiguity, and a gate that resolves
    // an ambiguity by picking one has made a decision nobody recorded.
    if (seen.has(kind as CheckKind)) {
      return { ok: false, error: `${at}: "${kind}" is declared more than once.` };
    }

    if (typeof command === "string") {
      return {
        ok: false,
        error: `${at}: "command" must be an array of arguments, not a string. A string would have to be run through a shell, and Docket never gives a repository's command a shell.`,
      };
    }
    if (!Array.isArray(command) || command.length === 0) {
      return { ok: false, error: `${at}: "command" must be a non-empty array of arguments.` };
    }
    if (command.length > MAX_ARGV) {
      return { ok: false, error: `${at}: "command" has more than ${MAX_ARGV} arguments.` };
    }
    for (const argument of command) {
      if (typeof argument !== "string" || argument.length === 0) {
        return { ok: false, error: `${at}: every argument must be a non-empty string.` };
      }
      if (argument.length > MAX_ARG_LENGTH) {
        return { ok: false, error: `${at}: an argument is longer than ${MAX_ARG_LENGTH} characters.` };
      }
      // A NUL truncates the argument wherever the runtime copies it into a C
      // string, so what runs and what the packet shows would differ.
      if (argument.includes("\0")) {
        return { ok: false, error: `${at}: an argument contains a null byte.` };
      }
    }

    seen.add(kind as CheckKind);
    checks.push({ kind: kind as CheckKind, command: Object.freeze([...command] as string[]) });
  }

  // Ordered the way every other check list is: cheapest signal first.
  const ordered = [...checks].sort(
    (left, right) => CHECK_KIND_ORDER.indexOf(left.kind) - CHECK_KIND_ORDER.indexOf(right.kind),
  );

  return { ok: true, config: { image, checks: Object.freeze(ordered) } };
}

/**
 * The canonical text of a configured check, for drift comparison.
 *
 * Drift is the protection that matters most here: editing `docket.json` is a
 * far easier way to weaken a gate than editing a test. This has to be stable
 * against reformatting -- whitespace in the JSON must not read as a change --
 * and it has to change whenever the command does.
 */
export function declarationOf(check: ConfiguredCheck): string {
  return JSON.stringify(check.command);
}
