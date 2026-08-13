export type MissionTone = "attention" | "active" | "success" | "blocked" | "queued";

export type Mission = {
  id: string;
  title: string;
  repo: string;
  branch: string;
  status: string;
  tone: MissionTone;
  risk: "Low" | "Medium" | "High";
  stage: number;
  worker: string;
  placement: string;
  cost: string;
  elapsed: string;
  checks: string;
  changedFiles: number;
  routeReason: string;
  events: Array<{
    title: string;
    detail: string;
    time: string;
    state: "complete" | "current" | "pending" | "blocked";
  }>;
  files: Array<{ path: string; change: string; risk: "Low" | "Medium" | "High" }>;
};

export const stages = ["Plan", "Route", "Build", "Validate", "Approve", "Ship"] as const;

export const missions: Mission[] = [
  {
    id: "AOS-184",
    title: "Harden refresh-token rotation",
    repo: "relay/api",
    branch: "aos/refresh-token-rotation",
    status: "Approval required",
    tone: "attention",
    risk: "High",
    stage: 4,
    worker: "Qwen3 Coder Next",
    placement: "Private GPU · vLLM",
    cost: "$0.38",
    elapsed: "11m 42s",
    checks: "6/6",
    changedFiles: 4,
    routeReason: "Cheapest certified worker above the authentication-risk threshold.",
    events: [
      {
        title: "Scope and invariants recorded",
        detail: "Single-use refresh and concurrent rotation were made explicit acceptance criteria.",
        time: "11m ago",
        state: "complete",
      },
      {
        title: "Private coding route selected",
        detail: "Restricted source stayed inside the configured private inference boundary.",
        time: "10m ago",
        state: "complete",
      },
      {
        title: "Patch returned from isolated workspace",
        detail: "Four files changed. The worker could not alter the control-plane receipt.",
        time: "5m ago",
        state: "complete",
      },
      {
        title: "Independent gates passed",
        detail: "Six deterministic checks passed, including concurrent refresh behavior.",
        time: "2m ago",
        state: "complete",
      },
      {
        title: "Human decision required",
        detail: "Authentication semantics changed. Review the evidence packet before integration.",
        time: "now",
        state: "current",
      },
    ],
    files: [
      { path: "src/auth/refresh.ts", change: "+54 −18", risk: "High" },
      { path: "src/auth/token-store.ts", change: "+31 −12", risk: "High" },
      { path: "tests/auth/rotation.test.ts", change: "+39 −8", risk: "Medium" },
      { path: "docs/security-model.md", change: "+4 −3", risk: "Low" },
    ],
  },
  {
    id: "AOS-191",
    title: "Write the v2 migration guide",
    repo: "relay/docs",
    branch: "aos/v2-migration-guide",
    status: "Running",
    tone: "active",
    risk: "Low",
    stage: 2,
    worker: "gpt-oss 20B",
    placement: "This Mac · llama.cpp",
    cost: "$0.00",
    elapsed: "02m 18s",
    checks: "2/4",
    changedFiles: 2,
    routeReason: "A local low-cost worker passed the documentation capability floor.",
    events: [
      {
        title: "Reader outcomes planned",
        detail: "Every breaking v2 change needs a concrete migration step.",
        time: "2m ago",
        state: "complete",
      },
      {
        title: "Local route selected",
        detail: "No hosted provider is needed for this low-risk documentation unit.",
        time: "2m ago",
        state: "complete",
      },
      {
        title: "Drafting migration steps",
        detail: "Examples are being checked against the declared v2 surface.",
        time: "now",
        state: "current",
      },
      {
        title: "Link and example validation",
        detail: "Waiting for the bounded draft to complete.",
        time: "pending",
        state: "pending",
      },
    ],
    files: [
      { path: "docs/migration-v2.md", change: "+82 −0", risk: "Medium" },
      { path: "docs/index.md", change: "+4 −1", risk: "Low" },
    ],
  },
  {
    id: "AOS-176",
    title: "Stop duplicate job dispatch",
    repo: "relay/orchestrator",
    branch: "aos/idempotent-dispatch",
    status: "Validating",
    tone: "active",
    risk: "High",
    stage: 3,
    worker: "DeepSeek V4 Flash",
    placement: "EU cloud · SGLang",
    cost: "$1.72",
    elapsed: "18m 06s",
    checks: "11/12",
    changedFiles: 7,
    routeReason: "Cloud escalation followed one local capability miss and stayed in the approved region.",
    events: [
      {
        title: "Duplicate side effect modeled",
        detail: "Lease expiry and redispatch now share an idempotency boundary.",
        time: "18m ago",
        state: "complete",
      },
      {
        title: "Regional route selected",
        detail: "The local worker missed the concurrency certification threshold.",
        time: "16m ago",
        state: "complete",
      },
      {
        title: "Fencing-token patch returned",
        detail: "Seven files changed in an isolated worktree.",
        time: "7m ago",
        state: "complete",
      },
      {
        title: "Soak validation running",
        detail: "11 of 12 gates passed; duplicate-dispatch soak remains.",
        time: "now",
        state: "current",
      },
    ],
    files: [
      { path: "src/dispatch/lease.ts", change: "+61 −25", risk: "High" },
      { path: "src/dispatch/idempotency.ts", change: "+72 −4", risk: "High" },
      { path: "tests/dispatch/soak.test.ts", change: "+118 −0", risk: "Medium" },
    ],
  },
  {
    id: "AOS-167",
    title: "Index architecture decisions",
    repo: "relay/platform",
    branch: "aos/adr-index",
    status: "Queued",
    tone: "queued",
    risk: "Low",
    stage: 0,
    worker: "Devstral Small 2",
    placement: "This Mac · llama.cpp",
    cost: "$0.00",
    elapsed: "—",
    checks: "0/3",
    changedFiles: 0,
    routeReason: "Planned local route; no provider call has been made.",
    events: [
      {
        title: "Index scope ready",
        detail: "The mission is waiting for a local executor lease.",
        time: "queued",
        state: "current",
      },
    ],
    files: [],
  },
  {
    id: "AOS-159",
    title: "Upgrade dependency policy",
    repo: "relay/web",
    branch: "aos/dependency-policy",
    status: "Policy blocked",
    tone: "blocked",
    risk: "Medium",
    stage: 1,
    worker: "No eligible worker",
    placement: "Restricted data",
    cost: "$0.00",
    elapsed: "00m 08s",
    checks: "0/5",
    changedFiles: 0,
    routeReason: "Every configured external route violates the workspace locality policy.",
    events: [
      {
        title: "Restricted data detected",
        detail: "The work unit inherited local-only placement from workspace policy.",
        time: "8s ago",
        state: "complete",
      },
      {
        title: "No eligible worker",
        detail: "No provider call was made. Connect a certified local worker or change policy.",
        time: "now",
        state: "blocked",
      },
    ],
    files: [],
  },
];
