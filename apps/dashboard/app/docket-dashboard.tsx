"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CircleStop,
  Clock3,
  Cloud,
  Code2,
  Cpu,
  Fingerprint,
  Gauge,
  GitBranch,
  HardDrive,
  Inbox,
  Layers3,
  LayoutList,
  ListFilter,
  Map,
  Menu,
  Network,
  PanelRightOpen,
  Pause,
  Play,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TestTube2,
  UserCheck,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ThemeSwitcher from "./theme-switcher";
import type { ThemeName } from "./theme-switcher";
import { WorkshopView } from "./workshop-view";

type Tone = "attention" | "active" | "success" | "blocked" | "queued";
type LedgerTab = "timeline" | "changes" | "evidence";
type RouteMode = "Private" | "Economy" | "Balanced" | "Quality";
type WorkspaceView = "ledger" | "workshop";

type Mission = {
  id: string;
  title: string;
  repo: string;
  branch: string;
  status: string;
  tone: Tone;
  risk: "Low" | "Medium" | "High";
  stage: number;
  worker: string;
  workerShort: string;
  reviewer: string;
  placement: string;
  placementKind: "local" | "private" | "cloud";
  routePolicy: string;
  routeMode: RouteMode;
  elapsed: string;
  cost: string;
  budget: string;
  progress: number;
  changedFiles: number;
  checks: string;
};

const missions: Mission[] = [
  {
    id: "DOC-184",
    title: "Harden refresh-token rotation",
    repo: "relay/api",
    branch: "docket/refresh-token-rotation",
    status: "Approval required",
    tone: "attention",
    risk: "High",
    stage: 4,
    worker: "Qwen3-Coder-Next-FP8",
    workerShort: "Qwen3 Coder Next",
    reviewer: "gpt-oss-120b",
    placement: "Private GPU · vLLM",
    placementKind: "private",
    routePolicy: "docket-prod-7",
    routeMode: "Quality",
    elapsed: "11m 42s",
    cost: "$0.38",
    budget: "$0.80",
    progress: 82,
    changedFiles: 4,
    checks: "6/6",
  },
  {
    id: "DOC-191",
    title: "Write the v2 migration guide",
    repo: "relay/docs",
    branch: "docket/v2-migration-guide",
    status: "Running",
    tone: "active",
    risk: "Low",
    stage: 2,
    worker: "gpt-oss-20b",
    workerShort: "gpt-oss 20B",
    reviewer: "Qwen3.6-35B-A3B",
    placement: "This Mac · llama.cpp",
    placementKind: "local",
    routePolicy: "docket-prod-7",
    routeMode: "Economy",
    elapsed: "02m 18s",
    cost: "$0.00",
    budget: "$0.12",
    progress: 44,
    changedFiles: 2,
    checks: "2/4",
  },
  {
    id: "DOC-176",
    title: "Stop duplicate job dispatch",
    repo: "relay/orchestrator",
    branch: "docket/idempotent-dispatch",
    status: "Validating",
    tone: "active",
    risk: "High",
    stage: 3,
    worker: "DeepSeek-V4-Flash",
    workerShort: "DeepSeek V4 Flash",
    reviewer: "Qwen3-Coder-Next-FP8",
    placement: "EU cloud · SGLang",
    placementKind: "cloud",
    routePolicy: "docket-prod-7",
    routeMode: "Balanced",
    elapsed: "18m 06s",
    cost: "$1.72",
    budget: "$2.50",
    progress: 69,
    changedFiles: 7,
    checks: "11/12",
  },
  {
    id: "DOC-167",
    title: "Index architecture decisions",
    repo: "relay/platform",
    branch: "docket/adr-index",
    status: "Queued",
    tone: "queued",
    risk: "Low",
    stage: 0,
    worker: "Devstral-Small-2-24B",
    workerShort: "Devstral Small 2",
    reviewer: "Qwen3.6-35B-A3B",
    placement: "This Mac · llama.cpp",
    placementKind: "local",
    routePolicy: "docket-prod-7",
    routeMode: "Private",
    elapsed: "—",
    cost: "$0.00",
    budget: "$0.10",
    progress: 8,
    changedFiles: 0,
    checks: "0/3",
  },
  {
    id: "DOC-159",
    title: "Upgrade dependency policy",
    repo: "relay/web",
    branch: "docket/dependency-policy",
    status: "Policy blocked",
    tone: "blocked",
    risk: "Medium",
    stage: 1,
    worker: "No eligible model",
    workerShort: "No eligible model",
    reviewer: "—",
    placement: "Restricted data",
    placementKind: "local",
    routePolicy: "docket-prod-7",
    routeMode: "Private",
    elapsed: "00m 08s",
    cost: "$0.00",
    budget: "$0.30",
    progress: 18,
    changedFiles: 0,
    checks: "0/5",
  },
];

type MissionDetail = {
  decisionTitle: string;
  decisionSummary: string;
  changesTitle: string;
  diff: string;
  invariants: Array<{ title: string; detail: string; state: "Covered" | "Review" | "Pending" }>;
  files: Array<[string, string, string, string]>;
  routeReason: string;
  rejectedWorker: string;
  rejectedReason: string;
  trace: string;
};

const missionDetails: Record<string, MissionDetail> = {
  "DOC-184": {
    decisionTitle: "Approve refresh-token invariants",
    decisionSummary:
      "Rotation now revokes a token family before replacement. All gates passed; the concurrency invariant still needs human ownership.",
    changesTitle: "Four files, two auth invariants",
    diff: "+128 −41",
    invariants: [
      {
        title: "Refresh tokens remain single-use",
        detail: "Atomic family revocation now occurs before replacement issuance.",
        state: "Covered",
      },
      {
        title: "Concurrent refreshes cannot fork a session",
        detail: "A database compare-and-swap protects the rotation boundary.",
        state: "Review",
      },
    ],
    files: [
      ["src/auth/refresh.ts", "+54", "−18", "High"],
      ["src/auth/token-store.ts", "+31", "−12", "High"],
      ["tests/auth/rotation.test.ts", "+39", "−8", "Medium"],
      ["docs/security-model.md", "+4", "−3", "Low"],
    ],
    routeReason: "Cheapest certified model above the auth-risk threshold",
    rejectedWorker: "gpt-oss-20b",
    rejectedReason: "local auth evaluation below policy threshold",
    trace: "demo_rt_doc184",
  },
  "DOC-191": {
    decisionTitle: "No human decision yet",
    decisionSummary:
      "The migration guide is still being drafted locally. Approval will unlock only after link and example validation completes.",
    changesTitle: "Two docs, two reader outcomes",
    diff: "+86 −1",
    invariants: [
      {
        title: "Existing v1 links remain valid",
        detail: "Redirect targets and anchors are checked against the current docs build.",
        state: "Pending",
      },
      {
        title: "Every breaking change has a migration step",
        detail: "Code examples are generated against the v2 API surface.",
        state: "Review",
      },
    ],
    files: [
      ["docs/migration-v2.md", "+82", "−0", "Medium"],
      ["docs/index.md", "+4", "−1", "Low"],
    ],
    routeReason: "Local low-cost worker certified for documentation",
    rejectedWorker: "Qwen3-Coder-Next-FP8",
    rejectedReason: "private GPU coder unnecessary for low-risk documentation",
    trace: "demo_rt_doc191",
  },
  "DOC-176": {
    decisionTitle: "Validation incomplete",
    decisionSummary:
      "The dispatch fix has passed 11 of 12 gates. Human approval remains locked until the replay stress test completes.",
    changesTitle: "Seven files, two delivery invariants",
    diff: "+214 −73",
    invariants: [
      {
        title: "A lease can dispatch a job only once",
        detail: "Fencing tokens reject stale workers before queue publication.",
        state: "Covered",
      },
      {
        title: "Retries preserve the idempotency key",
        detail: "The final replay stress test is still running.",
        state: "Pending",
      },
    ],
    files: [
      ["src/queue/dispatcher.ts", "+76", "−31", "High"],
      ["src/queue/lease.ts", "+44", "−17", "High"],
      ["tests/queue/replay.test.ts", "+61", "−13", "High"],
      ["docs/runbook/duplicate-jobs.md", "+33", "−12", "Medium"],
    ],
    routeReason: "Cloud burst selected for concurrency reasoning and long context",
    rejectedWorker: "gpt-oss-20b",
    rejectedReason: "local worker failed duplicate-dispatch certification",
    trace: "demo_rt_doc176",
  },
  "DOC-167": {
    decisionTitle: "Mission is queued",
    decisionSummary:
      "No worker has started. The local documentation route will be confirmed when a runner lease becomes available.",
    changesTitle: "No changes produced",
    diff: "+0 −0",
    invariants: [
      {
        title: "Every ADR remains source-linked",
        detail: "The index will point to repository paths rather than copy decision text.",
        state: "Pending",
      },
      {
        title: "Superseded decisions stay discoverable",
        detail: "Status and replacement links are part of the acceptance criteria.",
        state: "Pending",
      },
    ],
    files: [],
    routeReason: "Local documentation route awaiting capacity",
    rejectedWorker: "No candidate rejected",
    rejectedReason: "no provider call has been made",
    trace: "demo_rt_doc167",
  },
  "DOC-159": {
    decisionTitle: "Resolve the policy block",
    decisionSummary:
      "The task contains restricted dependency metadata, but no connected local worker is certified for this policy class.",
    changesTitle: "No changes produced",
    diff: "+0 −0",
    invariants: [
      {
        title: "Restricted metadata stays local",
        detail: "External routes remain ineligible until the data class changes.",
        state: "Covered",
      },
      {
        title: "Dependency policy requires a certified worker",
        detail: "Connect or certify a local model before retrying.",
        state: "Pending",
      },
    ],
    files: [],
    routeReason: "No eligible model for restricted data",
    rejectedWorker: "External providers",
    rejectedReason: "all configured external routes violate locality policy",
    trace: "demo_rt_doc159",
  },
};

const stages = ["Plan", "Route", "Execute", "Validate", "Approve", "Integrate"];
const routeModes: RouteMode[] = ["Private", "Economy", "Balanced", "Quality"];

const navItems = [
  { label: "Workbench", icon: Activity, active: true },
  { label: "Approvals", icon: Inbox, badge: "2" },
  { label: "Missions", icon: Layers3 },
  { label: "Agents", icon: Bot },
  { label: "Models", icon: Cpu },
  { label: "Policies", icon: ShieldCheck },
  { label: "Audit", icon: ReceiptText },
];

function statusTone(status: string, original: Tone): Tone {
  if (status === "Approved") return "success";
  if (status === "Paused" || status === "Ready to reroute") return "queued";
  if (status === "Stopped") return "blocked";
  return original;
}

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={"statusPill status-" + tone}>
      <span className="statusMark" aria-hidden="true" />
      {children}
    </span>
  );
}

function PlacementIcon({ kind }: { kind: Mission["placementKind"] }) {
  if (kind === "local") return <HardDrive size={13} aria-hidden="true" />;
  if (kind === "private") return <Cpu size={13} aria-hidden="true" />;
  return <Cloud size={13} aria-hidden="true" />;
}

function trapFocusInPanel(event: KeyboardEvent, panel: HTMLElement) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function DocketDashboard() {
  const [selectedId, setSelectedId] = useState(missions[0].id);
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("timeline");
  const [routeMode, setRouteMode] = useState<RouteMode>("Balanced");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("ledger");
  const [theme, setTheme] = useState<ThemeName>("violet");
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  const [attemptStoppedIds, setAttemptStoppedIds] = useState<Set<string>>(new Set());
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(new Set());
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [stopMenuOpen, setStopMenuOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [compactMissions, setCompactMissions] = useState(false);
  const [compactTrust, setCompactTrust] = useState(false);
  const [receiptExpanded, setReceiptExpanded] = useState(true);
  const [toast, setToast] = useState("Demo workspace loaded with simulated run data.");
  const missionTriggerRef = useRef<HTMLButtonElement>(null);
  const missionCloseRef = useRef<HTMLButtonElement>(null);
  const trustTriggerRef = useRef<HTMLButtonElement>(null);
  const trustCloseRef = useRef<HTMLButtonElement>(null);
  const missionPanelRef = useRef<HTMLElement>(null);
  const trustPanelRef = useRef<HTMLElement>(null);
  const runTitleRef = useRef<HTMLHeadingElement>(null);
  const stopTriggerRef = useRef<HTMLButtonElement>(null);
  const stopControlRef = useRef<HTMLDivElement>(null);
  const executionPathRef = useRef<HTMLButtonElement>(null);
  const stopItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const missionFocusAfterCloseRef = useRef<"trigger" | "run-title" | "selected-pod" | null>(null);
  const trustFocusAfterCloseRef = useRef<"trigger" | "changes" | null>(null);
  const stopFocusAfterCloseRef = useRef<"trigger" | "next" | null>(null);

  const selected = useMemo(
    () => missions.find((mission) => mission.id === selectedId) ?? missions[0],
    [selectedId],
  );
  const selectedDetail = missionDetails[selected.id];
  const routeBlocked = selected.worker === "No eligible model";
  const routePending = selected.stage === 0;
  const routeVerified = !routeBlocked && !routePending;
  const needsApproval = selected.status === "Approval required";
  const [checksPassed, checksTotal] = selected.checks.split("/").map(Number);
  const checksComplete = checksPassed === checksTotal && checksTotal > 0;
  const missionDrawerOpen = compactMissions && missionsOpen;
  const trustDrawerOpen = compactTrust && trustOpen;
  const modalDrawerOpen = missionDrawerOpen || trustDrawerOpen;

  const isPaused = pausedIds.has(selected.id);
  const isAttemptStopped = attemptStoppedIds.has(selected.id);
  const isStopped = stoppedIds.has(selected.id);
  const isApproved = approvedIds.has(selected.id);
  const hasRunningAttempt = selected.status === "Running" || selected.status === "Validating";
  const canPause = hasRunningAttempt && !isAttemptStopped && !isStopped && !isApproved;
  const canStop = canPause && !isPaused;
  const routeIsActive = hasRunningAttempt && !isPaused && !isAttemptStopped && !isStopped;
  const canApprove = needsApproval && checksComplete && !isStopped && !isApproved;
  const selectedStatus = isStopped
    ? "Stopped"
    : isApproved
      ? "Approved"
      : isAttemptStopped
        ? "Ready to reroute"
        : isPaused
          ? "Paused"
          : selected.status;
  const validationState = routeBlocked
    ? "blocked"
    : checksComplete
      ? "passed"
      : "pending";
  const evidenceRows = routeBlocked
    ? [
        {
          label: "Restricted-data locality policy",
          duration: "0.4s",
          kind: "No eligible local worker",
          state: "blocked" as const,
        },
      ]
    : routePending
      ? [
          {
            label: "Runner lease",
            duration: "Waiting",
            kind: "No provider call",
            state: "pending" as const,
          },
        ]
      : [
          {
            label: "Repository and data policy classification",
            duration: "0.4s",
            kind: "Deterministic",
            state: "passed" as const,
          },
          {
            label: selected.repo + " acceptance checks",
            duration: selected.elapsed,
            kind: selected.checks + " gates reported",
            state: (checksComplete ? "passed" : "pending") as "passed" | "pending",
          },
          {
            label: selected.reviewer + " independent review",
            duration: selected.stage >= 3 ? "24.1s" : "Not started",
            kind: selected.stage >= 3 ? "Model-assisted" : "Pending",
            state: (selected.stage >= 3 && checksComplete ? "passed" : "pending") as
              | "passed"
              | "pending",
          },
        ];

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("docket-atmosphere");
    if (savedTheme !== "violet" && savedTheme !== "mineral" && savedTheme !== "sand") {
      return;
    }
    const frame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const missionsQuery = window.matchMedia("(max-width: 920px)");
    const trustQuery = window.matchMedia("(max-width: 1439px)");
    const sync = () => {
      setCompactMissions(missionsQuery.matches);
      setCompactTrust(trustQuery.matches);
    };
    sync();
    missionsQuery.addEventListener("change", sync);
    trustQuery.addEventListener("change", sync);
    return () => {
      missionsQuery.removeEventListener("change", sync);
      trustQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (compactMissions && missionsOpen) {
      window.requestAnimationFrame(() => missionCloseRef.current?.focus());
    } else if (!missionsOpen && missionFocusAfterCloseRef.current) {
      const target = missionFocusAfterCloseRef.current;
      missionFocusAfterCloseRef.current = null;
      window.requestAnimationFrame(() => {
        if (target === "selected-pod") {
          document.querySelector<HTMLButtonElement>(".workshopPod[aria-pressed='true']")?.focus();
        } else if (target === "run-title") {
          runTitleRef.current?.focus();
        } else {
          missionTriggerRef.current?.focus();
        }
      });
    }
  }, [compactMissions, missionsOpen]);

  useEffect(() => {
    if (compactTrust && trustOpen) {
      window.requestAnimationFrame(() => trustCloseRef.current?.focus());
    } else if (!trustOpen && trustFocusAfterCloseRef.current) {
      const target = trustFocusAfterCloseRef.current;
      trustFocusAfterCloseRef.current = null;
      window.requestAnimationFrame(() => {
        if (target === "changes") document.getElementById("tab-changes")?.focus();
        else trustTriggerRef.current?.focus();
      });
    }
  }, [compactTrust, trustOpen]);

  useEffect(() => {
    if (stopMenuOpen) {
      window.requestAnimationFrame(() => stopItemRefs.current[0]?.focus());
    } else if (stopFocusAfterCloseRef.current) {
      const target = stopFocusAfterCloseRef.current;
      stopFocusAfterCloseRef.current = null;
      window.requestAnimationFrame(() => {
        if (target === "next") executionPathRef.current?.focus();
        else stopTriggerRef.current?.focus();
      });
    }
  }, [stopMenuOpen]);

  useEffect(() => {
    if (!stopMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (stopControlRef.current?.contains(event.target as Node)) return;
      stopFocusAfterCloseRef.current = null;
      setStopMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [stopMenuOpen]);

  useEffect(() => {
    const panel = missionPanelRef.current;
    if (!missionDrawerOpen || !panel) return;
    const handleKeyDown = (event: KeyboardEvent) => trapFocusInPanel(event, panel);
    panel.addEventListener("keydown", handleKeyDown);
    return () => panel.removeEventListener("keydown", handleKeyDown);
  }, [missionDrawerOpen]);

  useEffect(() => {
    const panel = trustPanelRef.current;
    if (!trustDrawerOpen || !panel) return;
    const handleKeyDown = (event: KeyboardEvent) => trapFocusInPanel(event, panel);
    panel.addEventListener("keydown", handleKeyDown);
    return () => panel.removeEventListener("keydown", handleKeyDown);
  }, [trustDrawerOpen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (stopMenuOpen) {
        stopFocusAfterCloseRef.current = "trigger";
        setStopMenuOpen(false);
        return;
      }
      if (trustOpen) {
        trustFocusAfterCloseRef.current = "trigger";
        setTrustOpen(false);
        return;
      }
      if (missionsOpen) {
        missionFocusAfterCloseRef.current = "trigger";
        setMissionsOpen(false);
      }
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [missionsOpen, stopMenuOpen, trustOpen]);

  function chooseMission(id: string) {
    setSelectedId(id);
    setLedgerTab("timeline");
    if (compactMissions) {
      missionFocusAfterCloseRef.current = workspaceView === "workshop" ? "selected-pod" : "run-title";
    }
    setMissionsOpen(false);
    setStopMenuOpen(false);
  }

  function setMode(mode: RouteMode) {
    setRouteMode(mode);
    setToast(mode + " routing will apply to new work units. Active routes are unchanged.");
  }

  function setAtmosphere(nextTheme: ThemeName) {
    setTheme(nextTheme);
    window.localStorage.setItem("docket-atmosphere", nextTheme);
    setToast(nextTheme === "violet" ? "Violet Ink atmosphere applied." : nextTheme === "mineral" ? "Mineral Blue atmosphere applied." : "Warm Sand atmosphere applied.");
  }

  function togglePaused() {
    if (!canPause && !isPaused) {
      setToast("Pause is available only while a worker attempt is running.");
      return;
    }
    const next = new Set(pausedIds);
    if (next.has(selected.id)) {
      next.delete(selected.id);
      setToast(selected.id + " resumed from its last verified checkpoint.");
    } else {
      next.add(selected.id);
      setToast(selected.id + " paused after the current tool call.");
    }
    setPausedIds(next);
  }

  function stopRun(scope: "attempt" | "mission") {
    if (!canStop) {
      setStopMenuOpen(false);
      setToast("Stop is available only while a worker attempt is running.");
      return;
    }
    if (
      scope === "mission" &&
      !window.confirm(
        "Stop the entire mission, cancel child work, and revoke its temporary credentials?",
      )
    ) {
      stopFocusAfterCloseRef.current = "trigger";
      setStopMenuOpen(false);
      return;
    }
    if (scope === "attempt") {
      const next = new Set(attemptStoppedIds);
      next.add(selected.id);
      setAttemptStoppedIds(next);
    } else {
      const next = new Set(stoppedIds);
      next.add(selected.id);
      setStoppedIds(next);
    }
    const nextPaused = new Set(pausedIds);
    nextPaused.delete(selected.id);
    setPausedIds(nextPaused);
    stopFocusAfterCloseRef.current = "trigger";
    setStopMenuOpen(false);
    setToast(
      scope === "attempt"
        ? "The current worker attempt was stopped. The mission remains recoverable."
        : selected.id + " was stopped and its credentials were revoked.",
    );
  }

  function approveRun() {
    if (!canApprove) {
      setToast("Approval stays locked until policy and every required gate pass.");
      return;
    }
    const next = new Set(approvedIds);
    next.add(selected.id);
    setApprovedIds(next);
    setToast(selected.id + " approved. Integration remains pending; no merge was performed in this demo.");
  }

  function requestChanges() {
    setToast("Change request drafted with the selected evidence attached.");
  }

  function moveLedgerTab(current: LedgerTab, direction: 1 | -1) {
    const tabs: LedgerTab[] = ["timeline", "changes", "evidence"];
    const index = tabs.indexOf(current);
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    setLedgerTab(next);
    window.requestAnimationFrame(() => document.getElementById("tab-" + next)?.focus());
  }

  function navigateStopMenu(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      stopFocusAfterCloseRef.current = event.shiftKey ? "trigger" : "next";
      setStopMenuOpen(false);
      return;
    }
    const items = stopItemRefs.current.filter(
      (item): item is HTMLButtonElement => item !== null,
    );
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next].focus();
  }

  const routeEvents = [
    {
      stage: 0,
      time: "15:04:12",
      title: "Risk and data policy classified",
      detail:
        selected.risk +
        " risk · repository-scoped context · independent validation required.",
      icon: ShieldCheck,
      tone: "neutral",
      meta: "policy docket-prod-7",
    },
    {
      stage: 1,
      time: "15:04:14",
      title: routeBlocked ? "Route blocked by policy" : "Worker route verified",
      detail: routeBlocked
        ? "No connected local worker is certified for this data class. No provider call was made."
        : "Controller remained Codex. Provider reported " +
          selected.worker +
          " on " +
          selected.placement +
          ".",
      icon: routeBlocked ? AlertTriangle : Network,
      tone: routeBlocked ? "attention" : "route",
      meta: selected.placementKind === "cloud" ? "egress: redacted" : "egress: none",
    },
    {
      stage: 2,
      time: "15:04:18",
      title: "Isolated workspace provisioned",
      detail:
        "Ephemeral worktree mounted read/write; host credentials withheld; network allowlist applied.",
      icon: TerminalSquare,
      tone: "neutral",
      meta: selected.branch,
    },
    {
      stage: 2,
      time: "15:09:51",
      title: selected.changedFiles + " files changed",
      detail:
        "Worker returned a bounded patch and assumptions. The controller did not accept model self-validation.",
      icon: Code2,
      tone: "neutral",
      meta: selectedDetail.diff,
    },
    {
      stage: 3,
      time: "15:13:36",
      title:
        selected.checks +
        (checksComplete ? " validation gates passed" : " validation gates reported"),
      detail:
        "Typecheck, unit tests, integration tests, secret scan, policy checks and independent review.",
      icon: TestTube2,
      tone: checksComplete ? "success" : "active",
      meta: "evidence bundle #ev-819",
    },
    {
      stage: 4,
      time: "15:15:54",
      title: isApproved
        ? "Human approval recorded"
        : selected.status === "Approval required"
          ? "Human decision requested"
          : "Latest checkpoint recorded",
      detail:
        isApproved
          ? "Approval was recorded. Integration remains pending; this prototype did not merge."
          : selected.status === "Approval required"
            ? "Authentication behavior changed. Review the invariant summary before integration."
            : "The run can resume from this event without replaying completed work.",
      icon: UserCheck,
      tone: isApproved ? "success" : selected.status === "Approval required" ? "attention" : "neutral",
      meta: "tamper-evident ledger",
    },
  ];

  return (
    <div className="docketApp" data-theme={theme}>
      <a className="skipLink" href="#run-ledger">
        Skip to run ledger
      </a>

      <aside
        className="appRail"
        aria-label="Primary navigation"
        inert={modalDrawerOpen ? true : undefined}
      >
        <div className="railBrand" aria-label="Docket home">
          <span>A</span>
        </div>
        <nav className="railNav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={"railButton" + (item.active ? " is-active" : "")}
                key={item.label}
                aria-label={item.label}
                title={item.label}
                type="button"
                onClick={() => setToast(item.label + " is part of the product prototype.")}
              >
                <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                <span className="railLabel">{item.label}</span>
                {item.badge ? <span className="railBadge">{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="railSpacer" />
        <button
          className="railButton"
          aria-label="Settings"
          title="Settings"
          type="button"
          onClick={() => setToast("Settings are not connected in this prototype.")}
        >
          <Settings2 size={20} aria-hidden="true" />
          <span className="railLabel">Settings</span>
        </button>
        <button className="profileButton" type="button" aria-label="Open profile menu">
          <span>DV</span>
          <i aria-hidden="true" />
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar" inert={modalDrawerOpen ? true : undefined}>
          <div className="topbarIdentity">
            <button
              className="mobilePanelButton"
              type="button"
              ref={missionTriggerRef}
              aria-label="Open missions"
              aria-expanded={missionsOpen}
              onClick={() => setMissionsOpen(true)}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <div>
              <p className="eyebrow">Workspace</p>
              <button className="workspacePicker" type="button">
                Relay engineering
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </div>
            <span className="syncState">
              <span aria-hidden="true" />
              Local control plane
            </span>
          </div>

          <div className="topbarActions">
            <div className="viewSwitcher" role="group" aria-label="Workspace view">
              <button
                className={workspaceView === "ledger" ? "viewModeButton is-active" : "viewModeButton"}
                type="button"
                aria-pressed={workspaceView === "ledger"}
                title="Evidence ledger"
                onClick={() => setWorkspaceView("ledger")}
              >
                <LayoutList size={16} aria-hidden="true" />
                <span className="viewModeLabel">Ledger</span>
              </button>
              <button
                className={workspaceView === "workshop" ? "viewModeButton is-active" : "viewModeButton"}
                type="button"
                aria-pressed={workspaceView === "workshop"}
                title="Operational workshop"
                onClick={() => setWorkspaceView("workshop")}
              >
                <Map size={16} aria-hidden="true" />
                <span className="viewModeLabel">Workshop</span>
              </button>
            </div>
            <ThemeSwitcher value={theme} onChange={setAtmosphere} />
            <div className="demoBadge" title="All runs, costs, and receipts shown are example data">
              <Sparkles size={14} aria-hidden="true" />
              <span>Interactive prototype</span>
            </div>
            <div className="routeMode" aria-label="Routing policy for new work">
              <span className="routeModeLabel">Route</span>
              {routeModes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={routeMode === mode ? "is-selected" : ""}
                  aria-label={`Use ${mode} routing for new work`}
                  aria-pressed={routeMode === mode}
                  title={`${mode} routing`}
                  onClick={() => setMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              className="trustToggle"
              type="button"
              ref={trustTriggerRef}
              aria-expanded={trustOpen}
              aria-controls="trust-dock"
              onClick={() => setTrustOpen(true)}
            >
              <PanelRightOpen size={17} aria-hidden="true" />
              Trust & approvals
              <span>2</span>
            </button>
          </div>
        </header>

        <div className="workspaceGrid">
          <button
            className={"panelBackdrop missionBackdrop" + (missionsOpen ? " is-open" : "")}
            type="button"
            tabIndex={-1}
            aria-label="Close missions"
            onClick={() => {
              missionFocusAfterCloseRef.current = "trigger";
              setMissionsOpen(false);
            }}
          />

          <aside
            className={"missionsPane" + (missionsOpen ? " is-open" : "")}
            id="missions-panel"
            aria-label="Missions"
            ref={missionPanelRef}
            role={missionDrawerOpen ? "dialog" : "region"}
            aria-modal={missionDrawerOpen ? true : undefined}
            aria-hidden={compactMissions && !missionsOpen ? true : undefined}
            inert={
              (compactMissions && !missionsOpen) || trustDrawerOpen ? true : undefined
            }
            tabIndex={missionDrawerOpen ? -1 : undefined}
          >
            <div className="paneHeader">
              <div>
                <p className="eyebrow">Outcomes</p>
                <h2>Missions</h2>
              </div>
              <button
                className="iconButton missionClose"
                type="button"
                ref={missionCloseRef}
                aria-label="Close missions"
                onClick={() => {
                  missionFocusAfterCloseRef.current = "trigger";
                  setMissionsOpen(false);
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
              <button
                className="iconButton"
                type="button"
                aria-label="Filter missions"
                onClick={() => setToast("Mission filters will include risk, locality, and missing evidence.")}
              >
                <ListFilter size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="missionSummary">
              <button className="summaryCard attentionSummary" type="button">
                <span>Needs you</span>
                <strong>2</strong>
              </button>
              <button className="summaryCard" type="button">
                <span>Active</span>
                <strong>3</strong>
              </button>
              <button className="summaryCard" type="button">
                <span>Queued</span>
                <strong>1</strong>
              </button>
            </div>

            <section className="mobileControlPanel" aria-label="Mobile workspace controls">
              <div>
                <p className="mobileControlLabel">Atmosphere</p>
                <ThemeSwitcher value={theme} onChange={setAtmosphere} />
              </div>
              <div>
                <p className="mobileControlLabel">Routing for new work</p>
                <div className="mobileRouteMode" role="group" aria-label="Routing policy for new work">
                  {routeModes.map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={routeMode === mode ? "is-selected" : ""}
                      aria-pressed={routeMode === mode}
                      onClick={() => setMode(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <label className="missionSearch">
              <Search size={16} aria-hidden="true" />
              <span className="srOnly">Search missions</span>
              <input type="search" placeholder="Search missions" />
              <kbd>⌘ K</kbd>
            </label>

            <div className="missionList">
              {missions.map((mission) => {
                const derivedStatus = stoppedIds.has(mission.id)
                  ? "Stopped"
                  : approvedIds.has(mission.id)
                    ? "Approved"
                    : attemptStoppedIds.has(mission.id)
                      ? "Ready to reroute"
                      : pausedIds.has(mission.id)
                        ? "Paused"
                        : mission.status;
                return (
                  <button
                    className={"missionCard" + (mission.id === selected.id ? " is-selected" : "")}
                    key={mission.id}
                    type="button"
                    aria-pressed={mission.id === selected.id}
                    aria-label={mission.id + ": " + mission.title + ", " + derivedStatus}
                    onClick={() => chooseMission(mission.id)}
                  >
                    <span className="missionCardTop">
                      <span className="missionId">{mission.id}</span>
                      <StatusPill tone={statusTone(derivedStatus, mission.tone)}>
                        {derivedStatus}
                      </StatusPill>
                    </span>
                    <strong className="missionTitle">{mission.title}</strong>
                    <span className="missionRepo">{mission.repo}</span>
                    <span className="missionModel">
                      <PlacementIcon kind={mission.placementKind} />
                      <span>{mission.workerShort}</span>
                      <small>{mission.placementKind}</small>
                    </span>
                    <span
                      className="missionProgress"
                      role="progressbar"
                      aria-label={mission.title + " progress"}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={mission.progress}
                    >
                      <span style={{ width: mission.progress + "%" }} />
                    </span>
                    <span className="missionFooter">
                      <span>{mission.risk} risk</span>
                      <span>{mission.cost} / {mission.budget}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              className="newMissionButton"
              type="button"
              onClick={() => setToast("New mission intake will decompose work before routing.")}
            >
              <Zap size={16} aria-hidden="true" />
              Create mission
            </button>
          </aside>

          <main
            className="runLedger"
            id="run-ledger"
            tabIndex={-1}
            inert={modalDrawerOpen ? true : undefined}
          >
            {workspaceView === "workshop" ? (
              <WorkshopView
                missions={missions.map((mission) => ({
                  id: mission.id,
                  title: mission.title,
                  status: stoppedIds.has(mission.id)
                    ? "Stopped"
                    : approvedIds.has(mission.id)
                      ? "Approved"
                      : attemptStoppedIds.has(mission.id)
                        ? "Ready to reroute"
                        : pausedIds.has(mission.id)
                          ? "Paused"
                          : mission.status,
                  risk: mission.risk,
                  stage: approvedIds.has(mission.id)
                    ? Math.min(mission.stage + 1, stages.length - 1)
                    : mission.stage,
                  workerShort: mission.workerShort,
                  placement: mission.placement,
                  placementKind: mission.placementKind,
                  cost: mission.cost,
                  checks: mission.checks,
                }))}
                selectedId={selectedId}
                onSelect={chooseMission}
                onOpenTrust={() => {
                  setReceiptExpanded(true);
                  setTrustOpen(true);
                }}
              />
            ) : (
              <>
            <section className="runHeader" aria-labelledby="run-title">
              <div className="runHeaderTop">
                <div>
                  <div className="runBreadcrumb">
                    <span>{selected.id}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                    <span>{stages[Math.min(selected.stage, stages.length - 1)]}</span>
                  </div>
                  <h1 id="run-title" ref={runTitleRef} tabIndex={-1}>{selected.title}</h1>
                  <div className="runMeta">
                    <span><Code2 size={14} aria-hidden="true" />{selected.repo}</span>
                    <span><GitBranch size={14} aria-hidden="true" />{selected.branch}</span>
                    <span><Clock3 size={14} aria-hidden="true" />{selected.elapsed}</span>
                  </div>
                </div>

                <div className="runControls">
                  <StatusPill tone={statusTone(selectedStatus, selected.tone)}>
                    {selectedStatus}
                  </StatusPill>
                  <button
                    className="secondaryButton"
                    type="button"
                    disabled={!canPause}
                    onClick={togglePaused}
                  >
                    {isPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
                    {isPaused ? "Resume" : "Pause"}
                  </button>
                  <div className="stopControl" ref={stopControlRef}>
                    <button
                      className="dangerButton"
                      type="button"
                      ref={stopTriggerRef}
                      disabled={!canStop}
                      aria-expanded={stopMenuOpen}
                      aria-haspopup="menu"
                      aria-controls="stop-menu"
                      onClick={() => setStopMenuOpen(!stopMenuOpen)}
                    >
                      <CircleStop size={16} aria-hidden="true" />
                      Stop
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    {stopMenuOpen ? (
                      <div
                        className="stopMenu"
                        role="menu"
                        id="stop-menu"
                        aria-label="Stop scope"
                        tabIndex={-1}
                        onKeyDown={navigateStopMenu}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          ref={(element) => {
                            stopItemRefs.current[0] = element;
                          }}
                          onClick={() => stopRun("attempt")}
                        >
                          <strong>Stop this attempt</strong>
                          <span>Keep the mission ready to reroute</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          ref={(element) => {
                            stopItemRefs.current[1] = element;
                          }}
                          onClick={() => stopRun("mission")}
                        >
                          <strong>Stop entire mission</strong>
                          <span>Cancel children and revoke credentials</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <ol className="stageStepper" aria-label="Mission stages">
                {stages.map((stage, index) => {
                  const effectiveStage = isApproved
                    ? Math.min(selected.stage + 1, stages.length - 1)
                    : selected.stage;
                  const complete = index < effectiveStage;
                  const atEffectiveStage = index === effectiveStage;
                  const blockedAtStage = atEffectiveStage && routeBlocked;
                  const pendingAtStage =
                    atEffectiveStage && (routePending || isAttemptStopped || isApproved);
                  const stoppedAtStage = atEffectiveStage && isStopped;
                  const current =
                    atEffectiveStage && !blockedAtStage && !pendingAtStage && !stoppedAtStage;
                  const stageState = complete
                    ? "completed"
                    : blockedAtStage
                      ? "blocked"
                      : stoppedAtStage
                        ? "mission stopped at this checkpoint"
                        : pendingAtStage
                          ? isApproved
                            ? "pending integration"
                            : isAttemptStopped
                              ? "attempt stopped; ready to reroute"
                              : "pending"
                          : current
                            ? isPaused
                              ? "paused at this checkpoint"
                              : "current"
                            : "pending";
                  return (
                    <li
                      key={stage}
                      className={(complete ? "is-complete" : "") + (current ? " is-current" : "")}
                      aria-current={current ? "step" : undefined}
                      aria-label={stage + ": " + stageState}
                      style={
                        blockedAtStage || stoppedAtStage
                          ? { color: "var(--color-destructive)" }
                          : pendingAtStage
                            ? { color: "var(--color-muted-strong)" }
                            : undefined
                      }
                    >
                      <span>
                        {complete ? (
                          <Check size={13} aria-hidden="true" />
                        ) : blockedAtStage ? (
                          <AlertTriangle size={13} aria-hidden="true" />
                        ) : stoppedAtStage ? (
                          <X size={13} aria-hidden="true" />
                        ) : pendingAtStage ? (
                          <Clock3 size={13} aria-hidden="true" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <em>{stage}</em>
                    </li>
                  );
                })}
              </ol>

              <button
                className="executionPath"
                type="button"
                ref={executionPathRef}
                onClick={() => {
                  setReceiptExpanded(true);
                  setTrustOpen(true);
                }}
                aria-label="Open the route receipt for this mission"
              >
                <span className="pathLabel">Execution path</span>
                <span className="controllerNode">
                  <Bot size={15} aria-hidden="true" />
                  <small>Controller</small>
                  Codex
                </span>
                <ArrowRight size={15} className="pathArrow" aria-hidden="true" />
                <span className="workerNode">
                  <Cpu size={15} aria-hidden="true" />
                  <small>
                    {routeBlocked ? "Worker status" : routePending ? "Planned worker" : "Actual worker"}
                  </small>
                  {selected.workerShort}
                </span>
                <span className="placementNode">
                  <PlacementIcon kind={selected.placementKind} />
                  {selected.placement}
                </span>
                <span
                  className="pathValidation"
                  style={{
                    color:
                      validationState === "passed"
                        ? "var(--color-success)"
                        : validationState === "blocked"
                          ? "var(--color-destructive)"
                          : "var(--color-warning)",
                  }}
                >
                  {validationState === "passed" ? (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  ) : validationState === "blocked" ? (
                    <AlertTriangle size={15} aria-hidden="true" />
                  ) : (
                    <Clock3 size={15} aria-hidden="true" />
                  )}
                  {selected.checks} gates · {validationState}
                </span>
                <span className="pathCost">{selected.cost}</span>
              </button>
            </section>

            <div className="ledgerTabs" role="tablist" aria-label="Run details">
              {(["timeline", "changes", "evidence"] as LedgerTab[]).map((tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={ledgerTab === tab}
                  aria-controls={"panel-" + tab}
                  id={"tab-" + tab}
                  tabIndex={ledgerTab === tab ? 0 : -1}
                  key={tab}
                  className={ledgerTab === tab ? "is-selected" : ""}
                  onClick={() => setLedgerTab(tab)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      moveLedgerTab(tab, 1);
                    }
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      moveLedgerTab(tab, -1);
                    }
                    if (event.key === "Home") {
                      event.preventDefault();
                      setLedgerTab("timeline");
                      window.requestAnimationFrame(() =>
                        document.getElementById("tab-timeline")?.focus(),
                      );
                    }
                    if (event.key === "End") {
                      event.preventDefault();
                      setLedgerTab("evidence");
                      window.requestAnimationFrame(() =>
                        document.getElementById("tab-evidence")?.focus(),
                      );
                    }
                  }}
                >
                  {tab === "timeline" ? "Run ledger" : tab === "changes" ? "Changes" : "Evidence"}
                  {tab === "changes" ? <span>{selected.changedFiles}</span> : null}
                  {tab === "evidence" ? <span>{selected.checks}</span> : null}
                </button>
              ))}
            </div>

            <section className="ledgerContent">
              {isStopped ? (
                <div className="runNotice stoppedNotice">
                  <XCircle size={18} aria-hidden="true" />
                  <div>
                    <strong>This demo run is stopped.</strong>
                    <span>Its last verified checkpoint and receipt remain available for audit.</span>
                  </div>
                </div>
              ) : null}

              {isAttemptStopped && !isStopped ? (
                <div
                  className="runNotice"
                  style={{
                    border: "1px solid var(--color-border-strong)",
                    background: "var(--color-surface-muted)",
                    color: "var(--color-muted-strong)",
                  }}
                >
                  <CircleStop size={18} aria-hidden="true" />
                  <div>
                    <strong>The worker attempt was stopped.</strong>
                    <span>The mission and its last verified checkpoint remain ready to reroute.</span>
                  </div>
                </div>
              ) : null}

              {ledgerTab === "timeline" ? (
                <div
                  className="timeline"
                  role="tabpanel"
                  id="panel-timeline"
                  aria-labelledby="tab-timeline"
                  tabIndex={0}
                >
                  <div className="timelineIntro">
                    <div>
                      <p className="eyebrow">Causal history</p>
                      <h2>Why the run is in this state</h2>
                    </div>
                    <button
                      className="textButton"
                      type="button"
                      onClick={() => setToast("Ledger export prepared as signed JSON in this prototype.")}
                    >
                      Export ledger
                    </button>
                  </div>

                  {routeEvents
                    .filter((event) => event.stage <= selected.stage)
                    .map((event, index) => {
                    const Icon = event.icon;
                    return (
                      <article className="timelineEvent" key={event.time + event.title}>
                        <time>{event.time}</time>
                        <div className={"timelineIcon event-" + event.tone}>
                          <Icon size={16} aria-hidden="true" />
                        </div>
                        <div className="timelineBody">
                          <div>
                            <h3>{event.title}</h3>
                            <span className="eventMeta">{event.meta}</span>
                          </div>
                          <p>{event.detail}</p>
                          {index === 1 && !routeBlocked ? (
                            <div className="routeDecision">
                              <div>
                                <small>Rejected candidate</small>
                                <strong>{selectedDetail.rejectedWorker}</strong>
                                <span>{selectedDetail.rejectedReason}</span>
                              </div>
                              <ArrowRight size={16} aria-hidden="true" />
                              <div className="acceptedRoute">
                                <small>Selected and reported</small>
                                <strong>{selected.workerShort}</strong>
                                <span>{selectedDetail.routeReason}</span>
                              </div>
                            </div>
                          ) : null}
                          {event.stage === 3 ? (
                            <div className="checkRow" aria-label="Validation gate status">
                              {["Typecheck", "Unit", "Integration", "Secrets", "Policy", "Review"].map(
                                (check) => {
                                  const passed = checksComplete;
                                  return (
                                    <span
                                      key={check}
                                      aria-label={check + (passed ? ": passed" : ": pending")}
                                      style={
                                        passed
                                          ? undefined
                                          : {
                                              background: "var(--color-surface-muted)",
                                              color: "var(--color-muted-strong)",
                                              border: "1px solid var(--color-border)",
                                            }
                                      }
                                    >
                                      {passed ? (
                                        <Check size={12} aria-hidden="true" />
                                      ) : (
                                        <Clock3 size={12} aria-hidden="true" />
                                      )}
                                      {check}
                                    </span>
                                  );
                                },
                              )}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                    })}
                </div>
              ) : null}

              {ledgerTab === "changes" ? (
                <div
                  className="changesPanel"
                  role="tabpanel"
                  id="panel-changes"
                  aria-labelledby="tab-changes"
                  tabIndex={0}
                >
                  <div className="timelineIntro">
                    <div>
                      <p className="eyebrow">Review compression</p>
                      <h2>{selectedDetail.changesTitle}</h2>
                    </div>
                    <span className="diffStat">{selectedDetail.diff}</span>
                  </div>
                  {selectedDetail.invariants.map((invariant, index) => (
                    <div className="invariantCard" key={invariant.title}>
                      {index === 0 ? (
                        <ShieldCheck size={19} aria-hidden="true" />
                      ) : (
                        <Fingerprint size={19} aria-hidden="true" />
                      )}
                      <div>
                        <strong>{invariant.title}</strong>
                        <p>{invariant.detail}</p>
                      </div>
                      <StatusPill
                        tone={
                          invariant.state === "Covered"
                            ? "success"
                            : invariant.state === "Review"
                              ? "attention"
                              : "queued"
                        }
                      >
                        {invariant.state}
                      </StatusPill>
                    </div>
                  ))}
                  <div className="fileTable" role="table" aria-label="Changed files">
                    {selectedDetail.files.length ? (
                      <div className="fileHeader" role="row">
                        <span aria-hidden="true" />
                        <span role="columnheader">File</span>
                        <span role="columnheader">Added</span>
                        <span role="columnheader">Removed</span>
                        <span role="columnheader">Risk</span>
                      </div>
                    ) : null}
                    {selectedDetail.files.length ? selectedDetail.files.map((file) => (
                      <div className="fileRow" role="row" key={file[0]}>
                        <Code2 size={15} aria-hidden="true" />
                        <span role="cell">{file[0]}</span>
                        <em role="cell">{file[1]}</em>
                        <em role="cell">{file[2]}</em>
                        <small role="cell">{file[3]} risk</small>
                      </div>
                    )) : (
                      <div className="emptyFiles">No patch exists for this mission yet.</div>
                    )}
                  </div>
                </div>
              ) : null}

              {ledgerTab === "evidence" ? (
                <div
                  className="evidencePanel"
                  role="tabpanel"
                  id="panel-evidence"
                  aria-labelledby="tab-evidence"
                  tabIndex={0}
                >
                  <div className="timelineIntro">
                    <div>
                      <p className="eyebrow">Independent proof</p>
                      <h2>Validation before confidence</h2>
                    </div>
                    <StatusPill
                      tone={routeBlocked ? "blocked" : checksComplete ? "success" : "queued"}
                    >
                      {selected.checks} gates
                    </StatusPill>
                  </div>
                  {evidenceRows.map((evidence) => (
                    <div
                      className={"evidenceRow evidence-" + evidence.state}
                      key={evidence.label}
                    >
                      {evidence.state === "passed" ? (
                        <CheckCircle2 size={18} aria-hidden="true" />
                      ) : evidence.state === "blocked" ? (
                        <AlertTriangle size={18} aria-hidden="true" />
                      ) : (
                        <Clock3 size={18} aria-hidden="true" />
                      )}
                      <div>
                        <strong>{evidence.label}</strong>
                        <span>{evidence.kind}</span>
                      </div>
                      <time>{evidence.duration}</time>
                      <button
                        className="textButton"
                        type="button"
                        onClick={() => setToast("Evidence details opened for " + evidence.label + ".")}
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
              </>
            )}
          </main>

          <button
            className={"panelBackdrop trustBackdrop" + (trustOpen ? " is-open" : "")}
            type="button"
            tabIndex={-1}
          aria-label="Close trust dock"
          onClick={() => {
            trustFocusAfterCloseRef.current = "trigger";
            setTrustOpen(false);
          }}
          />

          <aside
            className={"trustPane" + (trustOpen ? " is-open" : "")}
            id="trust-dock"
            aria-label="Trust and approvals"
            ref={trustPanelRef}
            role={trustDrawerOpen ? "dialog" : "region"}
            aria-modal={trustDrawerOpen ? true : undefined}
            aria-hidden={compactTrust && !trustOpen ? true : undefined}
            inert={(compactTrust && !trustOpen) || missionDrawerOpen ? true : undefined}
            tabIndex={trustDrawerOpen ? -1 : undefined}
          >
            <div className="trustHeader">
              <div>
                <p className="eyebrow">Trust dock</p>
                <h2>Proof before approval</h2>
              </div>
              <button
                className="iconButton trustClose"
                type="button"
                ref={trustCloseRef}
                aria-label="Close trust dock"
                onClick={() => {
                  trustFocusAfterCloseRef.current = "trigger";
                  setTrustOpen(false);
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <section className="approvalCard" aria-labelledby="approval-title">
              <div className="cardHeading">
                <div className={"cardIcon " + (isApproved ? "status-success" : "attentionIcon")}>
                  {isApproved ? (
                    <CheckCircle2 size={17} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={17} aria-hidden="true" />
                  )}
                </div>
                <div>
                  <span>
                    {isApproved
                      ? "Decision recorded"
                      : needsApproval
                        ? "Decision 1 of 2"
                        : routeBlocked
                          ? "Action required"
                          : "Run status"}
                  </span>
                  <h3 id="approval-title">
                    {isApproved ? "Approval recorded · integration pending" : selectedDetail.decisionTitle}
                  </h3>
                </div>
                <span className="riskLabel">{selected.risk} risk</span>
              </div>
              <p>
                {isApproved
                  ? "The human decision is recorded. Integrate remains pending because this prototype does not merge or deploy."
                  : selectedDetail.decisionSummary}
              </p>
              <dl className="approvalFacts">
                <div><dt>Scope</dt><dd>{selected.changedFiles} files · {selectedDetail.diff}</dd></div>
                <div>
                  <dt>Evidence</dt>
                  <dd>
                    {selected.checks} gates · {selected.stage >= 3 ? selected.reviewer + " review" : "review not started"}
                  </dd>
                </div>
                <div><dt>Data egress</dt><dd>{selected.placementKind === "cloud" ? "Redacted context only" : "None"}</dd></div>
              </dl>
              <button
                className="reviewLink"
                type="button"
                onClick={() => {
                  setLedgerTab("changes");
                  if (compactTrust) {
                    trustFocusAfterCloseRef.current = "changes";
                  } else {
                    trustFocusAfterCloseRef.current = null;
                    window.requestAnimationFrame(() =>
                      document.getElementById("tab-changes")?.focus(),
                    );
                  }
                  setTrustOpen(false);
                }}
              >
                {selected.changedFiles ? "Review compressed diff" : "Inspect acceptance criteria"}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
              <div className="approvalActions">
                <button
                  className="secondaryButton"
                  type="button"
                  disabled={!needsApproval || isApproved || isStopped}
                  onClick={requestChanges}
                >
                  Request changes
                </button>
                <button
                  className="primaryButton"
                  type="button"
                  disabled={!canApprove}
                  onClick={approveRun}
                >
                  <Check size={16} aria-hidden="true" />
                  {isApproved ? "Approved" : canApprove ? "Approve" : "Not ready"}
                </button>
              </div>
            </section>

            <section className="receiptCard">
              <button
                className="receiptHeading"
                type="button"
                aria-expanded={receiptExpanded}
                onClick={() => setReceiptExpanded(!receiptExpanded)}
              >
                <span className="cardIcon routeIcon">
                  <ReceiptText size={17} aria-hidden="true" />
                </span>
                <span className="receiptTitleBlock">
                  <span>
                    {routeBlocked
                      ? "Blocked route receipt"
                      : routePending
                        ? "Planned route receipt"
                        : routeIsActive
                          ? "Active route receipt"
                          : "Recorded route receipt"}
                  </span>
                  <strong>{selected.workerShort}</strong>
                </span>
                <ChevronDown
                  size={17}
                  className={receiptExpanded ? "is-rotated" : ""}
                  aria-hidden="true"
                />
              </button>

              <div className="receiptCompact">
                <span><PlacementIcon kind={selected.placementKind} />{selected.placementKind}</span>
                <span
                  className={routeBlocked ? "receiptStateBlocked" : ""}
                  style={
                    routePending
                      ? {
                          borderColor: "var(--color-border-strong)",
                          background: "var(--color-surface-muted)",
                          color: "var(--color-muted-strong)",
                        }
                      : undefined
                  }
                >
                  {routeBlocked ? (
                    <AlertTriangle size={13} aria-hidden="true" />
                  ) : routePending ? (
                    <Clock3 size={13} aria-hidden="true" />
                  ) : (
                    <CheckCircle2 size={13} aria-hidden="true" />
                  )}
                  {routeBlocked ? "blocked" : routePending ? "planned" : "verified"}
                </span>
                <span>{selected.cost}</span>
              </div>

              {receiptExpanded ? (
                <div className="receiptDetails">
                  <dl>
                    <div><dt>Controller</dt><dd>Codex <small>unchanged</small></dd></div>
                    <div><dt>Requested worker</dt><dd>{selected.worker}</dd></div>
                    <div>
                      <dt>Actual worker</dt>
                      <dd>
                        {routeBlocked ? "None" : routePending ? "Pending" : selected.worker}
                        {routeVerified ? <Check size={12} aria-label="Provider reported" /> : null}
                      </dd>
                    </div>
                    <div><dt>Runtime</dt><dd>{selected.placement}</dd></div>
                    <div><dt>Route reason</dt><dd>{selectedDetail.routeReason}</dd></div>
                    <div><dt>Data left device</dt><dd>{selected.placementKind === "cloud" ? "Yes · redacted" : "No"}</dd></div>
                    <div><dt>Attempts</dt><dd>{routeVerified ? "1 selected · 1 rejected before call" : "0 provider calls"}</dd></div>
                    <div><dt>Latency</dt><dd>{selected.elapsed === "—" ? "Not started" : selected.elapsed + " elapsed"}</dd></div>
                    <div><dt>Cost</dt><dd>{selected.cost} <small>{routeVerified ? "example estimate" : "no call"}</small></dd></div>
                    <div>
                      <dt>Policy snapshot</dt>
                      <dd>{selected.routePolicy} · {selected.routeMode.toLowerCase()}</dd>
                    </div>
                  </dl>
                  <div className="fingerprintBlock">
                    <Fingerprint size={14} aria-hidden="true" />
                    <div>
                      <span>Example trace · {selectedDetail.trace}</span>
                      <code>
                        {selected.changedFiles
                          ? "ctx 91fa…02c4 · patch 8b2d…1a07"
                          : "ctx 91fa…02c4 · no patch"}
                      </code>
                    </div>
                  </div>
                  <button
                    className="textButton receiptExport"
                    type="button"
                    onClick={() => setToast("Example receipt exported as JSON.")}
                  >
                    Export example receipt
                  </button>
                </div>
              ) : null}
            </section>

            <section className="budgetCard">
              <div className="cardHeading compactHeading">
                <div className="cardIcon budgetIcon">
                  <CircleDollarSign size={17} aria-hidden="true" />
                </div>
                <div>
                  <span>Workspace budget</span>
                  <h3>$4.82 of $20 today</h3>
                </div>
                <strong>24%</strong>
              </div>
              <div
                className="budgetBar"
                role="progressbar"
                aria-label="Daily workspace budget used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={24}
              >
                <span />
              </div>
              <div className="budgetMeta">
                <span>31 work units</span>
                <span>$8.46 estimated savings</span>
              </div>
            </section>

            <section className="fleetCard">
              <div className="cardHeading compactHeading">
                <div className="cardIcon fleetIcon">
                  <Gauge size={17} aria-hidden="true" />
                </div>
                <div>
                  <span>Certified fleet</span>
                  <h3>4 models ready</h3>
                </div>
                <span className="healthyLabel">Healthy</span>
              </div>
              <div className="fleetRows">
                <div><span><HardDrive size={14} aria-hidden="true" />Local</span><strong>2 ready</strong></div>
                <div><span><Cpu size={14} aria-hidden="true" />Private GPU</span><strong>1 ready</strong></div>
                <div><span><Cloud size={14} aria-hidden="true" />Cloud burst</span><strong>1 ready</strong></div>
              </div>
            </section>

            <p className="prototypeNote">
              Simulated product data. A production receipt appears only after a provider reports the
              worker model and external validation completes.
            </p>
          </aside>
        </div>
      </div>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 size={16} aria-hidden="true" />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
