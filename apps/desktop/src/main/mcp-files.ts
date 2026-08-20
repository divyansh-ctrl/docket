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
 *
 * Codex's side is not read here. Its configuration is TOML, and the only safe
 * reader is Codex itself via `codex mcp list --json` -- which omits
 * `enabled_tools` and `disabled_tools`, so importing through it cannot see a
 * tool restriction. That is a spawn and a caveat this surface does not need
 * yet; until it exists, importing means importing from `.mcp.json`, and the
 * tab says so rather than implying it looked at both.
 */
export async function importFromWorkspace(workspacePath: string): Promise<{
  servers: readonly McpServer[];
  problems: readonly { server: string | null; detail: string }[];
}> {
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}
