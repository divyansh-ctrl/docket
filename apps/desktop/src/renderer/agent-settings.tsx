import { useState } from "react";
import {
  AGENT_MODELS,
  AGENT_MODEL_LABELS,
  agent,
  type AgentId,
  type AgentModel,
} from "../shared/agent-roster";
import type { AgentTeamMember } from "../shared/ipc-contract";
import { Avatar } from "./team-room";

/**
 * The only place in Docket where a model is chosen.
 *
 * Model pickers used to sit next to every agent in the main view, which meant
 * the same decision could be made from several places and none of them showed
 * the others. Here the whole team is visible at once, which is the only way to
 * see the thing that actually matters: what the team costs and where the
 * judgment is concentrated.
 */
export function AgentSettings({
  members,
  onSetModel,
  onClose,
  busy,
}: {
  members: readonly AgentTeamMember[];
  onSetModel: (agentId: AgentId, model: AgentModel) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<AgentId | null>(null);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Agents">
      <div className="sheetInner">
        <header className="sheetHead">
          <div>
            <h2>Agents</h2>
            <p>
              One model per agent, set here and nowhere else. Each agent writes its choice into its
              own charter file, which is what the CLI reads.
            </p>
          </div>
          <button type="button" className="buttonQuiet" onClick={onClose}>
            Done
          </button>
        </header>

        {members.length === 0 ? (
          <p className="panelEmpty">Open a repository and Docket will pick the team for it.</p>
        ) : (
          <ul className="settingsList">
            {members.map((member) => {
              const definition = agent(member.id);
              const isOpen = expanded === member.id;
              return (
                <li key={member.id} className="settingsRow">
                  <Avatar speaker={member.id} />
                  <div className="settingsMain">
                    <p className="settingsName">
                      {definition.name}
                      <span className="settingsHandle">@{definition.handle}</span>
                    </p>
                    <p className="settingsRole">{definition.role}</p>
                    <button
                      type="button"
                      className="settingsWhy"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : member.id)}
                    >
                      {member.reason}
                    </button>
                    {isOpen ? (
                      <div className="settingsDetail">
                        {member.evidence.length > 0 ? (
                          <ul className="evidence">
                            {member.evidence.map((item) => (
                              <li key={item}>
                                <code>{item}</code>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="panelNote">Every repository needs this one.</p>
                        )}
                        <p className="panelNote">Tools: {definition.tools.join(", ")}</p>
                      </div>
                    ) : null}
                  </div>

                  <label className="settingsModel">
                    <span className="srOnly">Model for {definition.name}</span>
                    <select
                      value={member.model}
                      disabled={busy}
                      onChange={(event) => onSetModel(member.id, event.target.value as AgentModel)}
                    >
                      {AGENT_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {AGENT_MODEL_LABELS[model]}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export type TourStep = Readonly<{
  title: string;
  body: string;
  done: boolean;
  action?: Readonly<{ label: string; run: () => void }>;
}>;

/**
 * The tour is skippable from the first frame and never returns once dismissed.
 * A setup flow that cannot be escaped is the fastest way to lose someone who
 * already knows what they are doing.
 */
export function SetupTour({
  steps,
  onSkip,
  onFinish,
}: {
  steps: readonly TourStep[];
  onSkip: () => void;
  onFinish: () => void;
}) {
  const firstUndone = steps.findIndex((step) => !step.done);
  const complete = firstUndone === -1;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Set up Docket">
      <div className="sheetInner sheetNarrow">
        <header className="sheetHead">
          <div>
            <h2>Three steps</h2>
            <p>Docket runs the CLI you already have. It never asks for an API key.</p>
          </div>
          <button type="button" className="buttonQuiet" onClick={onSkip}>
            Skip
          </button>
        </header>

        <ol className="tourList">
          {steps.map((step, index) => (
            <li key={step.title} className="tourStep" data-state={step.done ? "done" : index === firstUndone ? "current" : "todo"}>
              <span className="tourIndex" aria-hidden="true">
                {step.done ? "✓" : index + 1}
              </span>
              <div className="tourMain">
                <p className="tourTitle">{step.title}</p>
                <p className="tourBody">{step.body}</p>
                {step.action && !step.done ? (
                  <button type="button" className="buttonSolid" onClick={step.action.run}>
                    {step.action.label}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <footer className="tourFoot">
          <button type="button" className="buttonSolid" onClick={onFinish} disabled={!complete}>
            {complete ? "Open the room" : "Finish the steps above"}
          </button>
          <button type="button" className="buttonQuiet" onClick={onSkip}>
            I will do this later
          </button>
        </footer>
      </div>
    </div>
  );
}
