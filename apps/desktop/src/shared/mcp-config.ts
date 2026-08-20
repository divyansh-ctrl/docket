/**
 * One MCP server record, projected into two CLIs that disagree.
 *
 * Docket configures MCP servers once and hands them to whichever CLI an agent
 * is running. That would be a thin file editor if the two formats were the
 * same shape. They are not, and the differences are not cosmetic: a server
 * configured for one CLI can arrive at the other missing its authentication,
 * missing its tool restrictions, or -- worst -- looking configured and failing
 * only at connect time.
 *
 * Everything below was established by round-tripping real entries through the
 * installed CLIs (`codex` 0.147.0, Claude Code) rather than from documentation,
 * because on three points the documentation and the behaviour disagree:
 *
 *   - `claude mcp add --transport` advertises `stdio, sse, http`. The schema
 *     also accepts `ws`, writes it, and Claude Code's own warning text names
 *     `ws` as a valid choice.
 *   - Codex reads `transport = "sse"` and reports the server back as
 *     `streamable_http`. The key is accepted and ignored. So is any other
 *     unrecognised key -- Codex does not reject what it does not know.
 *   - `codex mcp list --json` omits `enabled_tools` and `disabled_tools`
 *     entirely, while `codex mcp get` shows them. The structured read is lossy
 *     in exactly the dimension that matters most.
 *
 * The canonical record keeps every field either CLI understands. Projecting it
 * reports what the target will not apply, because the alternative -- writing a
 * file that quietly does less than the person configured -- is the failure this
 * whole application exists to prevent.
 */

/**
 * How a server is reached.
 *
 * `stdio` is a child process. The rest are remote. Codex has one remote
 * transport and infers it from the presence of a URL; Claude Code has three and
 * requires the choice to be stated.
 */
export type McpTransport = "stdio" | "http" | "sse" | "ws";

export type TargetCli = "claude" | "codex";

/**
 * A server as Docket holds it: the union of what either CLI can express.
 *
 * Fields are optional rather than transport-split because a person editing a
 * server changes its transport and expects to keep typing, not to have half
 * their input discarded by a type. What a given transport actually emits is
 * decided at projection.
 */
export type McpServer = Readonly<{
  id: string;
  transport: McpTransport;

  /** stdio: the child process. */
  command?: string;
  args?: readonly string[];
  /** Codex only. Claude Code accepts the key and drops it. */
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /**
   * Names of variables forwarded from Docket's own environment. Codex only.
   * A name, never a value -- that is the point of it.
   */
  envVars?: readonly string[];

  /** remote: where it lives. */
  url?: string;
  /** Literal header values. Both CLIs store these in plain text on disk. */
  headers?: Readonly<Record<string, string>>;
  /** Header name to the environment variable holding its value. Codex only. */
  envHeaders?: Readonly<Record<string, string>>;
  /** Name of the variable holding a bearer token. Codex only. */
  bearerTokenEnvVar?: string;
  /**
   * Understood by both, and by neither the same way: Claude Code stores it and
   * reads it back, Codex writes it and does not.
   */
  oauthClientId?: string;
  /** Claude Code only. */
  oauthCallbackPort?: number;

  /** Defaults to on. Codex only; see `toClaudeCode` for what off means there. */
  enabled?: boolean;
  /** Tool allowlist. Codex only, and the reason `weakened` exists below. */
  enabledTools?: readonly string[];
  /** Tool denylist. Codex only. */
  disabledTools?: readonly string[];
  /** Codex only. Codex's own default is 10. */
  startupTimeoutSec?: number;
  /** Codex only. Codex's own default is 60. */
  toolTimeoutSec?: number;
}>;

/**
 * What happens to a field the target cannot express.
 *
 * Three levels rather than one because "not applied" covers outcomes a person
 * would rank very differently, and flattening them is how a security control
 * disappears into a list of harmless-looking notes.
 *
 *   `unsupported` -- the server will not work here. Docket does not write it.
 *   `weakened`    -- it works, and is *less* restricted than configured. The
 *                    server can do more than you allowed it to.
 *   `dropped`     -- a preference is not carried over. Behaviour may differ;
 *                    nothing breaks and nothing is loosened.
 */
export type LossSeverity = "unsupported" | "weakened" | "dropped";

export type Loss = Readonly<{
  server: string;
  /** The canonical field name, or the server itself when `unsupported`. */
  field: string;
  severity: LossSeverity;
  /** A sentence a person can act on, not a category name. */
  detail: string;
}>;

/**
 * A field that *is* carried across, but not identically.
 *
 * Separate from `Loss` because "applied differently" and "not applied" are
 * different news, and a person scanning a list of warnings should not have to
 * read each one to find out which kind it is. Codex counts a tool timeout in
 * seconds and Claude Code in milliseconds; the setting survives, the number
 * does not.
 */
export type Note = Readonly<{ server: string; field: string; detail: string }>;

/** Ranked worst-first so a UI can show the ones that change behaviour. */
const SEVERITY_ORDER: Readonly<Record<LossSeverity, number>> = Object.freeze({
  unsupported: 0,
  weakened: 1,
  dropped: 2,
});

export function bySeverity(a: Loss, b: Loss): number {
  const rank = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return rank !== 0 ? rank : a.server.localeCompare(b.server) || a.field.localeCompare(b.field);
}

/* -------------------------------------------------------------------------
 * Claude Code: .mcp.json
 * ---------------------------------------------------------------------- */

export type ClaudeCodeToolPolicy = Readonly<{
  name: string;
  permission_policy: "always_allow" | "always_ask" | "always_deny";
}>;

export type ClaudeCodeEntry = Readonly<{
  type: McpTransport;
  command?: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  url?: string;
  headers?: Readonly<Record<string, string>>;
  oauth?: Readonly<{ clientId: string; callbackPort?: number }>;
  /** Milliseconds. Codex's equivalent is in seconds. */
  timeout?: number;
  /** Remote entries only; silently stripped from stdio and ws. */
  tools?: readonly ClaudeCodeToolPolicy[];
}>;

export type ClaudeCodeConfig = Readonly<{
  mcpServers: Readonly<Record<string, ClaudeCodeEntry>>;
}>;

export type ClaudeCodeProjection = Readonly<{
  config: ClaudeCodeConfig;
  losses: readonly Loss[];
  /** Carried across, but changed on the way. */
  notes: readonly Note[];
  /** Servers deliberately left out, with why. Not the same as a loss. */
  omitted: readonly string[];
}>;

/**
 * Project into `.mcp.json`.
 *
 * `type` is always written, including for stdio where Claude Code would infer
 * it. Inference is what makes a URL with no type read as a child process, and
 * an entry that states its own transport is one a person can check by eye.
 *
 * A disabled server is omitted rather than written. Claude Code has no `enabled`
 * key -- it accepts one and drops it -- so writing the entry would run a server
 * that was switched off. Leaving it out is the only projection that preserves
 * the intent, and it is reported so the absence is never a silence.
 */
export function toClaudeCode(servers: readonly McpServer[]): ClaudeCodeProjection {
  const entries: Record<string, ClaudeCodeEntry> = {};
  const losses: Loss[] = [];
  const notes: Note[] = [];
  const omitted: string[] = [];

  for (const server of [...servers].sort((a, b) => a.id.localeCompare(b.id))) {
    if (server.enabled === false) {
      omitted.push(server.id);
      losses.push({
        server: server.id,
        field: "enabled",
        severity: "dropped",
        detail:
          "Switched off, and Claude Code has no way to hold a server that is present but off. " +
          "Left out of .mcp.json entirely so it does not run.",
      });
      continue;
    }

    const note = (field: string, severity: LossSeverity, detail: string): void => {
      losses.push({ server: server.id, field, severity, detail });
    };
    const changed = (field: string, detail: string): void => {
      notes.push({ server: server.id, field, detail });
    };
    const remote = server.transport !== "stdio";

    // Milliseconds here, seconds in Codex. Anything under a second is ignored
    // by Claude Code and falls through to its own default, so a timeout that
    // will not take effect is reported rather than written as though it had.
    let timeout: number | undefined;
    if (server.toolTimeoutSec !== undefined) {
      if (server.toolTimeoutSec < 1) {
        note(
          "toolTimeoutSec",
          "dropped",
          "Claude Code ignores a tool timeout below one second and uses its own default instead.",
        );
      } else {
        timeout = Math.round(server.toolTimeoutSec * 1000);
        changed("toolTimeoutSec", `Written as ${timeout}ms; Claude Code counts this in milliseconds, Codex in seconds.`);
      }
    }

    // A denylist survives on a remote entry as a per-tool refusal. It is not
    // the same mechanism -- Codex hides the tool, Claude Code lets the agent
    // ask and refuses -- but the tool cannot be used either way, and carrying
    // it across imperfectly beats dropping a restriction silently. On stdio the
    // key is accepted and stripped, so there it is a real loss.
    const denied =
      remote && server.disabledTools && server.disabledTools.length > 0
        ? server.disabledTools.map(
            (name): ClaudeCodeToolPolicy => ({ name, permission_policy: "always_deny" as const }),
          )
        : undefined;
    if (denied) {
      changed(
        "disabledTools",
        "Carried as an always_deny policy on each tool. Codex hides these tools; Claude Code offers " +
          "them and refuses the call.",
      );
    } else if (server.disabledTools && server.disabledTools.length > 0) {
      note(
        "disabledTools",
        "weakened",
        server.disabledTools.join(", ") +
          " was blocked. Claude Code accepts a tool policy only on http and sse servers and strips it " +
          "from a stdio one, so those tools will be available to the agent.",
      );
    }

    if (server.transport === "stdio") {
      entries[server.id] = compact({
        type: "stdio" as const,
        command: server.command,
        args: server.args && server.args.length > 0 ? server.args : undefined,
        env: nonEmpty(server.env),
        timeout,
      });
      if (server.cwd !== undefined) {
        note("cwd", "dropped", "Claude Code starts the server in its own working directory, not in " + server.cwd + ".");
      }
      if (server.envVars && server.envVars.length > 0) {
        note(
          "envVars",
          "dropped",
          "Claude Code cannot forward named variables from Docket's environment; " +
            server.envVars.join(", ") +
            " will not reach the server unless already in its inherited environment.",
        );
      }
      if (server.oauthClientId !== undefined) {
        note("oauthClientId", "dropped", "OAuth applies to remote servers; this one is a child process.");
      }
    } else {
      entries[server.id] = compact({
        // Never inferred. An entry with a url and no type is skipped by Claude
        // Code, which says so plainly -- but only in `claude mcp list`, which
        // nobody runs until something is already broken.
        type: server.transport,
        url: server.url,
        headers: nonEmpty(server.headers),
        oauth:
          server.oauthClientId === undefined
            ? undefined
            : compact({ clientId: server.oauthClientId, callbackPort: server.oauthCallbackPort }),
        timeout,
        tools: denied,
      });

      // Dropping the means of authenticating does not weaken the server, it
      // stops it working. Claude Code has no env-var indirection for either,
      // and the only translation available -- resolving the variable and
      // writing the literal -- puts a live credential in a file whose whole
      // purpose is to be committed. Docket will not make that trade silently,
      // so it reports the loss instead of performing it.
      if (server.bearerTokenEnvVar !== undefined) {
        note(
          "bearerTokenEnvVar",
          "unsupported",
          "Claude Code has no bearer-token-from-environment setting. Writing the value literally " +
            "would put the credential in .mcp.json, which is meant to be committed, so it is left out " +
            "and this server will reach " +
            (server.url ?? "its endpoint") +
            " unauthenticated.",
        );
      }
      if (server.envHeaders && Object.keys(server.envHeaders).length > 0) {
        note(
          "envHeaders",
          "unsupported",
          "Headers sourced from environment variables (" +
            Object.keys(server.envHeaders).sort().join(", ") +
            ") have no equivalent in .mcp.json, and inlining their values would commit a credential.",
        );
      }
    }

    // An allowlist cannot be expressed at all: naming what is permitted needs
    // the full set of tools the server offers, which Docket has not asked it
    // for and could not keep current if it had.
    if (server.enabledTools && server.enabledTools.length > 0) {
      note(
        "enabledTools",
        "weakened",
        "Only " +
          server.enabledTools.join(", ") +
          " was allowed. Claude Code can refuse named tools but cannot permit only named ones, so " +
          "every tool this server offers will be available to the agent.",
      );
    }
    if (server.startupTimeoutSec !== undefined) {
      note("startupTimeoutSec", "dropped", "Claude Code uses its own startup timeout.");
    }
  }

  return Object.freeze({
    config: Object.freeze({ mcpServers: Object.freeze(entries) }),
    losses: Object.freeze(losses.sort(bySeverity)),
    notes: Object.freeze(notes),
    omitted: Object.freeze(omitted),
  });
}

/** `.mcp.json` as Claude Code writes it: two-space indent, trailing newline. */
export function renderClaudeCode(config: ClaudeCodeConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/* -------------------------------------------------------------------------
 * Codex: the [mcp_servers.*] region of config.toml
 * ---------------------------------------------------------------------- */

/**
 * Docket owns the text between these and nothing else in the file.
 *
 * `config.toml` is the user's entire Codex configuration -- model, provider,
 * sandbox policy, approval rules. Reading it, re-serialising it and writing it
 * back would put all of that at the mercy of a TOML writer, to edit one
 * section. So the region is spliced as text and every other byte is preserved
 * exactly, including comments and formatting a parser would discard.
 *
 * The wording matches the `generated by Docket` marker in `agent-files.ts` so
 * the same phrase means the same thing everywhere: Docket wrote this, Docket
 * replaces it, and anything without it belongs to a person.
 */
export const CODEX_REGION_BEGIN = "# >>> generated by Docket: mcp servers >>>";
export const CODEX_REGION_END = "# <<< generated by Docket: mcp servers <<<";

export type CodexProjection = Readonly<{
  /** The region body, markers included. Ready to hand to `spliceCodexRegion`. */
  region: string;
  losses: readonly Loss[];
  notes: readonly Note[];
  omitted: readonly string[];
}>;

/**
 * Project into Codex's `[mcp_servers.*]` tables.
 *
 * An `sse` or `ws` server is not written at all. Codex has one remote
 * transport and decides on the presence of a URL: it reads `transport = "sse"`,
 * ignores it, and reports the server back as `streamable_http`. So writing one
 * produces an entry that looks configured, passes every check a person would
 * think to run, and fails only when an agent tries to use it. Refusing to write
 * it is the honest outcome, and it is reported rather than skipped quietly.
 */
export function toCodex(servers: readonly McpServer[]): CodexProjection {
  const blocks: string[] = [];
  const losses: Loss[] = [];
  const notes: Note[] = [];
  const omitted: string[] = [];

  for (const server of [...servers].sort((a, b) => a.id.localeCompare(b.id))) {
    const note = (field: string, severity: LossSeverity, detail: string): void => {
      losses.push({ server: server.id, field, severity, detail });
    };

    if (server.transport === "sse" || server.transport === "ws") {
      omitted.push(server.id);
      note(
        "transport",
        "unsupported",
        "Codex speaks only streamable HTTP for remote servers. It would accept this entry, ignore " +
          "the " +
          server.transport +
          " transport, and try to reach it as streamable HTTP -- so it is not written. Point this " +
          "server at an HTTP endpoint, or give this agent a CLI that supports " +
          server.transport +
          ".",
      );
      continue;
    }

    const table = `mcp_servers.${tomlKey(server.id)}`;
    const lines: string[] = [`[${table}]`];

    if (server.transport === "stdio") {
      if (server.command !== undefined) lines.push(`command = ${tomlString(server.command)}`);
      if (server.args && server.args.length > 0) lines.push(`args = ${tomlArray(server.args)}`);
      if (server.cwd !== undefined) lines.push(`cwd = ${tomlString(server.cwd)}`);
      if (server.envVars && server.envVars.length > 0) lines.push(`env_vars = ${tomlArray(server.envVars)}`);
    } else {
      if (server.url !== undefined) lines.push(`url = ${tomlString(server.url)}`);
      if (server.bearerTokenEnvVar !== undefined) {
        lines.push(`bearer_token_env_var = ${tomlString(server.bearerTokenEnvVar)}`);
      }
    }

    if (server.enabled === false) lines.push("enabled = false");
    if (server.enabledTools && server.enabledTools.length > 0) {
      lines.push(`enabled_tools = ${tomlArray(server.enabledTools)}`);
    }
    if (server.disabledTools && server.disabledTools.length > 0) {
      lines.push(`disabled_tools = ${tomlArray(server.disabledTools)}`);
    }
    if (server.startupTimeoutSec !== undefined) {
      lines.push(`startup_timeout_sec = ${tomlNumber(server.startupTimeoutSec)}`);
    }
    if (server.toolTimeoutSec !== undefined) lines.push(`tool_timeout_sec = ${tomlNumber(server.toolTimeoutSec)}`);

    // Sub-tables come after every bare key, or TOML reads the keys that follow
    // as belonging to the sub-table.
    if (server.transport === "stdio") {
      const env = nonEmpty(server.env);
      if (env) lines.push("", `[${table}.env]`, ...pairs(env));
    } else {
      const headers = nonEmpty(server.headers);
      if (headers) lines.push("", `[${table}.http_headers]`, ...pairs(headers));
      const envHeaders = nonEmpty(server.envHeaders);
      if (envHeaders) lines.push("", `[${table}.env_http_headers]`, ...pairs(envHeaders));
      if (server.oauthClientId !== undefined) {
        // `codex mcp add --oauth-client-id` writes exactly this shape, so it is
        // Codex's own, and Docket matches it. But neither `codex mcp get` nor
        // `codex mcp list --json` reports it back, so what Codex does with it
        // cannot be observed from outside -- said here rather than assumed.
        lines.push("", `[${table}.oauth]`, `client_id = ${tomlString(server.oauthClientId)}`);
        notes.push({
          server: server.id,
          field: "oauthClientId",
          detail:
            "Written in the shape `codex mcp add --oauth-client-id` uses, but Codex does not report " +
            "it back through `mcp get` or `mcp list --json`, so it cannot be confirmed as applied.",
        });
      }
      if (server.oauthCallbackPort !== undefined) {
        note("oauthCallbackPort", "dropped", "Codex has no callback-port setting; it manages its own OAuth flow.");
      }
    }

    // Codex applies everything above, so the only losses left are fields that
    // exist for the other CLI. There are none: every canonical field is either
    // Codex-native or a transport Codex cannot reach, handled above.
    blocks.push(lines.join("\n"));
  }

  const body = blocks.length > 0 ? `\n${blocks.join("\n\n")}\n` : "\n";
  return Object.freeze({
    region: `${CODEX_REGION_BEGIN}${body}${CODEX_REGION_END}`,
    losses: Object.freeze(losses.sort(bySeverity)),
    notes: Object.freeze(notes),
    omitted: Object.freeze(omitted),
  });
}

/**
 * Put the region into an existing `config.toml`, leaving the rest untouched.
 *
 * Pure, so the one operation that can destroy a person's Codex setup is held by
 * the suite rather than discovered in the field.
 *
 * A file whose markers are missing gets the region appended. A file whose
 * markers are damaged -- one of the pair absent, or in the wrong order --
 * throws. Guessing which half of a broken pair to trust means guessing which
 * span of the user's configuration to delete, and refusing is the only move
 * that cannot lose their work.
 */
export function spliceCodexRegion(existing: string, region: string): string {
  const begin = existing.indexOf(CODEX_REGION_BEGIN);
  const end = existing.indexOf(CODEX_REGION_END);

  if (begin < 0 && end < 0) {
    const separator = existing.length === 0 || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    return `${existing}${separator}${region}\n`;
  }
  if (begin < 0 || end < 0) {
    throw new Error(
      `config.toml has ${begin < 0 ? "an end" : "a begin"} marker for Docket's MCP section without its pair. ` +
        "Repair or remove the marker by hand; rewriting the file from one half would delete configuration.",
    );
  }
  if (end < begin) {
    throw new Error(
      "config.toml has Docket's MCP section markers in the wrong order. Repair them by hand; " +
        "splicing between them would delete everything in the file that sits between them.",
    );
  }
  return existing.slice(0, begin) + region + existing.slice(end + CODEX_REGION_END.length);
}

/* -------------------------------------------------------------------------
 * TOML rendering
 *
 * Only the subset the projection above emits: tables, sub-tables, strings,
 * string arrays, booleans and integers. Reading TOML is not attempted anywhere
 * in this file -- see `fromCodex`, which lets Codex parse its own format.
 * ---------------------------------------------------------------------- */

/** Bare where TOML allows it, quoted where it does not. */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

const TOML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "\\": "\\\\",
  '"': '\\"',
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
});

function tomlString(value: string): string {
  let out = '"';
  for (const character of value) {
    const escape = TOML_ESCAPES[character];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    // Remaining control characters have no short form and must be \uXXXX or
    // the file will not parse.
    out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, "0").toUpperCase()}` : character;
  }
  return `${out}"`;
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`${value} cannot be written to config.toml as a number.`);
  }
  return Number.isInteger(value) ? String(value) : String(value);
}

function pairs(record: Readonly<Record<string, string>>): readonly string[] {
  return Object.keys(record)
    .sort()
    .map((key) => `${tomlKey(key)} = ${tomlString(record[key])}`);
}

/* -------------------------------------------------------------------------
 * Import
 * ---------------------------------------------------------------------- */

export type ImportProblem = Readonly<{
  /** The server it concerns, or null when it concerns the whole source. */
  server: string | null;
  detail: string;
}>;

export type McpImport = Readonly<{
  servers: readonly McpServer[];
  problems: readonly ImportProblem[];
}>;

/**
 * Read a foreign `.mcp.json`.
 *
 * An entry with a `url` and no `type` is reported rather than repaired. Claude
 * Code's own warning offers three choices -- `http`, `sse` or `ws` -- and
 * picking one on the person's behalf would assert a transport nobody stated,
 * for a server Docket has never contacted. The entry is already inert; saying
 * so and asking is better than a guess that silently starts working, or
 * silently does not.
 */
export function fromClaudeCode(value: unknown): McpImport {
  const servers: McpServer[] = [];
  const problems: ImportProblem[] = [];

  const root = asRecord(value);
  const block = root === null ? null : asRecord(root.mcpServers);
  if (block === null) {
    return Object.freeze({
      servers: Object.freeze([]),
      problems: Object.freeze([{ server: null, detail: "No mcpServers object was found in this file." }]),
    });
  }

  for (const id of Object.keys(block).sort()) {
    const entry = asRecord(block[id]);
    if (entry === null) {
      problems.push({ server: id, detail: "This entry is not an object and was not read." });
      continue;
    }

    const url = asString(entry.url);
    const declared = asString(entry.type);
    const transport = declared === null ? (url === null ? "stdio" : null) : asTransport(declared);

    if (transport === null) {
      problems.push({
        server: id,
        detail:
          declared === null
            ? "This entry has a url but no type, so Claude Code skips it. Give it http, sse or ws."
            : `"${declared}" is not a transport Claude Code accepts. Use stdio, http, sse or ws.`,
      });
      continue;
    }

    const oauth = asRecord(entry.oauth);
    const timeoutMs = asNumber(entry.timeout);
    servers.push(
      compact({
        id,
        transport,
        command: asString(entry.command) ?? undefined,
        args: asStrings(entry.args),
        env: asStringRecord(entry.env),
        url: url ?? undefined,
        headers: asStringRecord(entry.headers),
        oauthClientId: oauth === null ? undefined : (asString(oauth.clientId) ?? undefined),
        oauthCallbackPort: oauth === null ? undefined : asNumber(oauth.callbackPort),
        // Milliseconds there, seconds here.
        toolTimeoutSec: timeoutMs === undefined ? undefined : timeoutMs / 1000,
        disabledTools: deniedTools(entry.tools),
      }),
    );
  }

  return Object.freeze({ servers: Object.freeze(servers), problems: Object.freeze(problems) });
}

/**
 * Read the output of `codex mcp list --json`.
 *
 * Codex parses its own TOML here, which is the only way to read a file that may
 * contain any TOML a person can write. The cost is stated rather than hidden:
 * that output carries no `enabled_tools` or `disabled_tools`, though
 * `codex mcp get` shows both. Importing through it therefore cannot see a tool
 * restriction, and a restriction Docket cannot see is one it would drop on the
 * next write. So every call says so, and it is the caller's job to pass that on.
 */
export function fromCodex(value: unknown): McpImport {
  const servers: McpServer[] = [];
  const problems: ImportProblem[] = [
    {
      server: null,
      detail:
        "codex mcp list --json does not report enabled_tools or disabled_tools. Any tool allowlist " +
        "or denylist already in config.toml is invisible here and will not survive being written back.",
    },
  ];

  if (!Array.isArray(value)) {
    return Object.freeze({
      servers: Object.freeze([]),
      problems: Object.freeze([{ server: null, detail: "This is not the list codex mcp list --json produces." }]),
    });
  }

  for (const item of value) {
    const entry = asRecord(item);
    const id = entry === null ? null : asString(entry.name);
    if (entry === null || id === null) {
      problems.push({ server: null, detail: "An entry had no name and was not read." });
      continue;
    }

    const transport = asRecord(entry.transport);
    const kind = transport === null ? null : asString(transport.type);
    if (kind !== "stdio" && kind !== "streamable_http") {
      problems.push({ server: id, detail: `Codex reported a transport Docket does not know: ${kind ?? "none"}.` });
      continue;
    }

    servers.push(
      compact({
        id,
        transport: kind === "stdio" ? ("stdio" as const) : ("http" as const),
        command: asString(transport?.command) ?? undefined,
        args: asStrings(transport?.args),
        cwd: asString(transport?.cwd) ?? undefined,
        env: asStringRecord(transport?.env),
        envVars: asStrings(transport?.env_vars),
        url: asString(transport?.url) ?? undefined,
        headers: asStringRecord(transport?.http_headers),
        envHeaders: asStringRecord(transport?.env_http_headers),
        bearerTokenEnvVar: asString(transport?.bearer_token_env_var) ?? undefined,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : undefined,
        startupTimeoutSec: asNumber(entry.startup_timeout_sec),
        toolTimeoutSec: asNumber(entry.tool_timeout_sec),
      }),
    );
  }

  return Object.freeze({ servers: Object.freeze(servers), problems: Object.freeze(problems) });
}

/* -------------------------------------------------------------------------
 * Narrowing helpers
 * ---------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asTransport(value: string): McpTransport | null {
  return value === "stdio" || value === "http" || value === "sse" || value === "ws" ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Only `always_deny` maps back to a denylist; the other policies have no twin. */
function deniedTools(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names: string[] = [];
  for (const item of value) {
    const entry = asRecord(item);
    const name = entry === null ? null : asString(entry.name);
    if (name !== null && asString(entry?.permission_policy) === "always_deny") names.push(name);
  }
  return names.length > 0 ? Object.freeze(names) : undefined;
}

function asStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? Object.freeze(strings) : undefined;
}

function asStringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (typeof item === "string") out[key] = item;
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

function nonEmpty(
  record: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  return record !== undefined && Object.keys(record).length > 0 ? record : undefined;
}

/** Drops keys that are undefined so they never reach JSON.stringify as null. */
function compact<T extends Record<string, unknown>>(value: T): Readonly<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return Object.freeze(out as T);
}
