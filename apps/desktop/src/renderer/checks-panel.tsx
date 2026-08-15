/**
 * The checks panel.
 *
 * This is the first surface that shows evidence rather than activity. Every
 * other view in the app reports what the agents are doing; this one reports
 * what the repository can prove about itself, and it is deliberately blunt
 * about the difference between a check that failed and a check that never ran.
 *
 * Three rules shape it:
 *
 *   1. Real output, quoted. A summary of a test result is the thing being
 *      replaced, so the actual stdout is one click away and never paraphrased.
 *   2. Four outcomes, never three. Passed, failed, errored, and timed out are
 *      separate facts. Folding "did not run" into "failed" points the reader at
 *      the opposite conclusion.
 *   3. Drift is louder than results. A suite that passes because someone edited
 *      what it runs is worse than a red suite, because it buys false
 *      confidence. That warning sits above the checks, not inside one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckDiscovery, CheckDrift, CheckResult, DiscoveredCheck } from "../shared/checks";
import type { DecisionView, IsolationStatus } from "../shared/ipc-contract";
import type { Decision, SealedRecord } from "../shared/decision";
import { matchesTree, treeMatchSummary } from "../shared/decision";
import type { EvidencePacket } from "../shared/evidence";
import { verdict } from "../shared/evidence";
import { desktopApi, isBrowserPreview } from "./bridge";

type RunState = Readonly<{
  running: boolean;
  result: CheckResult | null;
  /** Output accumulated while running, before the result arrives. */
  live: string;
}>;

const IDLE: RunState = Object.freeze({ running: false, result: null, live: "" });

const OUTCOME_LABEL: Readonly<Record<CheckResult["outcome"], string>> = Object.freeze({
  passed: "Passed",
  failed: "Failed",
  errored: "Did not run",
  "timed-out": "Timed out",
});

const ISOLATION_LABEL: Readonly<Record<CheckResult["isolation"], string>> = Object.freeze({
  container: "contained",
  host: "host",
  refused: "refused",
});

export function ChecksPanel({ workspaceOpen }: { workspaceOpen: boolean }) {
  const [discovery, setDiscovery] = useState<CheckDiscovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Readonly<Record<string, RunState>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [packet, setPacket] = useState<EvidencePacket | null>(null);
  const [building, setBuilding] = useState(false);
  const [intent, setIntent] = useState("");
  const [intentSavedAt, setIntentSavedAt] = useState<number | null>(null);
  const [isolation, setIsolation] = useState<IsolationStatus | null>(null);
  const [decisions, setDecisions] = useState<DecisionView | null>(null);
  const [sealing, setSealing] = useState(false);
  const [note, setNote] = useState("");

  // Kept in a ref so the output subscription does not need re-establishing on
  // every keystroke of state; it is mounted once for the life of the panel.
  const runsRef = useRef(runs);
  runsRef.current = runs;
  // Read at build time rather than closed over, so a packet always carries the
  // text on screen instead of whatever it was when the callback was created.
  const intentRef = useRef(intent);
  intentRef.current = intent;

  const refresh = useCallback(async () => {
    if (!workspaceOpen) return;
    setLoading(true);
    setError(null);
    try {
      const [found, config, contained, sealed] = await Promise.all([
        desktopApi.checks.discover(),
        desktopApi.config.read(),
        desktopApi.checks.isolation(),
        desktopApi.decisions.read(),
      ]);
      setDiscovery(found);
      setIsolation(contained);
      setDecisions(sealed);
      // Only ever the intent recorded for this workspace; the store drops one
      // written against a different repository rather than showing it here.
      setIntent(config.intent?.text ?? "");
      setIntentSavedAt(config.intent?.recordedAt ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workspaceOpen]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return desktopApi.checks.onOutput(({ checkId, chunk }) => {
      setRuns((current) => {
        const state = current[checkId] ?? IDLE;
        if (!state.running) return current;
        // Bounded in the renderer too: a runaway build should not grow the
        // window's memory until it stops repainting.
        const live = (state.live + chunk).slice(-200_000);
        return { ...current, [checkId]: { ...state, live } };
      });
    });
  }, []);

  const run = useCallback(async (check: DiscoveredCheck) => {
    setRuns((current) => ({ ...current, [check.id]: { running: true, result: null, live: "" } }));
    setExpanded(check.id);
    try {
      const result = await desktopApi.checks.run(check.id);
      setRuns((current) => ({ ...current, [check.id]: { running: false, result, live: "" } }));
    } catch (cause) {
      // A rejected invoke is still a fact about the run, and the panel has to
      // say so rather than leaving a spinner turning forever.
      setRuns((current) => ({
        ...current,
        [check.id]: {
          running: false,
          live: "",
          result: {
            checkId: check.id,
            outcome: "errored",
            exitCode: null,
            output: "",
            outputTruncated: false,
            durationMs: 0,
            argv: [],
            error: cause instanceof Error ? cause.message : String(cause),
            isolation: "host",
            isolationReason: null,
          },
        },
      }));
    }
  }, []);

  const setRequireIsolation = useCallback(async (required: boolean) => {
    // Optimistic, then reconciled against what the store actually saved: the
    // one thing worse than the toggle not moving is the toggle moving without
    // the setting behind it changing.
    setIsolation((current) => (current ? { ...current, required } : current));
    try {
      const config = await desktopApi.checks.setRequireIsolation(required);
      setIsolation((current) =>
        current ? { ...current, required: config.requireIsolation } : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setIsolation((current) => (current ? { ...current, required: !required } : current));
    }
  }, []);

  const saveIntent = useCallback(async (text: string) => {
    try {
      const config = await desktopApi.evidence.setIntent(text);
      setIntentSavedAt(config.intent?.recordedAt ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const build = useCallback(async () => {
    setBuilding(true);
    try {
      const results = Object.values(runsRef.current)
        .map((state) => state.result)
        .filter((result): result is CheckResult => result !== null);
      setPacket(await desktopApi.evidence.build(intentRef.current, results));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
    }
  }, []);

  const seal = useCallback(async (decision: Decision) => {
    setSealing(true);
    try {
      const results = Object.values(runsRef.current)
        .map((state) => state.result)
        .filter((result): result is CheckResult => result !== null);
      const record = await desktopApi.decisions.seal(decision, note, intentRef.current, results);
      // The sealed packet replaces the one on screen. It was rebuilt from a
      // fresh read at the moment of the decision, so showing the older one
      // would leave the reviewer looking at something the record does not say.
      if (record) setPacket(record.packet);
      setNote("");
      setDecisions(await desktopApi.decisions.read());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSealing(false);
    }
  }, [note]);

  const exportRecord = useCallback(async (digest: string) => {
    try {
      await desktopApi.decisions.export(digest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const runAll = useCallback(async () => {
    for (const check of discovery?.checks ?? []) {
      // Sequential on purpose: two suites writing the same build directory at
      // once produce failures that belong to the runner, not to the change.
      await run(check);
    }
    // The packet is only meaningful once the runs it summarizes have landed.
    await build();
  }, [discovery, run, build]);

  if (!workspaceOpen) {
    return (
      <section className="checks" aria-label="Checks">
        <p className="checksEmpty">Open a repository to see the checks it defines.</p>
      </section>
    );
  }

  if (isBrowserPreview) {
    return (
      <section className="checks" aria-label="Checks">
        <p className="checksEmpty">
          The browser preview cannot run checks. There is no repository and no process, and showing
          a green suite that never ran is the one thing this panel must never do.
        </p>
      </section>
    );
  }

  const checks = discovery?.checks ?? [];
  const anyRunning = Object.values(runs).some((state) => state.running);

  return (
    <section className="checks" aria-label="Checks">
      <header className="checksHead">
        <div>
          <h2># checks</h2>
          <p>What the repository proves about itself</p>
        </div>
        <div className="checksActions">
          <button type="button" className="buttonQuiet" onClick={() => void refresh()} disabled={loading}>
            Rescan
          </button>
          <button
            type="button"
            className="buttonQuiet"
            onClick={() => void build()}
            disabled={building || anyRunning}
          >
            {building ? "Assembling…" : "Evidence"}
          </button>
          <button
            type="button"
            className="buttonSolid"
            onClick={() => void runAll()}
            disabled={anyRunning || checks.length === 0}
          >
            {anyRunning ? "Running…" : "Run all"}
          </button>
        </div>
      </header>

      {error ? <p className="checksError">{error}</p> : null}

      {isolation ? (
        <IsolationControl
          status={isolation}
          busy={anyRunning}
          onChange={(required) => void setRequireIsolation(required)}
        />
      ) : null}

      <div className="intent">
        <label className="intentLabel" htmlFor="intentInput">
          What is this change for?
        </label>
        <textarea
          id="intentInput"
          className="intentInput"
          value={intent}
          rows={2}
          placeholder="One or two lines. A reviewer reads this before the diff."
          onChange={(event) => setIntent(event.target.value)}
          onBlur={(event) => void saveIntent(event.target.value)}
        />
        <p className="intentHint">
          {intentSavedAt
            ? `Recorded ${new Date(intentSavedAt).toLocaleTimeString()} for this repository.`
            : "Without this, the packet can show the code works but not that it does what was asked."}
        </p>
      </div>

      {packet ? <Packet packet={packet} /> : null}

      {packet ? (
        <SealControl
          note={note}
          busy={sealing || anyRunning}
          onNote={setNote}
          onSeal={(decision) => void seal(decision)}
        />
      ) : null}

      {decisions ? (
        <DecisionLog view={decisions} onExport={(digest) => void exportRecord(digest)} />
      ) : null}

      {discovery ? <DriftNotice discovery={discovery} checks={checks} /> : null}

      {loading && !discovery ? <p className="checksEmpty">Reading the manifest…</p> : null}

      {!loading && checks.length === 0 ? (
        <p className="checksEmpty">
          This repository does not declare a test, lint, typecheck, or build script. Docket only runs
          checks the project defines for itself — one it invented would prove nothing about your code.
        </p>
      ) : null}

      <ul className="checkList">
        {checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            state={runs[check.id] ?? IDLE}
            drift={discovery?.drift.find((entry) => entry.checkId === check.id) ?? null}
            expanded={expanded === check.id}
            onToggle={() => setExpanded((current) => (current === check.id ? null : check.id))}
            onRun={() => void run(check)}
            onCancel={() => void desktopApi.checks.cancel(check.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The isolation requirement.
 *
 * Deliberately not a silent preference in a settings pane. It changes whether a
 * green result means "this passed in a box with no network and no access to
 * your keys" or "this passed with everything you have", and the person reading
 * the packet later has to know which one they are looking at. So it sits above
 * the checks, states what is available right now, and says plainly what turning
 * it on will cost when nothing is available.
 */
function IsolationControl({
  status,
  busy,
  onChange,
}: {
  status: IsolationStatus;
  busy: boolean;
  onChange: (required: boolean) => void;
}) {
  const available = status.runtime !== null;

  return (
    <div className="isolation" data-available={available} data-required={status.required}>
      <label className="isolationToggle">
        <input
          type="checkbox"
          checked={status.required}
          disabled={busy}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>Require isolation</span>
      </label>

      <p className="isolationState">
        {available ? (
          <>
            Checks run contained, using <code>{status.runtime}</code>.
          </>
        ) : status.required ? (
          <>{status.reason} Checks will not run until one is available.</>
        ) : (
          <>{status.reason}</>
        )}
      </p>
    </div>
  );
}

function DriftNotice({
  discovery,
  checks,
}: {
  discovery: CheckDiscovery;
  checks: readonly DiscoveredCheck[];
}) {
  if (discovery.committedUnavailable) {
    return (
      <p className="checksNotice" data-tone="unknown">
        Docket could not read the committed version of these checks, so it cannot tell whether they
        have been modified. Treat a pass as unverified.
      </p>
    );
  }

  const changed = discovery.drift.filter((entry) => entry.reason === "changed");
  if (changed.length === 0) return null;

  const names = changed
    .map((entry) => checks.find((check) => check.id === entry.checkId)?.label ?? entry.checkId)
    .join(", ");

  return (
    <p className="checksNotice" data-tone="drift">
      {changed.length === 1 ? "This check has" : "These checks have"} been changed since the last
      commit: {names}. A suite that passes because its definition was edited proves nothing — compare
      the two below before trusting a green result.
    </p>
  );
}

function CheckRow({
  check,
  state,
  drift,
  expanded,
  onToggle,
  onRun,
  onCancel,
}: {
  check: DiscoveredCheck;
  state: RunState;
  drift: CheckDrift | null;
  expanded: boolean;
  onToggle: () => void;
  onRun: () => void;
  onCancel: () => void;
}) {
  const { result, running } = state;
  const body = running ? state.live : (result?.output ?? "");

  return (
    <li className="checkItem" data-outcome={result?.outcome ?? (running ? "running" : "idle")}>
      <div className="checkRow">
        <button type="button" className="checkToggle" onClick={onToggle} aria-expanded={expanded}>
          <span className="checkKind">{check.kind}</span>
          <span className="checkLabel">{check.label}</span>
          {drift?.reason === "changed" ? <span className="checkFlag">edited</span> : null}
        </button>

        <span className="checkOutcome">
          {result ? (
            <span className="checkIsolation" data-isolation={result.isolation}>
              {ISOLATION_LABEL[result.isolation]}
            </span>
          ) : null}
          {running ? "Running…" : result ? OUTCOME_LABEL[result.outcome] : "Not run"}
          {result && result.outcome !== "errored" ? (
            <span className="checkDuration">{formatDuration(result.durationMs)}</span>
          ) : null}
        </span>

        {running ? (
          <button type="button" className="buttonQuiet" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button type="button" className="buttonQuiet" onClick={onRun}>
            Run
          </button>
        )}
      </div>

      {expanded ? (
        <div className="checkDetail">
          {drift?.reason === "changed" ? (
            <div className="checkDrift">
              <p className="checkDriftHead">This check was edited since the last commit</p>
              <p className="checkDriftLine" data-side="before">
                <span>committed</span>
                <code>{drift.committed}</code>
              </p>
              <p className="checkDriftLine" data-side="after">
                <span>now</span>
                <code>{drift.working}</code>
              </p>
            </div>
          ) : null}

          {result?.error ? <p className="checkError">{result.error}</p> : null}

          {result && result.isolation !== "container" && result.isolationReason ? (
            <p className="checkUncontained">{result.isolationReason}</p>
          ) : null}

          {result && result.argv.length > 0 ? (
            <p className="checkArgv">
              <code>{result.argv.join(" ")}</code>
            </p>
          ) : null}

          {body ? (
            <pre className="checkOutput">
              {body}
              {result?.outputTruncated ? "\n\n[output was truncated]" : ""}
            </pre>
          ) : running ? (
            <p className="checkPending">Waiting for output…</p>
          ) : result ? (
            <p className="checkPending">This check produced no output.</p>
          ) : (
            <p className="checkPending">
              <code>{check.declaration}</code>
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Sealing a decision.
 *
 * Two buttons and a note, placed directly under the packet rather than in a
 * dialog, because the decision is about what is immediately above it. The
 * sentence about what a seal does not establish is here rather than in a
 * tooltip: someone about to attest to a merge is the person who most needs to
 * know the limit of what they are producing.
 */
function SealControl({
  note,
  busy,
  onNote,
  onSeal,
}: {
  note: string;
  busy: boolean;
  onNote: (text: string) => void;
  onSeal: (decision: Decision) => void;
}) {
  return (
    <div className="seal">
      <label className="sealLabel" htmlFor="sealNote">
        Seal this decision
      </label>
      <textarea
        id="sealNote"
        className="sealNote"
        value={note}
        rows={2}
        placeholder="Optional. What you decided and why — the part the evidence cannot say for you."
        onChange={(event) => onNote(event.target.value)}
      />
      <div className="sealActions">
        <button
          type="button"
          className="buttonSolid"
          disabled={busy}
          onClick={() => onSeal("approved")}
        >
          Approve
        </button>
        <button
          type="button"
          className="buttonQuiet"
          disabled={busy}
          onClick={() => onSeal("changes-requested")}
        >
          Request changes
        </button>
      </div>
      <p className="sealHint">
        The packet is rebuilt and frozen against the commit and working tree as they are right now,
        so a later reader can be told whether the code has moved since. The record is tamper-evident,
        not tamper-proof: it will reveal an edit or a dropped record, and it cannot stop whoever owns
        this machine from rewriting the whole log.
      </p>
    </div>
  );
}

/** Prior decisions for this repository, newest first, each judged against the tree as it is now. */
function DecisionLog({
  view,
  onExport,
}: {
  view: DecisionView;
  onExport: (digest: string) => void;
}) {
  if (view.unavailable) {
    return (
      <p className="checksNotice" data-tone="unknown">
        {view.unavailable}
      </p>
    );
  }
  if (view.records.length === 0) return null;

  return (
    <section className="records" aria-label="Sealed decisions">
      <p className="recordsHead">Sealed decisions</p>

      {view.verification.ok ? null : (
        <p className="checksNotice" data-tone="drift">
          This log does not verify. {view.verification.problems.length === 1 ? "One record" : `${view.verification.problems.length} records`} could
          not be confirmed as sealed: {view.verification.problems.map((problem) => `line ${problem.line} — ${problem.reason}`).join(" ")}
        </p>
      )}

      <ul className="recordList">
        {[...view.records].reverse().map((record) => (
          <Record key={record.digest} record={record} current={view.current} onExport={onExport} />
        ))}
      </ul>
    </section>
  );
}

function Record({
  record,
  current,
  onExport,
}: {
  record: SealedRecord;
  current: DecisionView["current"];
  onExport: (digest: string) => void;
}) {
  const match = matchesTree(record, current);

  return (
    <li className="record" data-decision={record.decision} data-tree={match}>
      <div className="recordRow">
        <span className="recordSequence">#{record.sequence}</span>
        <span className="recordDecision">
          {record.decision === "approved" ? "Approved" : "Changes requested"}
        </span>
        <span className="recordWhen">{new Date(record.sealedAt).toLocaleString()}</span>
        <button type="button" className="buttonQuiet" onClick={() => onExport(record.digest)}>
          Export
        </button>
      </div>

      {record.note ? <p className="recordNote">{record.note}</p> : null}

      <p className="recordTree">{treeMatchSummary(match)}</p>

      <p className="recordDigest">
        <code>{record.digest.slice(0, 16)}</code>
        {record.head ? (
          <>
            {" at "}
            <code>{record.head.slice(0, 12)}</code>
          </>
        ) : (
          " — no commit"
        )}
      </p>
    </li>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * The packet summary.
 *
 * Ordered so the reader meets the verdict, then what changed, then what is left
 * for them, then reach. Findings come before reach deliberately: breadth is
 * context for a decision, never the decision itself.
 */
function Packet({ packet }: { packet: EvidencePacket }) {
  const { change, reach, findings } = packet;

  return (
    <section className="packet" data-clean={packet.clean} aria-label="Evidence packet">
      <p className="packetVerdict">{verdict(packet)}</p>

      {packet.intent ? (
        <p className="packetIntent">
          <span>Intended</span>
          {packet.intent}
        </p>
      ) : null}

      <p className="packetChange">
        {change.unavailable ? (
          change.unavailable
        ) : (
          <>
            {change.files} {change.files === 1 ? "file" : "files"} changed
            <span className="packetAdded"> +{change.added}</span>
            <span className="packetRemoved"> −{change.removed}</span>
            {change.truncated ? " (list truncated)" : ""}
          </>
        )}
      </p>

      {findings.length > 0 ? (
        <ul className="findingList">
          {findings.map((finding) => (
            <li key={finding.id} className="finding" data-severity={finding.severity}>
              <p className="findingTitle">
                <span className="findingBadge">{finding.severity}</span>
                {finding.title}
              </p>
              <p className="findingDetail">{finding.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {reach.unavailable ? (
        <p className="packetReachNote">Docket could not search for references: {reach.unavailable}</p>
      ) : reach.references.length > 0 ? (
        <div className="packetReach">
          <p className="packetReachHead">Referenced outside this change</p>
          <ul>
            {reach.references.slice(0, 5).map((entry) => (
              <li key={entry.symbol}>
                <code>{entry.symbol}</code>
                <span className="packetReachCount">
                  {entry.files.length}
                  {entry.truncated ? "+" : ""} {entry.files.length === 1 ? "file" : "files"}
                </span>
                <span className="packetReachFiles">{entry.files.slice(0, 4).join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
