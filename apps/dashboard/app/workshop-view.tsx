"use client";

import {
  ArrowRight,
  CircleAlert,
  CircleDollarSign,
  Cloud,
  Code2,
  Cpu,
  GitBranch,
  HardDrive,
  Layers3,
  Network,
  ReceiptText,
  ShieldCheck,
  TestTube2,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkshopMission = {
  id: string;
  title: string;
  status: string;
  risk: string;
  stage: number;
  workerShort: string;
  placement: string;
  placementKind: "local" | "private" | "cloud";
  cost: string;
  checks: string;
};

export type WorkshopViewProps = {
  missions: WorkshopMission[];
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenTrust: () => void;
};

type WorkshopStage = {
  name: "Plan" | "Route" | "Build" | "Validate" | "Approve" | "Ship";
  description: string;
  icon: LucideIcon;
};

const workshopStages: WorkshopStage[] = [
  { name: "Plan", description: "Scope and policy", icon: Layers3 },
  { name: "Route", description: "Choose a verified worker", icon: Network },
  { name: "Build", description: "Work in isolation", icon: Code2 },
  { name: "Validate", description: "Run independent gates", icon: TestTube2 },
  { name: "Approve", description: "Ask for judgment", icon: UserCheck },
  { name: "Ship", description: "Integrate with evidence", icon: GitBranch },
];

const placementIcons: Record<WorkshopMission["placementKind"], LucideIcon> = {
  local: HardDrive,
  private: Cpu,
  cloud: Cloud,
};

function stageFor(mission: WorkshopMission) {
  if (!Number.isFinite(mission.stage)) return 0;
  return Math.min(workshopStages.length - 1, Math.max(0, Math.trunc(mission.stage)));
}

function needsHuman(mission: WorkshopMission) {
  const status = mission.status.toLocaleLowerCase();
  return (
    stageFor(mission) === 4 ||
    status.includes("approval") ||
    status.includes("attention") ||
    status.includes("waiting on you")
  );
}

function statusClass(status: string) {
  const normalized = status.toLocaleLowerCase();
  if (normalized.includes("blocked") || normalized.includes("stopped")) {
    return "workshopStatusBlocked";
  }
  if (normalized.includes("approval") || normalized.includes("attention")) {
    return "workshopStatusAttention";
  }
  if (
    normalized.includes("running") ||
    normalized.includes("validating") ||
    normalized.includes("active")
  ) {
    return "workshopStatusActive";
  }
  if (
    normalized.includes("approved") ||
    normalized.includes("shipped") ||
    normalized.includes("complete")
  ) {
    return "workshopStatusComplete";
  }
  return "workshopStatusNeutral";
}

function riskClass(risk: string) {
  const normalized = risk.toLocaleLowerCase();
  if (normalized.includes("high") || normalized.includes("critical")) {
    return "workshopRiskHigh";
  }
  if (normalized.includes("medium")) return "workshopRiskMedium";
  return "workshopRiskLow";
}

function PlacementMark({ kind }: { kind: WorkshopMission["placementKind"] }) {
  const Icon = placementIcons[kind];
  return <Icon size={14} strokeWidth={1.8} aria-hidden="true" />;
}

export function WorkshopView({
  missions,
  selectedId,
  onSelect,
  onOpenTrust,
}: WorkshopViewProps) {
  const selected = missions.find((mission) => mission.id === selectedId) ?? missions[0];
  const humanAttentionCount = missions.filter(needsHuman).length;

  return (
    <section className="workshopShell" aria-labelledby="workshop-title">
      <header className="workshopHeader">
        <div className="workshopHeadingGroup">
          <div className="workshopEyebrowRow">
            <span className="workshopFloorLabel">Operational workshop · Floor 01</span>
            <span className="workshopDemoBadge">Demo data</span>
          </div>
          <h2 className="workshopTitle" id="workshop-title">
            See work move, not agents perform
          </h2>
          <p className="workshopSubtitle">
            Every pod is one bounded mission moving through routing, proof, and human
            judgment.
          </p>
        </div>

        <div className="workshopHeaderActions">
          <span className="workshopOccupancy" aria-label={`${missions.length} mission pods occupied`}>
            <span className="workshopOccupancyMark" aria-hidden="true" />
            {missions.length} occupied
          </span>
          <button className="workshopTrustButton" type="button" onClick={onOpenTrust}>
            <ShieldCheck size={17} strokeWidth={1.8} aria-hidden="true" />
            Trust map
            {humanAttentionCount > 0 ? (
              <span className="workshopAttentionCount" aria-label={`${humanAttentionCount} need human attention`}>
                {humanAttentionCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <div className="workshopFlow" aria-label="Mission flow">
        {workshopStages.map((stage, index) => (
          <div className="workshopFlowStep" key={stage.name}>
            <span className="workshopFlowNumber">{String(index + 1).padStart(2, "0")}</span>
            <span>{stage.name}</span>
            {index < workshopStages.length - 1 ? (
              <ArrowRight className="workshopFlowArrow" size={14} aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>

      <ol className="workshopFloor" aria-label="Operational workshop rooms">
        {workshopStages.map((stage, stageIndex) => {
          const StageIcon = stage.icon;
          const occupants = missions.filter((mission) => stageFor(mission) === stageIndex);
          const roomAttention = occupants.some(needsHuman);

          return (
            <li
              className={`workshopRoom workshopStage${stageIndex}${
                roomAttention ? " workshopRoomAttention" : ""
              }`}
              key={stage.name}
              data-workshop-stage={stage.name.toLocaleLowerCase()}
            >
              <div className="workshopRoomHeader">
                <span className="workshopRoomIcon">
                  <StageIcon size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="workshopRoomNameGroup">
                  <strong>{stage.name}</strong>
                  <small>{stage.description}</small>
                </span>
                <span className="workshopRoomCount" aria-label={`${occupants.length} missions`}>
                  {occupants.length}
                </span>
              </div>

              <div className="workshopRoomFurniture" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>

              <div className="workshopPods">
                {occupants.length === 0 ? (
                  <span className="workshopVacantPod">Open pod</span>
                ) : (
                  occupants.map((mission) => {
                    const isSelected = mission.id === selectedId;
                    const missionNeedsHuman = needsHuman(mission);

                    return (
                      <button
                        className={`workshopPod ${statusClass(mission.status)} ${riskClass(
                          mission.risk,
                        )}${isSelected ? " workshopPodSelected" : ""}`}
                        type="button"
                        key={mission.id}
                        aria-pressed={isSelected}
                        aria-label={`${mission.id}: ${mission.title}. ${mission.status}. ${mission.risk} risk. ${mission.workerShort} on ${mission.placement}.`}
                        onClick={() => onSelect(mission.id)}
                      >
                        <span className="workshopPodTopline">
                          <span className="workshopMissionId">{mission.id}</span>
                          {missionNeedsHuman ? (
                            <span className="workshopHumanCue" title="Human judgment needed">
                              <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
                              <span className="workshopVisuallyHidden">Human judgment needed</span>
                            </span>
                          ) : (
                            <span className="workshopStatusDot" aria-hidden="true" />
                          )}
                        </span>
                        <strong className="workshopMissionTitle">{mission.title}</strong>
                        <span className={`workshopPlacement workshopPlacement${mission.placementKind}`}>
                          <PlacementMark kind={mission.placementKind} />
                          <span>{mission.workerShort}</span>
                        </span>
                        <span className="workshopPodStatus">{mission.status}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="workshopFooter">
        <div className="workshopLegend" aria-label="Workshop legend">
          <span className="workshopLegendTitle">Legend</span>
          <span className="workshopLegendItem">
            <HardDrive size={13} aria-hidden="true" /> Local
          </span>
          <span className="workshopLegendItem">
            <Cpu size={13} aria-hidden="true" /> Private GPU
          </span>
          <span className="workshopLegendItem">
            <Cloud size={13} aria-hidden="true" /> Cloud
          </span>
          <span className="workshopLegendItem workshopLegendAttention">
            <CircleAlert size={13} aria-hidden="true" /> Human judgment
          </span>
        </div>

        {selected ? (
          <aside
            className="workshopInspector"
            aria-label={`Selected demo mission: ${selected.title}`}
            aria-live="polite"
          >
            <div className="workshopInspectorLead">
              <span className="workshopInspectorLabel">Selected pod · demo</span>
              <strong>{selected.title}</strong>
              <span>{selected.id} · {selected.status}</span>
            </div>
            <dl className="workshopInspectorMetrics">
              <div>
                <dt>Risk</dt>
                <dd className={riskClass(selected.risk)}>{selected.risk}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{selected.workerShort}</dd>
              </div>
              <div>
                <dt>Placement</dt>
                <dd>
                  <PlacementMark kind={selected.placementKind} />
                  {selected.placement}
                </dd>
              </div>
              <div>
                <dt>Checks</dt>
                <dd>{selected.checks}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  <CircleDollarSign size={14} aria-hidden="true" />
                  {selected.cost}
                </dd>
              </div>
            </dl>
            <button className="workshopInspectorAction" type="button" onClick={onOpenTrust}>
              <ReceiptText size={16} strokeWidth={1.8} aria-hidden="true" />
              Open proof and route receipt
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </aside>
        ) : (
          <div className="workshopEmptyInspector" role="status">
            <Layers3 size={17} aria-hidden="true" />
            No demo missions are loaded.
          </div>
        )}
      </footer>
    </section>
  );
}
