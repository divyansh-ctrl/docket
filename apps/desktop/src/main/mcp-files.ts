/**
 * Putting MCP servers where each CLI will find them.
 *
 * Two files, owned very differently.
 *
 * `.mcp.json` lives in the repository and is meant to be committed, so Docket
 * writes the whole file -- but only entries it is managing, merged over
 * whatever was already there, so a server somebody added by hand is not
 * deleted by an application they opened to add a different one.
 *
 * `~/.codex/config.toml` is the person's entire Codex setup: model, provider,
 * sandbox policy, approval rules. Docket owns a marker-delimited region of it
 * and preserves every other byte. The splice itself is pure and lives in
 * `src/shared/mcp-config.ts`, where the suite can hold it; this file only
 * supplies the bytes and writes the result.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Loss,
  type McpServer,
  fromClaudeCode,
  fromCodex,
  parseCodexToolFilters,
  renderMcpServers,
  spliceCodexRegion,
  toClaudeCode,
  toCodex,
} from "../shared/mcp-config";

export type McpTargetResult = Readonly<{
  path: string;
  written: boolean;
  /** Why it was not written, or what was preserved. Always populated. */
  detail: string;
}>;

export type McpApplyResult = Readonly<{
  claude: McpTargetResult;
  codex: McpTargetResult;
  losses: readonly Loss[];
  /** Servers a target refused, keyed by the target that refused them. */
  omitted: Readonly<{ claude: readonly string[]; codex: readonly string[] }>;
}>;

/**
 * Write both projections.
 *
 * Each target is attempted independently. A Codex config with damaged markers
 * must not stop `.mcp.json` being written, because the two failures have
 * nothing to do with each other and reporting them together as one is how a
 * person ends up believing neither worked.
 */
export async function applyMcpServers(
  workspacePath: string,
  servers: readonly McpServer[],
  home: string = homedir(),
): Promise<McpApplyResult> {
  const claude = toClaudeCode(servers);
  const codex = toCodex(servers);

  return Object.freeze({
    claude: await writeClaudeCode(workspacePath, claude.config.mcpServers),
    codex: await writeCodex(home, codex.region),
    losses: Object.freeze([...claude.losses, ...codex.losses]),
    omitted: Object.freeze({ claude: claude.omitted, codex: codex.omitted }),
  });
}

/** Where `.mcp.json` lives for a workspace. */
export function claudeCodePath(workspacePath: string): string {
  return join(workspacePath, ".mcp.json");
}

/** Where Codex keeps its configuration. */
export function codexConfigPath(home: string = homedir()): string {
  return join(home, ".codex", "config.toml");
}

async function writeClaudeCode(
  workspacePath: string,
  managed: Readonly<Record<string, unknown>>,
): Promise<McpTargetResult> {
  const path = claudeCodePath(workspacePath);
  let existing: Record<string, unknown> = {};
  let kept = 0;

  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    const block =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).mcpServers
        : undefined;
    if (typeof block === "object" && block !== null && !Array.isArray(block)) {
      existing = { ...(block as Record<string, unknown>) };
      kept = Object.keys(existing).filter((id) => !(id in managed)).length;
    }
  } catch (error) {
    // A file that exists but does not parse is left alone entirely. Overwriting
    // it would destroy servers Docket could not read, which is the one outcome
    // worse than not applying the change.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return Object.freeze({
        path,
        written: false,
        detail:
          "This file exists but could not be read as JSON, so it was left untouched. " +
          "Repair or remove it and apply again.",
      });
    }
  }

  const merged: Record<string, unknown> = { ...existing, ...managed };
  try {
    await writeAtomic(path, renderMcpServers(merged));
  } catch (error) {
    return Object.freeze({ path, written: false, detail: describe(error) });
  }
  return Object.freeze({
    path,
    written: true,
    detail:
      kept > 0
        ? `Written. ${kept} server${kept === 1 ? "" : "s"} already in this file and not managed by Docket ${kept === 1 ? "was" : "were"} kept.`
        : "Written.",
  });
}

async function writeCodex(home: string, region: string): Promise<McpTargetResult> {
  const path = codexConfigPath(home);

  // A missing `.codex` directory means Codex has not run on this machine.
  // Creating one would leave configuration behind for a CLI that is not there.
  try {
    await stat(dirname(path));
  } catch {
    return Object.freeze({
      path,
      written: false,
      detail: "Codex has no configuration directory on this machine, so nothing was written for it.",
    });
  }

  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return Object.freeze({ path, written: false, detail: describe(error) });
    }
  }

  let next: string;
  try {
    next = spliceCodexRegion(existing, region);
  } catch (error) {
    // Damaged markers. The splice refuses rather than guessing which span of a
    // person's Codex configuration to delete, and so does this.
    return Object.freeze({ path, written: false, detail: describe(error) });
  }

  try {
    await writeAtomic(path, next);
  } catch (error) {
    return Object.freeze({ path, written: false, detail: describe(error) });
  }
  return Object.freeze({
    path,
    written: true,
    detail:
      existing.length === 0
        ? "Written."
        : "Written. Everything outside Docket's own section was preserved exactly.",
  });
}

/**
 * Read whatever `.mcp.json` already holds, so servers configured by hand or by
 * another tool can be brought in rather than silently replaced.
 */
export async function importFromWorkspace(workspacePath: string): Promise<McpImportResult> {
  const path = claudeCodePath(workspacePath);
  try {
    return fromClaudeCode(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { servers: [], problems: [{ server: null, detail: "This repository has no .mcp.json yet." }] };
    }
    return { servers: [], problems: [{ server: null, detail: describe(error) }] };
  }
}

export type McpImportResult = Readonly<{
  servers: readonly McpServer[];
  problems: readonly { server: string | null; detail: string }[];
}>;

/**
 * Read Codex's servers, in two passes, because one is not enough.
 *
 * `codex mcp list --json` is the only safe way to read a TOML file that may
 * contain any TOML a person can write -- Codex parses its own format. But that
 * output omits `enabled_tools` and `disabled_tools` entirely, and importing
 * through it alone would drop a tool restriction on the next write without
 * anyone being told.
 *
 * So each server is asked for a second time with `codex mcp get`, which prints
 * both. That is a parse of human-facing text and it can break when the CLI
 * reformats, so a server whose filters could not be read says so rather than
 * arriving with none.
 */
export async function importFromCodex(read: ProviderRead): Promise<McpImportResult> {
  const listing = await read(["mcp", "list", "--json"]);
  if (!listing.ok) {
    return { servers: [], problems: [{ server: null, detail: listing.reason ?? "Codex could not be read." }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(listing.stdout);
  } catch {
    return { servers: [], problems: [{ server: null, detail: "Codex's server listing was not readable as JSON." }] };
  }

  const base = fromCodex(parsed);
  // fromCodex warns that this source cannot see the tool filters. The second
  // pass below is exactly that warning being answered, so it is dropped here
  // and replaced by whatever the per-server read actually found.
  const problems = base.problems.filter((problem) => problem.server !== null && problem.detail.length > 0);
  const servers: McpServer[] = [];

  for (const server of base.servers) {
    if (!SAFE_NAME.test(server.id)) {
      // Docket will not run a command with a name it would refuse to write.
      problems.push({
        server: server.id,
        detail: "This name cannot be queried safely, so any tool allowlist or denylist on it was not read.",
      });
      servers.push(server);
      continue;
    }

    const detail = await read(["mcp", "get", server.id]);
    if (!detail.ok) {
      problems.push({
        server: server.id,
        detail: "Its tool allowlist and denylist could not be read, so they are not imported.",
      });
      servers.push(server);
      continue;
    }

    const filters = parseCodexToolFilters(detail.stdout);
    for (const field of filters.unreadable) {
      problems.push({ server: server.id, detail: `Codex reported ${field} in a shape Docket could not read.` });
    }
    servers.push(
      Object.freeze({
        ...server,
        ...(filters.enabledTools ? { enabledTools: filters.enabledTools } : {}),
        ...(filters.disabledTools ? { disabledTools: filters.disabledTools } : {}),
      }),
    );
  }

  return Object.freeze({ servers: Object.freeze(servers), problems: Object.freeze(problems) });
}

/** Matches what `assertAllowlistedRead` will accept as a queryable name. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type ProviderRead = (args: readonly string[]) => Promise<{
  ok: boolean;
  stdout: string;
  reason: string | null;
}>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}
