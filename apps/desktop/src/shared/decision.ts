/**
 * The sealed decision record.
 *
 * An evidence packet is a screen. It is assembled, read, and gone. That is
 * enough to make one merge decision and nothing else: it cannot be handed to
 * the person who asks three weeks later why this landed, it cannot be attached
 * to a pull request, and it cannot be checked against the code it described.
 *
 * A sealed record is that packet plus a human's answer, frozen together and
 * bound to the exact repository state they were looking at. Two properties
 * matter, and only two:
 *
 * **It is bound to a tree, not to a moment.** The record carries the commit it
 * was sealed against and a digest of the working tree's diff. A reader can
 * recompute that digest today and be told, factually, whether the code has
 * moved since the decision was made. An approval that has quietly detached
 * from its code is the failure this exists to catch.
 *
 * **It is tamper-evident.** Each record hashes its own contents and carries the
 * digest of the record before it, so the log is a chain. Editing one line
 * breaks it at that line, and the verifier reports where.
 *
 * ## What this is not
 *
 * It is **not tamper-proof**, and nothing here should be described as if it
 * were. The chain lives in a file the machine's owner can rewrite end to end;
 * recomputing every digest after an edit is a short script. What the chain
 * catches is the accidental and the casual -- a hand edit, a corrupted write, a
 * record reordered or dropped, a packet swapped for a different one. Real
 * proof against the file's owner needs something the owner does not control: a
 * signature over a key held elsewhere, a commit in the repository's own
 * history, or a countersignature from a service. Those are the next step and
 * are deliberately not claimed by this module.
 *
 * Saying so precisely is not a caveat bolted onto the feature. A product whose
 * entire argument is "nothing asserted that was not observed" cannot ship a
 * seal that overstates what it establishes.
 */
import type { EvidencePacket } from "./evidence";

/** What the reviewer decided. There is no "abstain": not sealing is that. */
export type Decision = "approved" | "changes-requested";

export const DECISIONS: readonly Decision[] = Object.freeze(["approved", "changes-requested"]);

/** Longest note kept. Long enough for a real reservation, short of an essay. */
export const MAX_NOTE_LENGTH = 2000;

/**
 * Output kept per check inside a sealed record.
 *
 * Smaller than the live cap. A record is appended to a log that is meant to
 * accumulate for the life of a repository, and 256 KB of build output per
 * check per decision would turn it into a multi-gigabyte file within a month.
 * The tail is what is kept, because failures print at the end, and the
 * truncation is marked in the record itself so a reader is never shown a
 * shortened log that looks complete.
 */
export const SEALED_OUTPUT_BYTES = 16 * 1024;

/**
 * The part of a record that is hashed.
 *
 * Split out from the record so the digest can never be computed over a
 * different set of fields than the ones stored -- `digest` is the only field
 * outside it, and it is the hash of exactly this.
 */
export type RecordBody = Readonly<{
  version: 1;
  /** Position in this workspace's log, from 1. */
  sequence: number;
  workspaceId: string;
  /** Commit HEAD pointed at when this was sealed. Null in a repository with no commits. */
  head: string | null;
  /**
   * Digest of the working tree's difference from HEAD. Null when it could not
   * be computed, which is stated rather than treated as "clean".
   */
  treeDigest: string | null;
  decision: Decision;
  /** The reviewer's own words. Empty when they added none. */
  note: string;
  sealedAt: number;
  /** The packet, verbatim except for the output cap above. */
  packet: EvidencePacket;
  /** Digest of the preceding record. Null for the first in a log. */
  previousDigest: string | null;
}>;

export type SealedRecord = RecordBody &
  Readonly<{
    /** SHA-256, hex, over the canonical form of the body above. */
    digest: string;
  }>;

/**
 * Deterministic JSON.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * packets built by different code paths can serialize differently and hash
 * differently. Keys are sorted at every level so the digest depends on the
 * content and nothing else.
 *
 * Undefined, functions, and symbols are rejected rather than silently dropped:
 * `JSON.stringify` omits them, which would let two records with different
 * contents produce the same digest.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  const kind = typeof value;
  if (kind === "number") {
    if (!Number.isFinite(value as number)) {
      throw new TypeError("A record cannot contain a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (kind === "string" || kind === "boolean") return JSON.stringify(value);
  if (kind === "undefined" || kind === "function" || kind === "symbol") {
    throw new TypeError(`A record cannot contain a value of type ${kind}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Strips the digest, so a record can be re-hashed exactly as it was sealed.
 *
 * The fields are listed rather than spread-minus-digest, so a field added to
 * `RecordBody` later fails to compile here instead of silently falling outside
 * the hash -- which would leave it attested to by nothing.
 */
export function bodyOf(record: SealedRecord): RecordBody {
  return {
    version: record.version,
    sequence: record.sequence,
    workspaceId: record.workspaceId,
    head: record.head,
    treeDigest: record.treeDigest,
    decision: record.decision,
    note: record.note,
    sealedAt: record.sealedAt,
    packet: record.packet,
    previousDigest: record.previousDigest,
  };
}

/**
 * Caps the output carried inside a record. Applied before sealing, so what is
 * hashed is what is stored and a reader is never shown a digest that covers
 * text the record does not contain.
 */
export function compactPacket(packet: EvidencePacket): EvidencePacket {
  // TextEncoder rather than Buffer: this module is imported by the sandboxed
  // renderer, which has no Node globals, and a shared file that only works in
  // main is a trap for whoever imports it next.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    ...packet,
    checks: packet.checks.map((entry) => {
      if (!entry.result) return entry;
      const encoded = encoder.encode(entry.result.output);
      if (encoded.length <= SEALED_OUTPUT_BYTES) return entry;

      const tail = decoder.decode(encoded.subarray(encoded.length - SEALED_OUTPUT_BYTES));
      return {
        ...entry,
        result: {
          ...entry.result,
          output: `[Docket kept only the last ${SEALED_OUTPUT_BYTES} bytes of this output when the decision was sealed]\n\n${tail}`,
          outputTruncated: true,
        },
      };
    }),
  };
}

export type VerificationProblem = Readonly<{
  /** 1-based line of the log, so a person can go and look at it. */
  line: number;
  reason: string;
}>;

export type Verification = Readonly<{
  ok: boolean;
  /** Every problem found, not just the first: one edit often breaks several. */
  problems: readonly VerificationProblem[];
}>;

/**
 * Re-derives every digest and re-walks the chain.
 *
 * Pure, and takes the digest function as an argument, so the same check runs in
 * the main process over a file and in a test over an array without either
 * needing the other's environment.
 */
export function verifyChain(
  records: readonly SealedRecord[],
  digestOf: (body: RecordBody) => string,
): Verification {
  const problems: VerificationProblem[] = [];

  records.forEach((record, index) => {
    const line = index + 1;

    if (digestOf(bodyOf(record)) !== record.digest) {
      problems.push({
        line,
        reason: "This record's contents do not match its own digest: it was changed after it was sealed.",
      });
    }

    if (record.sequence !== line) {
      problems.push({
        line,
        reason: `This record claims to be number ${record.sequence}, but it is number ${line} in the log: a record was removed or reordered.`,
      });
    }

    const expectedPrevious = index === 0 ? null : records[index - 1].digest;
    if (record.previousDigest !== expectedPrevious) {
      problems.push({
        line,
        reason:
          index === 0
            ? "The first record points at a record before it, so the start of the log is missing."
            : "This record does not point at the one before it: something between them was removed or replaced.",
      });
    }
  });

  return { ok: problems.length === 0, problems };
}

/**
 * Whether the repository still looks the way it did when this was sealed.
 *
 * `unknown` is a real answer and is kept separate from `changed`. A digest that
 * could not be computed then, or cannot be computed now, does not license the
 * conclusion that the tree is the same one.
 */
export type TreeMatch = "same" | "changed" | "unknown";

export function matchesTree(
  record: SealedRecord,
  current: Readonly<{ head: string | null; treeDigest: string | null }>,
): TreeMatch {
  if (record.treeDigest === null || current.treeDigest === null) return "unknown";
  if (record.head !== current.head) return "changed";
  return record.treeDigest === current.treeDigest ? "same" : "changed";
}

/** One line the UI can show without reassembling this logic per surface. */
export function treeMatchSummary(match: TreeMatch): string {
  if (match === "same") return "The repository is unchanged since this was sealed.";
  if (match === "changed") {
    return "The repository has changed since this was sealed, so this record describes code that is no longer what is here.";
  }
  return "Docket could not tell whether the repository has changed since this was sealed.";
}
