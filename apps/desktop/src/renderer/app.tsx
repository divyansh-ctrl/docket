import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agent, type AgentId, type AgentModel } from "../shared/agent-roster";
import type { AgentTeam, WorkspaceDescriptor } from "../shared/ipc-contract";
import { AgentSettings, SetupTour, type TourStep } from "./agent-settings";
import {
  desktopApi,
  isBrowserPreview,
  readProviderStatuses,
  terminalEvents,
  type ProviderId,
  type ProviderViewStatus,
} from "./bridge";
import {
  CHANNELS,
  EMPTY_ROOM,
  raiseTicket,
  say,
  seedRoom,
  setTicketState,
  type Room,
} from "./room";
import { AgentPanel, ChannelRail, Stream, TicketPanel } from "./team-room";
import { TerminalSurface } from "./terminal-surface";

const providerNames: Record<ProviderId, string> = { codex: "Codex", claude: "Claude Code" };

type ControllerSession = Readonly<{ terminalId: string; provider: ProviderId }>;

export function App() {
  const [booting, setBooting] = useState(true);
  const [providers, setProviders] = useState<Record<ProviderId, ProviderViewStatus> | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [controller, setController] = useState<ProviderId>("codex");
  const [team, setTeam] = useState<AgentTeam | null>(null);
  const [room, setRoom] = useState<Room>(EMPTY_ROOM);
  const [channelId, setChannelId] = useState("floor");
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<AgentId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [session, setSession] = useState<ControllerSession | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const controllerTerminalId = useRef<string | null>(null);

  const members = team?.members ?? [];

  const loadTeam = useCallback(async () => {
    const next = await desktopApi.agents.team();
    setTeam(next);
    return next;
  }, []);

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const [config, detected] = await Promise.all([desktopApi.config.read(), readProviderStatuses()]);
        if (!alive) return;
        setProviders(detected);
        setController(config.selectedProvider);
        setWorkspace(config.workspace);
        setTourOpen(!config.setupComplete);

        if (config.workspace) {
          const next = await loadTeam();
          if (alive && next) setRoom(seedRoom(next, config.workspace.name));
        }
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Docket could not start.");
      } finally {
        if (alive) setBooting(false);
      }
    }
    void boot();
    return () => {
      alive = false;
    };
  }, [loadTeam]);

  useEffect(() => {
    const unsubscribe = terminalEvents.onExit((event) => {
      if (controllerTerminalId.current !== event.terminalId) return;
      controllerTerminalId.current = null;
      setSession(null);
      setToast(
        event.reason === "stopped"
          ? "Session stopped."
          : event.exitCode === 0
            ? "Session finished."
            : `Session exited with code ${event.exitCode}.`,
      );
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openRepository = useCallback(async () => {
    setBusy(true);
    try {
      const chosen = await desktopApi.workspace.choose();
      if (!chosen) return;
      setWorkspace(chosen);
      const next = await loadTeam();
      if (next) {
        setRoom(seedRoom(next, chosen.name));
        setChannelId("roster");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "That folder could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [loadTeam]);

  const setModel = useCallback(
    async (agentId: AgentId, model: AgentModel) => {
      setBusy(true);
      try {
        await desktopApi.agents.setModel(agentId, model);
        // Re-detecting rewrites the charter files, so the change reaches the
        // CLI rather than only the screen.
        const next = await loadTeam();
        setRoom((current) =>
          say(
            current,
            "roster",
            "room",
            `${agent(agentId).name} now runs on ${model}. Rewrote its charter file.`,
            { kind: "note" },
          ),
        );
        if (!next) setToast("Model saved.");
      } catch (error) {
        setToast(error instanceof Error ? error.message : "That model could not be set.");
      } finally {
        setBusy(false);
      }
    },
    [loadTeam],
  );

  const startSession = useCallback(async () => {
    if (!workspace) return;
    setBusy(true);
    try {
      const started = await desktopApi.sessions.start({ provider: controller, workspaceId: workspace.id });
      controllerTerminalId.current = started.terminalId;
      setSession({ terminalId: started.terminalId, provider: started.provider });
      setTerminalOpen(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The session could not start.");
    } finally {
      setBusy(false);
    }
  }, [controller, workspace]);

  const send = useCallback(
    (body: string) => {
      setRoom((current) => {
        const next = say(current, channelId, "you", body);
        // A message that names an agent and a problem is a ticket. Making that
        // explicit is the point of the room: work that is stuck should be
        // visible as an object, not buried in scrollback.
        if (channelId === "tickets") {
          const owner = next.messages[next.messages.length - 1].mentions[0] ?? null;
          return raiseTicket(next, {
            title: body,
            body: "Raised from #tickets.",
            raisedBy: "you",
            owner,
          });
        }
        return next;
      });
      if (session) void desktopApi.terminal.write(session.terminalId, `${body}\n`);
    },
    [channelId, session],
  );

  const finishTour = useCallback(
    async (skipped: boolean) => {
      setTourOpen(false);
      try {
        await desktopApi.setup.complete();
      } catch {
        // Failing to record the dismissal must not re-trap the user in the
        // tour; it is reopened from the header if they want it.
      }
      if (skipped) setToast("Setup skipped. Everything is in the header when you want it.");
    },
    [],
  );

  const steps: readonly TourStep[] = useMemo(() => {
    const ready = providers ? providers[controller] : null;
    return [
      {
        title: "Open a repository",
        body: "Docket reads it to work out which agents it needs, then writes their charters into it.",
        done: workspace !== null,
        action: { label: "Choose a folder", run: () => void openRepository() },
      },
      {
        title: `Have ${providerNames[controller]} installed`,
        body: ready?.available
          ? `Found ${providerNames[controller]}${ready.version ? ` ${ready.version}` : ""}. Docket runs your existing CLI and never asks for an API key.`
          : `Install ${providerNames[controller]} and sign in with it as you normally would. Docket drives that CLI rather than replacing it.`,
        done: Boolean(ready?.available),
      },
      {
        title: "Check the team",
        body:
          members.length > 0
            ? `${members.length} agents were selected for this repository. Each one names the file that put it there.`
            : "Once a repository is open, the team appears here with the reason each agent was chosen.",
        done: members.length > 0,
        action: { label: "Open Agents", run: () => setSettingsOpen(true) },
      },
    ];
  }, [controller, members.length, openRepository, providers, workspace]);

  const channel = CHANNELS.find((entry) => entry.id === channelId) ?? CHANNELS[0];

  if (booting) {
    return (
      <div className="boot">
        <p>Docket</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="appBar">
        <p className="wordmark">
          <span className="wordmarkMark" aria-hidden="true" />
          Docket
        </p>

        <button type="button" className="repoButton" onClick={() => void openRepository()} disabled={busy}>
          {workspace ? workspace.name : "Open a repository"}
        </button>

        <div className="appBarRight">
          {isBrowserPreview ? <span className="previewBadge">Browser preview</span> : null}
          {workspace ? (
            <button type="button" className="buttonQuiet" onClick={() => void startSession()} disabled={busy || session !== null}>
              {session ? `${providerNames[session.provider]} running` : `Run ${providerNames[controller]}`}
            </button>
          ) : null}
          <button type="button" className="buttonQuiet" onClick={() => setTourOpen(true)}>
            Setup
          </button>
          <button type="button" className="buttonSolid" onClick={() => setSettingsOpen(true)}>
            Agents
          </button>
        </div>
      </header>

      <main className="body">
        <ChannelRail
          channels={CHANNELS}
          activeId={channelId}
          room={room}
          members={members}
          onSelect={(id) => {
            setChannelId(id);
            setOpenAgent(null);
          }}
          onOpenAgent={(id) => {
            setOpenAgent(id);
            setTicketId(null);
          }}
        />

        <Stream
          channel={channel}
          room={room}
          members={members}
          disabled={!workspace}
          onSend={send}
          onOpenTicket={(id) => {
            setTicketId(id);
            setOpenAgent(null);
          }}
        />

        {openAgent ? (
          <AgentPanel agentId={openAgent} members={members} onClose={() => setOpenAgent(null)} />
        ) : (
          <TicketPanel
            tickets={room.tickets}
            selectedId={ticketId}
            onSelect={setTicketId}
            onResolve={(id) => {
              setRoom((current) => setTicketState(current, id, "resolved"));
            }}
          />
        )}
      </main>

      {session && terminalOpen ? (
        <section className="terminalDrawer" aria-label="Session output">
          <header>
            <h2>{providerNames[session.provider]}</h2>
            <button type="button" className="buttonQuiet" onClick={() => setTerminalOpen(false)}>
              Hide
            </button>
          </header>
          <TerminalSurface
            terminalId={session.terminalId}
            provider={session.provider}
            command={providerNames[session.provider]}
            purpose="session"
            interactive
            onError={setToast}
          />
        </section>
      ) : null}

      {settingsOpen ? (
        <AgentSettings
          members={members}
          busy={busy}
          onSetModel={(id, model) => void setModel(id, model)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {tourOpen ? (
        <SetupTour steps={steps} onSkip={() => void finishTour(true)} onFinish={() => void finishTour(false)} />
      ) : null}

      {toast ? (
        <p className="toast" role="status">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
