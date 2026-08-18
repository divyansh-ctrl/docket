/**
 * The command line, parsed. Pure, so the suite can hold it to its word.
 *
 * The flags here are the same decisions the app makes through its settings,
 * and they mean exactly the same things -- `--require-isolation` is the same
 * fail-closed switch, not a CI-flavoured approximation of it. A gate that
 * behaves differently on a build machine than on the desk is two gates.
 */

export type Options = Readonly<{
  workspace: string;
  requireIsolation: boolean;
  json: boolean;
  intent: string;
  /** An agent activity log to read claims from, so divergence is reachable. */
  claims: string | null;
  timeoutMs: number | null;
  help: boolean;
}>;

export type Parsed =
  | Readonly<{ ok: true; options: Options }>
  | Readonly<{ ok: false; error: string }>;

const DEFAULTS: Options = Object.freeze({
  workspace: ".",
  requireIsolation: false,
  json: false,
  intent: "",
  claims: null,
  timeoutMs: null,
  help: false,
});

export const USAGE = `docket check -- run a repository's checks and print the evidence packet

  --workspace <path>     The repository to check. Default: the current directory.
  --require-isolation    Refuse to run at all unless every check runs contained.
                         Without it, a check may fall back to the host, and the
                         packet says so on every result it qualifies.
  --claims <path>        An agent activity log (JSONL). What agents said about
                         the checks is compared against what actually ran.
  --intent <text>        What the change is meant to do, in your words.
  --timeout <ms>         Per-check timeout.
  --json                 Print the packet as JSON instead of as text.
  --help                 This.

Exit codes:
  0  A packet was produced and nothing in it should stop a merge.
  1  A packet was produced and something in it should stop a merge.
  2  No packet could be produced. The gate did not run.

  1 and 2 are deliberately different. "This should not merge" and "I could not
  tell you whether this should merge" are opposite statements, and a CI job
  that treats them alike reports the second as the first.`;

/** Flags that take a value, and how to fold each into the options. */
const VALUED: Readonly<Record<string, (current: Options, value: string) => Parsed>> = {
  "--workspace": (current, value) => ({ ok: true, options: { ...current, workspace: value } }),
  "--intent": (current, value) => ({ ok: true, options: { ...current, intent: value } }),
  "--claims": (current, value) => ({ ok: true, options: { ...current, claims: value } }),
  "--timeout": (current, value) => {
    const ms = Number(value);
    // A timeout that is not a number would otherwise become NaN and disable
    // the timeout entirely -- the one failure mode a timeout must not have.
    if (!Number.isFinite(ms) || ms <= 0) {
      return { ok: false, error: `--timeout needs a positive number of milliseconds, got "${value}"` };
    }
    return { ok: true, options: { ...current, timeoutMs: ms } };
  },
};

const FLAGS: Readonly<Record<string, keyof Options>> = {
  "--require-isolation": "requireIsolation",
  "--json": "json",
  "--help": "help",
  "-h": "help",
};

export function parseArgs(argv: readonly string[]): Parsed {
  let options = DEFAULTS;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    const flag = FLAGS[token];
    if (flag) {
      options = { ...options, [flag]: true };
      continue;
    }

    const valued = VALUED[token];
    if (valued) {
      const value = argv[index + 1];
      // A flag that swallows the next flag as its value is worse than an
      // error: `--workspace --json` would check a directory called "--json".
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `${token} needs a value` };
      }
      const folded = valued(options, value);
      if (!folded.ok) return folded;
      options = folded.options;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${token}` };
  }

  return { ok: true, options };
}
