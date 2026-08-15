/**
 * The append-only log of sealed decisions, one file per repository.
 *
 * JSON Lines rather than a database or a single JSON array, for one reason:
 * appending must not require rewriting what is already there. A log whose every
 * write touches every prior record is a log where a crash mid-write can lose
 * history, and history that can be lost by accident is not evidence.
 *
 * See `../shared/decision.ts` for what a record establishes -- and, more
 * importantly, what it does not.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidencePacket } from "../shared/evidence";
import type { Decision, RecordBody, SealedRecord, Verification } from "../shared/decision";
import { canonicalize, compactPacket, verifyChain } from "../shared/decision";

/**
 * Beyond this the log is not refused, but it stops being read in full.
 *
 * Verification needs the whole chain, so this is high: a repository sealing ten
 * decisions a day reaches it in about three years. It exists so a corrupted or
 * hand-appended file cannot make the app read an unbounded amount into memory.
 */
const MAX_RECORDS = 10_000;
/** A single line longer than this is malformed, not a record. */
const MAX_LINE_BYTES = 2 * 1024 * 1024;

export function digestOf(body: RecordBody): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

export type SealInput = Readonly<{
  workspaceId: string;
  head: string | null;
  treeDigest: string | null;
  decision: Decision;
  note: string;
  packet: EvidencePacket;
  sealedAt: number;
}>;

export type LogState = Readonly<{
  records: readonly SealedRecord[];
  verification: Verification;
  /** Set when the log itself could not be read, as distinct from being empty. */
  unavailable: string | null;
}>;

export class DecisionLog {
  readonly #directory: string;

  constructor(userDataPath: string) {
    this.#directory = join(userDataPath, "decisions");
  }

  #pathFor(workspaceId: string): string {
    return join(this.#directory, `${workspaceId}.jsonl`);
  }

  /**
   * Reads a workspace's log and checks it.
   *
   * A file that cannot be parsed is reported as a problem on the line it broke
   * at, and the records before it are still returned. Refusing to show any
   * history because line 40 is corrupt would destroy thirty-nine good records
   * to punish one bad one.
   */
  async read(workspaceId: string): Promise<LogState> {
    let raw: string;
    try {
      raw = await readFile(this.#pathFor(workspaceId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { records: [], verification: { ok: true, problems: [] }, unavailable: null };
      }
      return {
        records: [],
        verification: { ok: false, problems: [] },
        unavailable: `The decision log could not be read: ${(error as Error).message}`,
      };
    }

    const records: SealedRecord[] = [];
    const problems: { line: number; reason: string }[] = [];
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);

    for (const [index, line] of lines.slice(0, MAX_RECORDS).entries()) {
      if (line.length > MAX_LINE_BYTES) {
        problems.push({ line: index + 1, reason: "This line is too long to be a record." });
        continue;
      }
      try {
        records.push(JSON.parse(line) as SealedRecord);
      } catch {
        problems.push({ line: index + 1, reason: "This line is not valid JSON, so it was not read as a record." });
      }
    }

    if (lines.length > MAX_RECORDS) {
      problems.push({
        line: MAX_RECORDS,
        reason: `Only the first ${MAX_RECORDS} records were read, so anything after them is unverified.`,
      });
    }

    const chain = verifyChain(records, digestOf);
    return {
      records,
      verification: {
        ok: chain.ok && problems.length === 0,
        problems: [...problems, ...chain.problems].sort((left, right) => left.line - right.line),
      },
      unavailable: null,
    };
  }

  /**
   * Seals a decision and appends it.
   *
   * The sequence number and the previous digest are taken from the log as it is
   * on disk at this moment, never from a value passed in. A caller supplying
   * its own position in the chain is a caller that can forge one.
   */
  async seal(input: SealInput): Promise<SealedRecord> {
    const existing = await this.read(input.workspaceId);
    const last = existing.records.at(-1) ?? null;

    const body: RecordBody = {
      version: 1,
      sequence: existing.records.length + 1,
      workspaceId: input.workspaceId,
      head: input.head,
      treeDigest: input.treeDigest,
      decision: input.decision,
      note: input.note,
      sealedAt: input.sealedAt,
      packet: compactPacket(input.packet),
      previousDigest: last?.digest ?? null,
    };

    const record: SealedRecord = { ...body, digest: digestOf(body) };

    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    // Appended as one write of one line. A partial line is recoverable -- the
    // reader reports it and keeps the records before it -- but an interleaved
    // one would corrupt two records at once.
    await appendFile(this.#pathFor(input.workspaceId), `${JSON.stringify(record)}\n`, {
      mode: 0o600,
    });

    return record;
  }
}

/**
 * Renders a record as something a person can read and paste into a review.
 *
 * Markdown rather than JSON: the audience is a reviewer on a pull request, not
 * a parser. The digest is included so the reader can check the exported copy
 * against the log it came from, and the sentence about what the seal does not
 * establish is included for the same reason it is in the module comment -- an
 * exported record travels away from every other piece of context.
 */
export function renderRecord(record: SealedRecord): string {
  const packet = record.packet;
  const when = new Date(record.sealedAt).toISOString();
  const lines: string[] = [
    `# Docket decision record ${record.sequence}`,
    "",
    `- **Decision:** ${record.decision === "approved" ? "Approved" : "Changes requested"}`,
    `- **Sealed:** ${when}`,
    `- **Commit:** ${record.head ?? "none — this repository has no commits"}`,
    `- **Working tree:** ${record.treeDigest ? `\`${record.treeDigest.slice(0, 16)}\`` : "could not be fingerprinted"}`,
    `- **Digest:** \`${record.digest}\``,
    "",
  ];

  if (record.note.trim().length > 0) {
    lines.push("## Reviewer's note", "", record.note.trim(), "");
  }

  lines.push(
    "## Intent",
    "",
    packet.intent.trim().length > 0 ? packet.intent.trim() : "_Nothing was stated._",
    "",
    "## Change",
    "",
    packet.change.unavailable
      ? packet.change.unavailable
      : `${packet.change.files} file(s), +${packet.change.added} −${packet.change.removed}${packet.change.truncated ? " (list truncated)" : ""}`,
    "",
    "## Checks",
    "",
  );

  if (packet.checks.length === 0) {
    lines.push("_This repository declares no checks._", "");
  } else {
    for (const entry of packet.checks) {
      const result = entry.result;
      const outcome = result ? result.outcome : "not run";
      const where = result ? result.isolation : "—";
      lines.push(`- \`${entry.check.label}\` — ${outcome} (${where})`);
    }
    lines.push("");
  }

  if (packet.findings.length > 0) {
    lines.push("## Findings", "");
    for (const finding of packet.findings) {
      lines.push(`- **${finding.severity}** — ${finding.title}`, `  ${finding.detail}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "This record is tamper-evident, not tamper-proof. Its digest and the chain it",
    "sits in will reveal an edit, a reordering, or a dropped record. They cannot",
    "stop the owner of the log from rewriting the whole chain, and nothing here",
    "should be read as proof against that.",
    "",
  );

  return lines.join("\n");
}
