import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Box,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleStop,
  Clock3,
  Cloud,
  Code2,
  Cpu,
  FileCode2,
  FolderGit2,
  GitBranch,
  HardDrive,
  Inbox,
  Layers3,
  LayoutList,
  LockKeyhole,
  Map as MapIcon,
  Monitor,
  Moon,
  Network,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Sun,
  TestTube2,
  UserCheck,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  desktopApi,
  isBrowserPreview,
  readProviderStatuses,
  terminalEvents,
  type ProviderId,
  type ProviderState,
  type ProviderViewStatus,
  type TerminalStartResult,
  type WorkspaceDescriptor,
} from "./bridge";
import { missions, stages, type Mission, type MissionTone } from "./data";
import { TerminalSurface } from "./terminal-surface";

type Appearance = "system" | "light" | "dark";
type Atmosphere = "violet" | "mineral" | "sand";
type WorkspaceView = "ledger" | "workshop";
type LedgerTab = "timeline" | "changes" | "evidence";
type ControllerState = "idle" | "starting" | "ready" | "running" | "interrupting" | "stopping" | "stopped" | "failed";
type OnboardingStep = 0 | 1 | 2 | 3 | 4;
type TerminalTab = "run" | ProviderId;
type LoginMode = "console" | "local-preview";
type ActiveLogin = TerminalStartResult & {
  state: "starting" | "interactive" | "succeeded" | "failed" | "cancelled";
  command: string;
};
type ActiveControllerSession = TerminalStartResult & {
  state: "running" | "stopping" | "stopped" | "failed";
  command: string;
};

const emptyProviders: Record<ProviderId, ProviderViewStatus> = {
  codex: {
    provider: "codex",
    available: false,
    version: null,
    executableSource: null,
    authenticated: false,
    authLabel: "Not detected",
    authMethod: null,
    productionRecommended: true,
    state: "missing",
  },
  claude: {
    provider: "claude",
    available: false,
    version: null,
    executableSource: null,
    authenticated: false,
    authLabel: "Not detected",
    authMethod: null,
    productionRecommended: true,
    state: "missing",
  },
};

const providerNames: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

const statusLabels: Record<ProviderState, string> = {
  missing: "Not found",
  installed_unauthenticated: "Sign-in required",
  authenticating: "Connecting",
  authenticated: "Connected",
  expired: "Session expired",
  error: "Needs attention",
};

function providerStatusLabel(status: ProviderViewStatus) {
  if (isBrowserPreview) return `Simulated · ${statusLabels[status.state]}`;
  if (status.authenticated) return status.authLabel;
  return statusLabels[status.state];
}

const stageIcons = [Layers3, Network, Code2, TestTube2, UserCheck, GitBranch];

function readPreference<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key) as T | null;
  return value && choices.includes(value) ? value : fallback;
}

function providerIcon(provider: ProviderId) {
  return provider === "codex" ? Braces : Code2;
}

function statusIcon(state: ProviderState) {
  if (state === "authenticated") return CheckCircle2;
  if (state === "authenticating") return RefreshCw;
  if (state === "missing") return XCircle;
  return AlertCircle;
}

function toneClass(tone: MissionTone) {
  return `tone-${tone}`;
}

function IconLabel({ icon: Icon, children }: { icon: typeof Activity; children: ReactNode }) {
  return (
    <span className="iconLabel">
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
      {children}
    </span>
  );
}

function StatusBadge({ tone, children }: { tone: MissionTone; children: ReactNode }) {
  return (
    <span className={`statusBadge ${toneClass(tone)}`}>
      <span className="statusDot" aria-hidden="true" />
      {children}
    </span>
  );
}

function ProviderCard({
  provider,
  status,
  selected,
  onSelect,
  compact = false,
}: {
  provider: ProviderId;
  status: ProviderViewStatus;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const ProviderIcon = providerIcon(provider);
  const StatusIcon = statusIcon(status.state);
  return (
    <label className={`providerCard${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`}>
      <input
        type="radio"
        name={compact ? "controller-switch" : "base-controller"}
        checked={selected}
        onChange={onSelect}
      />
      <span className="providerGlyph" aria-hidden="true">
        <ProviderIcon size={22} strokeWidth={1.7} />
      </span>
      <span className="providerCopy">
        <strong>{providerNames[provider]}</strong>
        <span className={`providerState state-${status.state}`}>
          <StatusIcon
            size={14}
            strokeWidth={2}
            className={status.state === "authenticating" ? "spin" : undefined}
            aria-hidden="true"
          />
          {providerStatusLabel(status)}
          {status.version ? ` · ${status.version}` : ""}
        </span>
        {!compact ? (
          <small>
            {provider === "codex"
              ? "Codex app-server controls this workspace while AOS delegates bounded work."
              : "Claude can control new workspace sessions through an approved connection path."}
          </small>
        ) : null}
      </span>
      <span className="radioMark" aria-hidden="true">
        {selected ? <Check size={15} /> : null}
      </span>
    </label>
  );
}

function Onboarding({
  step,
  setStep,
  providers,
  selectedProvider,
  setSelectedProvider,
  workspace,
  onDetect,
  detecting,
  onStartLogin,
  loginMode,
  setLoginMode,
  activeLogin,
  onChooseWorkspace,
  choosingWorkspace,
  onFinish,
  onPreview,
}: {
  step: OnboardingStep;
  setStep: (step: OnboardingStep) => void;
  providers: Record<ProviderId, ProviderViewStatus>;
  selectedProvider: ProviderId;
  setSelectedProvider: (provider: ProviderId) => void;
  workspace: WorkspaceDescriptor | null;
  onDetect: () => Promise<void>;
  detecting: boolean;
  onStartLogin: (provider: ProviderId, mode: LoginMode) => Promise<void>;
  loginMode: LoginMode;
  setLoginMode: (mode: LoginMode) => void;
  activeLogin: ActiveLogin | null;
  onChooseWorkspace: () => Promise<void>;
  choosingWorkspace: boolean;
  onFinish: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  const selectedStatus = providers[selectedProvider];
  const connected = selectedStatus.state === "authenticated";
  const steps = ["Welcome", "Controller", "Connect", "Workspace", "Ready"];

  return (
    <div className="onboardingBackdrop">
      <section className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header className="onboardingHeader">
          <div className="onboardingBrand" aria-label="AOS">
            <span>A</span>
            <div>
              <strong>AOS Desktop</strong>
              <small>Local control plane</small>
            </div>
          </div>
          <ol className="onboardingProgress" aria-label="Setup progress">
            {steps.map((label, index) => (
              <li
                key={label}
                className={index === step ? "is-current" : index < step ? "is-complete" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
                <em>{label}</em>
              </li>
            ))}
          </ol>
        </header>

        <div className="onboardingBody">
          {step === 0 ? (
            <div className="welcomePanel motionEnter">
              <span className="welcomeMark" aria-hidden="true">
                <ShieldCheck size={34} strokeWidth={1.55} />
              </span>
              <p className="eyebrow">Evidence-first coding operations</p>
              <h1 id="onboarding-title">Make every delegated change explain itself.</h1>
              <p className="welcomeLead">
                Connect Codex or Claude as the workspace controller, route bounded work to eligible
                models, and keep proof beside every human decision.
              </p>
              <div className="promiseGrid">
                <article>
                  <LockKeyhole size={19} aria-hidden="true" />
                  <strong>Authority stays explicit</strong>
                  <span>AOS never silently replaces the controller or expands a worker&apos;s scope.</span>
                </article>
                <article>
                  <ReceiptText size={19} aria-hidden="true" />
                  <strong>Receipts, not theater</strong>
                  <span>Model identity, placement, tools, checks, cost, and approvals remain inspectable.</span>
                </article>
                <article>
                  <HardDrive size={19} aria-hidden="true" />
                  <strong>Local when policy requires</strong>
                  <span>Provider eligibility follows data and workspace policy, not prompt wording.</span>
                </article>
              </div>
              {isBrowserPreview ? (
                <div className="truthNotice infoNotice">
                  <Monitor size={17} aria-hidden="true" />
                  <span>
                    <strong>Browser preview.</strong> Detection, login, terminal output, missions, and
                    receipts are simulated. No CLI process or provider call can occur here.
                  </span>
                </div>
              ) : null}
              <div className="welcomeActions">
                <button className="primaryButton" type="button" onClick={() => setStep(1)}>
                  Set up AOS
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                <button className="secondaryButton" type="button" onClick={() => void onPreview()}>
                  Explore labeled preview
                </button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="setupPanel motionEnter">
              <div className="setupHeading">
                <p className="eyebrow">Step 1 of 4</p>
                <h1 id="onboarding-title">Choose the base controller</h1>
                <p>
                  The controller owns the conversation for this workspace. Routed workers receive only
                  bounded work units; they do not replace it.
                </p>
              </div>
              <fieldset className="providerFieldset">
                <legend className="srOnly">Base controller</legend>
                <ProviderCard
                  provider="codex"
                  status={providers.codex}
                  selected={selectedProvider === "codex"}
                  onSelect={() => setSelectedProvider("codex")}
                />
                <ProviderCard
                  provider="claude"
                  status={providers.claude}
                  selected={selectedProvider === "claude"}
                  onSelect={() => setSelectedProvider("claude")}
                />
              </fieldset>
              <div className="detectionBar">
                <span>
                  <HardDrive size={16} aria-hidden="true" />
                  Executables are resolved and versioned by the protected desktop host.
                </span>
                <button className="textButton" type="button" disabled={detecting} onClick={() => void onDetect()}>
                  <RefreshCw size={15} className={detecting ? "spin" : undefined} aria-hidden="true" />
                  {detecting ? "Detecting…" : "Detect again"}
                </button>
              </div>
              <div className="onboardingFooter">
                <button className="secondaryButton" type="button" onClick={() => setStep(0)}>Back</button>
                <button className="primaryButton" type="button" onClick={() => setStep(2)}>
                  Continue with {providerNames[selectedProvider]}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="setupPanel motionEnter">
              <div className="setupHeading">
                <p className="eyebrow">Step 2 of 4</p>
                <h1 id="onboarding-title">Connect {providerNames[selectedProvider]}</h1>
                <p>
                  Credentials remain provider-owned. AOS does not read credential stores or persist
                  terminal input; typed input is forwarded only to the installed provider CLI.
                </p>
              </div>

              {selectedProvider === "claude" ? (
                <fieldset className="loginModeFieldset">
                  <legend>Connection path</legend>
                  <label className={loginMode === "console" ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="claude-mode"
                      checked={loginMode === "console"}
                      onChange={() => setLoginMode("console")}
                    />
                    <Cloud size={19} aria-hidden="true" />
                    <span>
                      <strong>Claude Console</strong>
                      <small>Production-recommended for a distributable third-party application.</small>
                    </span>
                    <em>Recommended</em>
                  </label>
                  <label className={loginMode === "local-preview" ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="claude-mode"
                      checked={loginMode === "local-preview"}
                      onChange={() => setLoginMode("local-preview")}
                    />
                    <SquareTerminal size={19} aria-hidden="true" />
                    <span>
                      <strong>Local Claude CLI</strong>
                      <small>Personal subscription passthrough is local preview only and is not distributable.</small>
                    </span>
                    <em>Preview only</em>
                  </label>
                </fieldset>
              ) : null}

              <div className="connectionCard">
                <div className="connectionIdentity">
                  <span className="providerGlyph">
                    {selectedProvider === "codex" ? <Braces size={22} /> : <Code2 size={22} />}
                  </span>
                  <div>
                    <strong>{providerNames[selectedProvider]}</strong>
                    <span className={`providerState state-${selectedStatus.state}`}>
                      {providerStatusLabel(selectedStatus)}
                    </span>
                    {selectedProvider === "claude" && selectedStatus.authenticated ? (
                      <small>
                        {selectedStatus.authMethod === "claude-console"
                          ? "Claude Console connection reported by the CLI."
                          : selectedStatus.authMethod === "claude-subscription"
                            ? "Local subscription session · preview-only for this third-party app."
                            : "Authenticated · method unverified by the CLI."}
                      </small>
                    ) : null}
                  </div>
                </div>
                <dl className="connectionFacts">
                  <div><dt>Version</dt><dd>{selectedStatus.version || "Not detected"}</dd></div>
                  <div>
                    <dt>Executable source</dt>
                    <dd>{selectedStatus.executableSource || "Unavailable"}</dd>
                  </div>
                  <div><dt>Credential access</dt><dd>Host-only</dd></div>
                </dl>
                {selectedStatus.message ? <p className="statusMessage">{selectedStatus.message}</p> : null}
              </div>

              {selectedStatus.state === "missing" ? (
                <div className="truthNotice warningNotice">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <span>The CLI was not found. Install it from official documentation, then detect again.</span>
                </div>
              ) : null}
              {connected ? (
                <div className="truthNotice successNotice" role="status">
                  <CheckCircle2 size={17} aria-hidden="true" />
                  <span>
                    <strong>{isBrowserPreview ? "Simulated preview flow complete." : "Connection verified."}</strong>{" "}
                    {isBrowserPreview ? "No provider credential was created." : "Continue to select the workspace."}
                  </span>
                </div>
              ) : null}
              {activeLogin ? (
                <div className="truthNotice infoNotice" role="status">
                  <SquareTerminal size={17} aria-hidden="true" />
                  <span>Login console is {activeLogin.state}. Follow its provider-owned instructions below.</span>
                </div>
              ) : null}

              <div className="onboardingFooter">
                <button className="secondaryButton" type="button" onClick={() => setStep(1)}>Back</button>
                <div className="footerActions">
                  {!connected ? (
                    <button
                      className="primaryButton"
                      type="button"
                      disabled={selectedStatus.state === "missing" || selectedStatus.state === "authenticating"}
                      onClick={() => void onStartLogin(selectedProvider, loginMode)}
                    >
                      <SquareTerminal size={16} aria-hidden="true" />
                      {isBrowserPreview ? "Preview login flow" : "Open login console"}
                    </button>
                  ) : (
                    <button className="primaryButton" type="button" onClick={() => setStep(3)}>
                      Select workspace
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="setupPanel motionEnter">
              <div className="setupHeading">
                <p className="eyebrow">Step 3 of 4</p>
                <h1 id="onboarding-title">Select a workspace</h1>
                <p>
                  The desktop host opens the native folder picker, canonicalizes the path, and verifies
                  access. The renderer never turns typed text into a trusted filesystem path.
                </p>
              </div>
              <button className="workspaceSelection" type="button" onClick={() => void onChooseWorkspace()} disabled={choosingWorkspace}>
                <span className="workspaceSelectionIcon"><FolderGit2 size={26} aria-hidden="true" /></span>
                <span>
                  <strong>{workspace ? workspace.name : choosingWorkspace ? "Opening folder picker…" : "Choose project folder"}</strong>
                  <small title={workspace?.path}>{workspace ? workspace.path : "Uses the native desktop picker"}</small>
                </span>
                <ChevronRight size={19} aria-hidden="true" />
              </button>
              {workspace ? (
                <div className="workspaceFacts">
                  <span><GitBranch size={15} aria-hidden="true" />Host-authorized workspace</span>
                  <span className="successText"><CheckCircle2 size={15} aria-hidden="true" />Canonical path selected</span>
                  <span><LockKeyhole size={15} aria-hidden="true" />Local/private default</span>
                </div>
              ) : null}
              <details className="advancedDisclosure">
                <summary>Advanced data policy</summary>
                <p>
                  This build starts local/private. Provider routing remains unavailable until a real,
                  certified worker fleet and explicit placement policy are connected.
                </p>
              </details>
              <div className="onboardingFooter">
                <button className="secondaryButton" type="button" onClick={() => setStep(2)}>Back</button>
                <button className="primaryButton" type="button" disabled={!workspace} onClick={() => setStep(4)}>
                  Review setup
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="setupPanel readyPanel motionEnter">
              <div className="setupHeading">
                <p className="eyebrow">Step 4 of 4</p>
                <h1 id="onboarding-title">Your control plane is ready</h1>
                <p>Review what is connected—and what is not—before entering the workbench.</p>
              </div>
              <ul className="readinessList">
                <li>
                  <CheckCircle2 size={19} aria-hidden="true" />
                  <span><strong>{providerNames[selectedProvider]}</strong><small>Selected base controller · authenticated</small></span>
                </li>
                <li>
                  <CheckCircle2 size={19} aria-hidden="true" />
                  <span><strong>{workspace?.name}</strong><small>{workspace?.path}</small></span>
                </li>
                <li className="readinessWarning">
                  <AlertTriangle size={19} aria-hidden="true" />
                  <span><strong>No worker fleet connected</strong><small>Workbench missions and receipts remain labeled preview data.</small></span>
                </li>
                <li>
                  <ReceiptText size={19} aria-hidden="true" />
                  <span><strong>Receipts stay separate from worker writes</strong><small>Real receipts appear only after a verified provider response.</small></span>
                </li>
              </ul>
              <div className="onboardingFooter">
                <button className="secondaryButton" type="button" onClick={() => setStep(3)}>Back</button>
                <button className="primaryButton" type="button" onClick={() => void onFinish()}>
                  Open workbench
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

type CommandItem = {
  id: string;
  label: string;
  detail: string;
  group: string;
  icon: typeof Activity;
  shortcut?: string;
  disabled?: boolean;
  onRun: () => void;
};

function CommandPalette({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? items.filter((item) => `${item.label} ${item.detail} ${item.group}`.toLocaleLowerCase().includes(normalized))
      : items;
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [activeIndex, filtered.length]);

  function run(item: CommandItem) {
    if (item.disabled) return;
    item.onRun();
    onClose();
  }

  return (
    <div className="modalScrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="commandPalette motionModal" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <h2 id="command-title" className="srOnly">Command palette</h2>
        <div className="commandInputRow">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={filtered[activeIndex] ? `command-${filtered[activeIndex].id}` : undefined}
            value={query}
            placeholder="Search commands, missions, and settings"
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
              if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); }
              if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(filtered.length - 1, 0)); }
              if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); run(filtered[activeIndex]); }
              if (event.key === "Escape") { event.preventDefault(); onClose(); }
              if (event.key === "Tab") {
                event.preventDefault();
                closeRef.current?.focus();
              }
            }}
          />
          <button ref={closeRef} className="keyButton" type="button" onClick={onClose} onKeyDown={(event) => {
            if (event.key === "Tab") { event.preventDefault(); inputRef.current?.focus(); }
          }}>Esc</button>
        </div>
        <div className="commandResults" id="command-results" role="listbox">
          {filtered.length ? filtered.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                id={`command-${item.id}`}
                key={item.id}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={item.disabled}
                className={index === activeIndex ? "is-active" : ""}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(item)}
                disabled={item.disabled}
              >
                <span className="commandIcon"><Icon size={17} aria-hidden="true" /></span>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <em>{item.shortcut || item.group}</em>
              </button>
            );
          }) : (
            <div className="emptyCommand"><Search size={22} aria-hidden="true" /><span>No matching commands</span></div>
          )}
        </div>
        <footer className="commandFooter">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span>Actions still obey workspace policy.</span>
        </footer>
      </section>
    </div>
  );
}

function ControllerSwitchDialog({
  current,
  target,
  state,
  workspace,
  onConfirm,
  onClose,
}: {
  current: ProviderId;
  target: ProviderId;
  state: ControllerState;
  workspace: WorkspaceDescriptor | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const busy = state === "starting" || state === "running" || state === "interrupting" || state === "stopping";
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="modalScrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="confirmDialog motionModal" role="alertdialog" aria-modal="true" aria-labelledby="switch-title" aria-describedby="switch-detail">
        <span className={`dialogMark${busy ? " is-warning" : ""}`} aria-hidden="true">
          {busy ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
        </span>
        <p className="eyebrow">Controller boundary</p>
        <h2 id="switch-title">
          {busy ? "This controller session is still active" : `Use ${providerNames[target]} for new sessions?`}
        </h2>
        <p id="switch-detail">
          {busy
            ? `AOS will not hot-swap ${providerNames[current]} while it is ${state}. Interrupt or finish it first; a new controller starts without transferring hidden context.`
            : `${providerNames[target]} becomes the base controller for ${workspace?.name || "this workspace"}. Existing missions and receipts are unchanged, and no transcript is silently transferred.`}
        </p>
        <div className="boundaryDiagram" aria-label={`Controller changes from ${providerNames[current]} to ${providerNames[target]}`}>
          <span>{providerNames[current]}<small>current</small></span>
          <ArrowRight size={17} aria-hidden="true" />
          <span>{providerNames[target]}<small>new sessions</small></span>
        </div>
        <div className="dialogActions">
          <button ref={cancelRef} className="secondaryButton" type="button" onClick={onClose}>Keep {providerNames[current]}</button>
          {busy ? (
            <button className="primaryButton" type="button" disabled title="Controller interruption is not exposed by this renderer build">
              Finish or interrupt first
            </button>
          ) : (
            <button className="primaryButton" type="button" onClick={() => void onConfirm()}>
              Confirm for new sessions
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function MissionExplorer({
  selectedId,
  onSelect,
  open,
  onClose,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = missions.filter((mission) => `${mission.id} ${mission.title} ${mission.repo}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return (
    <aside className={`missionExplorer${open ? " is-open" : ""}`} aria-label="Missions">
      <div className="paneHeading">
        <div><p className="eyebrow">Outcomes</p><h2>Missions</h2></div>
        <button className="iconButton responsiveClose" type="button" aria-label="Close mission explorer" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="missionCounts" aria-label="Mission summary">
        <span><strong>2</strong> need you</span>
        <span><strong>2</strong> active</span>
        <span><strong>1</strong> blocked</span>
      </div>
      <label className="searchField">
        <Search size={15} aria-hidden="true" />
        <span className="srOnly">Search missions</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter missions" />
      </label>
      <div className="missionList">
        {filtered.map((mission) => (
          <button
            type="button"
            key={mission.id}
            className={`missionRow ${toneClass(mission.tone)}${selectedId === mission.id ? " is-selected" : ""}`}
            aria-pressed={selectedId === mission.id}
            onClick={() => { onSelect(mission.id); onClose(); }}
          >
            <span className="missionRowTop"><em>{mission.id}</em><StatusBadge tone={mission.tone}>{mission.status}</StatusBadge></span>
            <strong>{mission.title}</strong>
            <span className="missionRowMeta"><span>{mission.repo}</span><span>{stages[mission.stage]}</span></span>
            <span className="missionProgress" aria-label={`Mission stage ${mission.stage + 1} of ${stages.length}`}>
              <i style={{ transform: `scaleX(${(mission.stage + 1) / stages.length})` }} />
            </span>
          </button>
        ))}
      </div>
      <button className="createMissionButton" type="button" disabled title="Connect an execution service to create real missions">
        <Zap size={16} aria-hidden="true" />
        Create mission
      </button>
    </aside>
  );
}

function LedgerView({ mission, tab, onTab }: { mission: Mission; tab: LedgerTab; onTab: (tab: LedgerTab) => void }) {
  const passed = Number(mission.checks.split("/")[0]);
  const total = Number(mission.checks.split("/")[1]);
  return (
    <section className="ledgerView motionView" aria-labelledby="mission-title">
      <header className="missionHeader">
        <div>
          <div className="breadcrumb"><span>{mission.id}</span><ChevronRight size={13} /><span>{stages[mission.stage]}</span></div>
          <h1 id="mission-title">{mission.title}</h1>
          <div className="missionMeta">
            <IconLabel icon={FolderGit2}>{mission.repo}</IconLabel>
            <IconLabel icon={GitBranch}>{mission.branch}</IconLabel>
            <IconLabel icon={Clock3}>{mission.elapsed}</IconLabel>
          </div>
        </div>
        <div className="missionActions">
          <StatusBadge tone={mission.tone}>{mission.status}</StatusBadge>
          <button className="secondaryButton compactButton" type="button" disabled={mission.status !== "Running" && mission.status !== "Validating"}><Pause size={15} />Pause</button>
          <button className="dangerButton compactButton" type="button" disabled={mission.status === "Queued" || mission.status === "Policy blocked"}><CircleStop size={15} />Stop</button>
        </div>
      </header>

      <ol className="stageRail" aria-label="Mission stages">
        {stages.map((stage, index) => {
          const Icon = stageIcons[index];
          const state = index < mission.stage ? "complete" : index === mission.stage ? "current" : "pending";
          return (
            <li key={stage} className={`is-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span>{state === "complete" ? <Check size={13} /> : <Icon size={14} />}</span>
              <em>{stage}</em>
              {index < stages.length - 1 ? <i aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      <button className="executionRoute" type="button" aria-label="Open route receipt in trust inspector">
        <span className="routeNode"><Bot size={16} /><small>Controller</small><strong>Workspace base</strong></span>
        <ArrowRight size={15} className="routeArrow" />
        <span className="routeNode"><Cpu size={16} /><small>{mission.stage < 2 ? "Planned worker" : "Recorded worker"}</small><strong>{mission.worker}</strong></span>
        <span className="routePlacement"><HardDrive size={14} />{mission.placement}</span>
        <span className={passed === total ? "routeCheck is-passed" : "routeCheck"}>
          {passed === total ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{mission.checks} gates
        </span>
        <span className="routeCost">{mission.cost}</span>
      </button>

      <div className="ledgerTabs" role="tablist" aria-label="Mission details">
        {(["timeline", "changes", "evidence"] as LedgerTab[]).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => onTab(item)}>
            {item === "timeline" ? "Activity" : item === "changes" ? `Changes · ${mission.changedFiles}` : "Evidence"}
          </button>
        ))}
      </div>

      <div className="ledgerPanel" role="tabpanel" tabIndex={0}>
        {tab === "timeline" ? (
          <ol className="eventTimeline">
            {mission.events.map((event, index) => (
              <li key={`${event.title}-${index}`} className={`event-${event.state}`}>
                <span className="eventMark" aria-hidden="true">
                  {event.state === "complete" ? <Check size={13} /> : event.state === "blocked" ? <X size={13} /> : <span />}
                </span>
                <div><strong>{event.title}</strong><p>{event.detail}</p><small>{event.time}</small></div>
              </li>
            ))}
          </ol>
        ) : null}
        {tab === "changes" ? (
          mission.files.length ? (
            <table className="changesTable">
              <thead><tr><th>File</th><th>Change</th><th>Risk</th></tr></thead>
              <tbody>{mission.files.map((file) => (
                <tr key={file.path}><td><FileCode2 size={15} />{file.path}</td><td>{file.change}</td><td><span className={`risk risk-${file.risk.toLowerCase()}`}>{file.risk}</span></td></tr>
              ))}</tbody>
            </table>
          ) : (
            <div className="emptyState"><FileCode2 size={25} /><strong>No artifact returned</strong><span>No provider output or file change is claimed for this state.</span></div>
          )
        ) : null}
        {tab === "evidence" ? (
          <div className="evidenceGrid">
            <article><span><TestTube2 size={18} />Deterministic gates</span><strong>{mission.checks}</strong><small>{passed === total ? "All declared checks passed" : `${total - passed} checks remain`}</small></article>
            <article><span><ShieldCheck size={18} />Policy decision</span><strong>{mission.stage === 1 && mission.tone === "blocked" ? "Denied" : "Eligible"}</strong><small>{mission.routeReason}</small></article>
            <article><span><ReceiptText size={18} />Receipt integrity</span><strong>Preview only</strong><small>No signed production receipt exists for simulated mission data.</small></article>
            <article><span><CircleDollarSign size={18} />Recorded cost</span><strong>{mission.cost}</strong><small>Example value; no billing provider was queried.</small></article>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WorkshopView({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section className="workshopView motionView" aria-labelledby="workshop-title">
      <header className="workshopHeader">
        <div><p className="eyebrow">Operational workshop · Floor 01</p><h1 id="workshop-title">See work move, not agents perform</h1><p>Rooms are durable pipeline stages. Every pod is a bounded mission—not a synthetic coworker.</p></div>
        <div className="workshopFacts"><span><Box size={15} />{missions.length} work units</span><span><UserCheck size={15} />1 needs approval</span></div>
      </header>
      <div className="workshopFlow" aria-label="Plan, route, build, validate, approve, ship">
        {stages.map((stage, index) => <span key={stage}><em>{String(index + 1).padStart(2, "0")}</em>{stage}{index < stages.length - 1 ? <ArrowRight size={13} /> : null}</span>)}
      </div>
      <ol className="workshopFloor">
        {stages.map((stage, index) => {
          const Icon = stageIcons[index];
          const occupants = missions.filter((mission) => mission.stage === index);
          return (
            <li className={`workshopRoom room-${index}`} key={stage}>
              <header><span><Icon size={17} />{stage}</span><em>{occupants.length} active</em></header>
              <div className="roomFurniture" aria-hidden="true"><span/><span/><span/></div>
              <div className="roomPods">
                {occupants.map((mission) => (
                  <button
                    key={mission.id}
                    type="button"
                    className={`missionPod ${toneClass(mission.tone)}${selectedId === mission.id ? " is-selected" : ""}`}
                    aria-pressed={selectedId === mission.id}
                    onClick={() => onSelect(mission.id)}
                  >
                    <span><em>{mission.id}</em><StatusBadge tone={mission.tone}>{mission.status}</StatusBadge></span>
                    <strong>{mission.title}</strong>
                    <small>{mission.worker} · {mission.checks} gates</small>
                  </button>
                ))}
                {!occupants.length ? <span className="emptyRoom">No work at this stage</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <details className="workshopTableAlternative">
        <summary>Open accessible mission list</summary>
        <table><thead><tr><th>Mission</th><th>Stage</th><th>Status</th><th>Worker</th></tr></thead><tbody>{missions.map((mission) => (
          <tr key={mission.id}><td><button type="button" onClick={() => onSelect(mission.id)}>{mission.id} · {mission.title}</button></td><td>{stages[mission.stage]}</td><td>{mission.status}</td><td>{mission.worker}</td></tr>
        ))}</tbody></table>
      </details>
    </section>
  );
}

function TrustInspector({ mission, open, onClose }: { mission: Mission; open: boolean; onClose: () => void }) {
  return (
    <aside className={`trustInspector${open ? " is-open" : ""}`} aria-label="Trust and approvals">
      <div className="paneHeading">
        <div><p className="eyebrow">Decision dock</p><h2>Trust & approvals</h2></div>
        <button className="iconButton" type="button" aria-label="Close trust inspector" onClick={onClose}><PanelRightClose size={18} /></button>
      </div>
      <div className="previewStrip"><Sparkles size={14} />Preview receipt · not provider evidence</div>
      <section className="decisionCard">
        <span className="decisionIcon"><UserCheck size={19} /></span>
        <p className="eyebrow">Selected decision</p>
        <h3>{mission.status === "Approval required" ? "Review authentication invariants" : "No human decision yet"}</h3>
        <p>{mission.status === "Approval required" ? "All declared checks passed. Ownership of the behavioral change still belongs to you." : "The mission has not reached a valid approval boundary."}</p>
        <div className="decisionActions">
          <button className="primaryButton" type="button" disabled={mission.status !== "Approval required"}>Approve evidence</button>
          <button className="secondaryButton" type="button" disabled={mission.status !== "Approval required"}>Request changes</button>
        </div>
      </section>
      <section className="receiptCard">
        <header><span><ReceiptText size={17} />Route receipt</span><span className="receiptState"><AlertCircle size={14} />Simulated</span></header>
        <dl>
          <div><dt>Controller</dt><dd>Workspace base <small>not replaced</small></dd></div>
          <div><dt>Worker</dt><dd>{mission.worker}</dd></div>
          <div><dt>Placement</dt><dd>{mission.placement}</dd></div>
          <div><dt>Reason</dt><dd>{mission.routeReason}</dd></div>
          <div><dt>Checks</dt><dd>{mission.checks}</dd></div>
          <div><dt>Cost</dt><dd>{mission.cost} <small>example</small></dd></div>
        </dl>
        <div className="receiptTruth"><LockKeyhole size={15} /><span>A production receipt appears only after the provider reports model identity and trusted validation completes.</span></div>
      </section>
      <section className="budgetCard">
        <header><span>Workspace preview budget</span><strong>$2.10 / $8.00</strong></header>
        <span className="budgetTrack"><i style={{ transform: "scaleX(.2625)" }} /></span>
        <small>Example values. No billing system is connected.</small>
      </section>
    </aside>
  );
}

function TerminalPanel({
  open,
  tab,
  onTab,
  activeLogin,
  activeSession,
  onCancel,
  onStopSession,
  onClose,
  onError,
}: {
  open: boolean;
  tab: TerminalTab;
  onTab: (tab: TerminalTab) => void;
  activeLogin: ActiveLogin | null;
  activeSession: ActiveControllerSession | null;
  onCancel: () => Promise<void>;
  onStopSession: () => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(330);
  const resizing = useRef<{ startY: number; startHeight: number } | null>(null);
  const terminalProvider = tab === "run" ? null : tab;
  const activeForTab = activeLogin?.provider === terminalProvider ? activeLogin : null;

  useEffect(() => {
    function move(event: PointerEvent) {
      if (!resizing.current) return;
      const delta = resizing.current.startY - event.clientY;
      setHeight(Math.max(220, Math.min(560, resizing.current.startHeight + delta)));
    }
    function stop() { resizing.current = null; }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);

  if (!open) return null;
  return (
    <section ref={panelRef} className="terminalPanel" style={{ height }} aria-label="Purpose-bound login and run console">
      <div
        className="terminalResize"
        role="separator"
        aria-orientation="horizontal"
        aria-valuemin={220}
        aria-valuemax={560}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={(event) => { resizing.current = { startY: event.clientY, startHeight: height }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16;
          if (event.key === "ArrowUp") { event.preventDefault(); setHeight((value) => Math.min(560, value + step)); }
          if (event.key === "ArrowDown") { event.preventDefault(); setHeight((value) => Math.max(220, value - step)); }
        }}
      ><span /></div>
      <header className="terminalHeader">
        <div className="terminalTabs" role="tablist" aria-label="Console sessions">
          <button type="button" role="tab" aria-selected={tab === "run"} onClick={() => onTab("run")}>
            <Activity size={15} />Run output
            {activeSession ? <span className={`terminalState terminal-${activeSession.state}`}>{activeSession.state}</span> : null}
          </button>
          {(["codex", "claude"] as ProviderId[]).map((provider) => (
            <button key={provider} type="button" role="tab" aria-selected={tab === provider} onClick={() => onTab(provider)}>
              <SquareTerminal size={15} />Login: {providerNames[provider]}
              {activeLogin?.provider === provider ? <span className={`terminalState terminal-${activeLogin.state}`}>{activeLogin.state}</span> : null}
            </button>
          ))}
        </div>
        <div className="terminalHeaderActions">
          <span className="restrictedBadge"><LockKeyhole size={13} />Restricted</span>
          {tab === "run" && activeSession && (activeSession.state === "running" || activeSession.state === "stopping") ? (
            <button
              className="textButton terminalStop"
              type="button"
              disabled={activeSession.state === "stopping"}
              onClick={() => void onStopSession()}
            >
              <CircleStop size={14} aria-hidden="true" />
              {activeSession.state === "stopping" ? "Stopping…" : "Stop session"}
            </button>
          ) : null}
          {activeForTab && (activeForTab.state === "starting" || activeForTab.state === "interactive") ? <button className="textButton terminalCancel" type="button" onClick={() => void onCancel()}>Cancel login</button> : null}
          <button className="iconButton terminalClose" type="button" aria-label="Close console" onClick={onClose}><X size={17} /></button>
        </div>
      </header>
      {tab === "run" ? (
        activeSession ? (
          <div className="terminalSurface" role="tabpanel">
            <TerminalSurface
              terminalId={activeSession.terminalId}
              provider={activeSession.provider}
              command={activeSession.command}
              purpose="session"
              interactive={activeSession.state === "running"}
              onError={onError}
            />
          </div>
        ) : (
          <div className="runConsoleEmpty">
            <Activity size={24} aria-hidden="true" />
            <strong>No controller session started</strong>
            <span>Start a new session for the selected workspace and base provider. AOS never attaches to or resumes an existing conversation.</span>
          </div>
        )
      ) : (
        <div className="terminalSurface" role="tabpanel">
          {activeForTab ? (
            <TerminalSurface
              terminalId={activeForTab.terminalId}
              provider={activeForTab.provider}
              command={activeForTab.command}
              purpose="login"
              interactive={activeForTab.state === "starting" || activeForTab.state === "interactive"}
              onError={onError}
            />
          ) : (
            <div className="runConsoleEmpty">
              <SquareTerminal size={24} aria-hidden="true" />
              <strong>No active {providerNames[tab]} login</strong>
              <span>Start a provider connection to open its purpose-bound interactive terminal.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DisplayPanel({
  appearance,
  atmosphere,
  onAppearance,
  onAtmosphere,
  onClose,
}: {
  appearance: Appearance;
  atmosphere: Atmosphere;
  onAppearance: (value: Appearance) => void;
  onAtmosphere: (value: Atmosphere) => void;
  onClose: () => void;
}) {
  const appearances: Array<{ id: Appearance; label: string; icon: typeof Monitor }> = [
    { id: "system", label: "System", icon: Monitor },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];
  const atmospheres: Array<{ id: Atmosphere; label: string }> = [
    { id: "violet", label: "Violet Ink" },
    { id: "mineral", label: "Mineral Blue" },
    { id: "sand", label: "Warm Sand" },
  ];
  return (
    <div className="displayPopover motionPopover" role="dialog" aria-label="Appearance settings">
      <header><div><p className="eyebrow">Display</p><h2>Appearance</h2></div><button className="iconButton" type="button" onClick={onClose} aria-label="Close appearance settings"><X size={17} /></button></header>
      <fieldset><legend>Appearance</legend><div className="segmentedControl">{appearances.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" aria-pressed={appearance === item.id} onClick={() => onAppearance(item.id)}><Icon size={16} />{item.label}</button>; })}</div></fieldset>
      <fieldset><legend>Atmosphere</legend><div className="atmosphereOptions">{atmospheres.map((item) => <button key={item.id} type="button" className={`atmosphere-${item.id}`} aria-pressed={atmosphere === item.id} onClick={() => onAtmosphere(item.id)}><span aria-hidden="true" />{item.label}{atmosphere === item.id ? <Check size={15} /> : null}</button>)}</div></fieldset>
      <p className="popoverNote">Atmosphere changes surfaces and focus accents only. Success, warning, and failure keep the same meaning.</p>
    </div>
  );
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [providers, setProviders] = useState<Record<ProviderId, ProviderViewStatus>>(emptyProviders);
  const [detecting, setDetecting] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const [activeController, setActiveController] = useState<ProviderId>("codex");
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("codex");
  const [controllerState, setControllerState] = useState<ControllerState>("idle");
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(0);
  const [loginMode, setLoginMode] = useState<LoginMode>("console");
  const [activeLogin, setActiveLogin] = useState<ActiveLogin | null>(null);
  const [activeControllerSession, setActiveControllerSession] = useState<ActiveControllerSession | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalTab, setTerminalTab] = useState<TerminalTab>("run");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("ledger");
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("timeline");
  const [selectedMissionId, setSelectedMissionId] = useState(missions[0].id);
  const [missionExplorerOpen, setMissionExplorerOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [controllerMenuOpen, setControllerMenuOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<ProviderId | null>(null);
  const [toast, setToast] = useState("");
  const [appearance, setAppearance] = useState<Appearance>(() => readPreference("aos-appearance", ["system", "light", "dark"] as const, "system"));
  const [atmosphere, setAtmosphere] = useState<Atmosphere>(() => readPreference("aos-atmosphere", ["violet", "mineral", "sand"] as const, "violet"));
  const loginProviderBySession = useRef(new Map<string, ProviderId>());
  const cancelledLoginTerminalIds = useRef(new Set<string>());
  const controllerTerminalId = useRef<string | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      setProviders(await readProviderStatuses());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider detection failed.";
      setToast(message);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const [config, detected] = await Promise.all([desktopApi.config.read(), readProviderStatuses()]);
        if (!alive) return;
        setProviders(detected);
        setActiveController(config.selectedProvider);
        setSelectedProvider(config.selectedProvider);
        setWorkspace(config.workspace);
        setShowOnboarding(!config.workspace);
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Desktop initialization failed.");
      } finally {
        if (alive) setBooting(false);
      }
    }
    void boot();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const unsubscribeData = terminalEvents.onData((event) => {
      const provider = loginProviderBySession.current.get(event.terminalId);
      if (!provider) return;
      setActiveLogin((current) => current && current.terminalId === event.terminalId ? { ...current, state: "interactive" } : current);
    });
    const unsubscribeExit = terminalEvents.onExit((event) => {
      if (cancelledLoginTerminalIds.current.delete(event.terminalId)) {
        loginProviderBySession.current.delete(event.terminalId);
        terminalEvents.clear(event.terminalId);
        return;
      }
      if (controllerTerminalId.current === event.terminalId) {
        controllerTerminalId.current = null;
        setControllerState(event.reason === "exited" && event.exitCode !== 0 ? "failed" : "stopped");
        setActiveControllerSession((current) =>
          current?.terminalId === event.terminalId
            ? {
                ...current,
                state: event.reason === "exited" && event.exitCode !== 0 ? "failed" : "stopped",
              }
            : current,
        );
        setToast(
          event.reason === "stopped"
            ? "Controller session stopped. Its terminal is now read-only."
            : event.exitCode === 0
              ? "Controller session finished. Its terminal is now read-only."
              : `Controller session exited with code ${event.exitCode}.`,
        );
        return;
      }
      const provider = loginProviderBySession.current.get(event.terminalId);
      if (!provider) return;
      const succeeded = event.reason === "exited" && event.exitCode === 0;
      setToast(
        succeeded
          ? isBrowserPreview
            ? `${providerNames[provider]} preview flow completed. No credential was created.`
            : `${providerNames[provider]} login process exited successfully. Verifying account state…`
          : `${providerNames[provider]} login ${event.reason === "stopped" ? "cancelled" : "ended without verification"}.`,
      );
      loginProviderBySession.current.delete(event.terminalId);
      terminalEvents.clear(event.terminalId);
      setActiveLogin((current) => current?.terminalId === event.terminalId ? null : current);
      void detect();
    });
    return () => { unsubscribeData(); unsubscribeExit(); };
  }, [detect]);

  useEffect(() => {
    window.localStorage.setItem("aos-appearance", appearance);
    window.localStorage.setItem("aos-atmosphere", atmosphere);
  }, [appearance, atmosphere]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = target.matches("input, textarea, [contenteditable='true']");
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); previousFocus.current = document.activeElement as HTMLElement; setCommandOpen(true); return; }
      if (command && event.key.toLocaleLowerCase() === "j") { event.preventDefault(); setTerminalOpen((value) => !value); return; }
      if (typing) return;
      if (command && event.key === "1") { event.preventDefault(); setWorkspaceView("ledger"); }
      if (command && event.key === "2") { event.preventDefault(); setWorkspaceView("workshop"); }
      if (command && event.key.toLocaleLowerCase() === "b") { event.preventDefault(); setMissionExplorerOpen((value) => !value); }
      if (command && event.key === ",") { event.preventDefault(); setDisplayOpen(true); }
      if (event.key === "Escape") { setCommandOpen(false); setControllerMenuOpen(false); setDisplayOpen(false); setSwitchTarget(null); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (!commandOpen && previousFocus.current) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [commandOpen]);

  async function startLogin(provider: ProviderId, mode: LoginMode) {
    setProviders((current) => ({ ...current, [provider]: { ...current[provider], state: "authenticating" } }));
    setTerminalTab(provider);
    setTerminalOpen(true);
    try {
      const request =
        provider === "codex"
          ? ({ provider: "codex", method: "browser" } as const)
          : ({ provider: "claude", method: mode } as const);
      const session = await desktopApi.providers.login.start(request);
      loginProviderBySession.current.set(session.terminalId, provider);
      const earlyExit = terminalEvents.takeEarlyExit(session.terminalId);
      if (earlyExit) {
        loginProviderBySession.current.delete(session.terminalId);
        terminalEvents.clear(session.terminalId);
        setActiveLogin(null);
        setToast(
          earlyExit.reason === "exited" && earlyExit.exitCode === 0
            ? `${providerNames[provider]} login finished before the console opened. Verifying account state…`
            : `${providerNames[provider]} login ended before the console opened.`,
        );
        void detect();
        return;
      }
      setActiveLogin({
        ...session,
        state: "starting",
        command:
          provider === "codex"
            ? "codex login"
            : mode === "console"
              ? "Claude Console connection"
              : "claude auth login · local preview only",
      });
    } catch (error) {
      setProviders((current) => ({ ...current, [provider]: { ...current[provider], state: "error", message: error instanceof Error ? error.message : "Login could not start." } }));
      setToast(error instanceof Error ? error.message : "Login could not start.");
    }
  }

  async function chooseWorkspace() {
    setChoosingWorkspace(true);
    try {
      const chosen = await desktopApi.workspace.choose();
      if (chosen) {
        setWorkspace(await desktopApi.workspace.select(chosen.id));
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Workspace selection failed.");
    } finally {
      setChoosingWorkspace(false);
    }
  }

  async function finishOnboarding() {
    if (!workspace) return;
    const config = await desktopApi.config.updateController(selectedProvider);
    setActiveController(config.selectedProvider);
    setShowOnboarding(false);
    setToast("Workspace controller saved. No worker fleet is connected yet.");
  }

  async function explorePreview() {
    const previewWorkspace = workspace ?? { id: "renderer-demo", path: "/Preview/relay-engineering", name: "Relay engineering" };
    setWorkspace(previewWorkspace);
    setActiveController("codex");
    setShowOnboarding(false);
    setToast("Labeled preview opened. No CLI, model, or billing provider was contacted.");
  }

  const controllerSessionBusy =
    controllerState === "starting" ||
    controllerState === "running" ||
    controllerState === "stopping" ||
    controllerState === "interrupting";

  async function startControllerSession() {
    if (controllerSessionBusy) {
      setTerminalTab("run");
      setTerminalOpen(true);
      setToast("A controller session is already active. Stop it before starting another.");
      return;
    }
    if (!workspace) {
      setToast("Choose an authorized workspace before starting a controller session.");
      return;
    }
    if (!isBrowserPreview && providers[activeController].state !== "authenticated") {
      setToast(`Connect ${providerNames[activeController]} before starting a controller session.`);
      return;
    }

    setControllerState("starting");
    setActiveControllerSession(null);
    setTerminalTab("run");
    setTerminalOpen(true);
    try {
      const session = await desktopApi.sessions.start({
        provider: activeController,
        workspaceId: workspace.id,
        cols: 100,
        rows: 28,
      });
      controllerTerminalId.current = session.terminalId;
      const earlyExit = terminalEvents.takeEarlyExit(session.terminalId);
      if (earlyExit) {
        const state = earlyExit.reason === "exited" && earlyExit.exitCode !== 0 ? "failed" : "stopped";
        controllerTerminalId.current = null;
        setActiveControllerSession({
          ...session,
          state,
          command: isBrowserPreview
            ? `Simulated new ${providerNames[activeController]} session · no process`
            : `New ${providerNames[activeController]} session · ${workspace.name}`,
        });
        setControllerState(state);
        setToast(
          state === "failed"
            ? `The new controller session exited with code ${earlyExit.exitCode} before its terminal opened.`
            : "The new controller session finished before its terminal opened; captured output remains available read-only.",
        );
        return;
      }
      setActiveControllerSession({
        ...session,
        state: "running",
        command: isBrowserPreview
          ? `Simulated new ${providerNames[activeController]} session · no process`
          : `New ${providerNames[activeController]} session · ${workspace.name}`,
      });
      setControllerState("running");
      setToast(
        isBrowserPreview
          ? "Simulated new-session preview started. No CLI process or provider call was made."
          : `New ${providerNames[activeController]} controller session started for ${workspace.name}.`,
      );
    } catch (error) {
      controllerTerminalId.current = null;
      setControllerState("failed");
      setActiveControllerSession(null);
      setToast(error instanceof Error ? error.message : "The new controller session could not start.");
    }
  }

  async function stopControllerSession() {
    const session = activeControllerSession;
    if (!session || session.state !== "running") return;
    setControllerState("stopping");
    setActiveControllerSession({ ...session, state: "stopping" });
    try {
      await desktopApi.sessions.stop(session.terminalId);
      setToast("Stop requested. Waiting for the controller process to exit…");
    } catch (error) {
      setControllerState("running");
      setActiveControllerSession((current) =>
        current?.terminalId === session.terminalId ? { ...current, state: "running" } : current,
      );
      setToast(error instanceof Error ? error.message : "The controller session could not be stopped.");
    }
  }

  async function confirmSwitch() {
    if (!switchTarget) return;
    if (controllerSessionBusy) {
      setToast("Stop the active controller session before changing the base provider.");
      return;
    }
    try {
      const config = await desktopApi.config.updateController(switchTarget);
      setActiveController(config.selectedProvider);
      setSelectedProvider(config.selectedProvider);
      setToast(`${providerNames[switchTarget]} will control new workspace sessions. Existing receipts are unchanged.`);
      setSwitchTarget(null);
      setControllerMenuOpen(false);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Controller change failed.");
    }
  }

  const selectedMission = missions.find((mission) => mission.id === selectedMissionId) ?? missions[0];
  const commandItems: CommandItem[] = [
    {
      id: "start-controller-session",
      label: isBrowserPreview ? "Preview a new controller session" : "Start a new controller session",
      detail: controllerSessionBusy
        ? "Unavailable while another controller session is active"
        : `Create a fresh ${providerNames[activeController]} session for ${workspace?.name || "the selected workspace"}`,
      group: "Controller",
      icon: Play,
      disabled:
        controllerSessionBusy ||
        !workspace ||
        (!isBrowserPreview && providers[activeController].state !== "authenticated"),
      onRun: () => void startControllerSession(),
    },
    {
      id: "stop-controller-session",
      label: "Stop controller session",
      detail: activeControllerSession?.state === "stopping" ? "Waiting for the process to exit" : "Stop the current new-session process",
      group: "Controller",
      icon: CircleStop,
      disabled: activeControllerSession?.state !== "running",
      onRun: () => void stopControllerSession(),
    },
    { id: "ledger", label: "Open Ledger", detail: "Inspect ordered events and evidence", group: "Views", icon: LayoutList, shortcut: "⌘1", onRun: () => setWorkspaceView("ledger") },
    { id: "workshop", label: "Open Workshop", detail: "See mission flow through six functional rooms", group: "Views", icon: MapIcon, shortcut: "⌘2", onRun: () => setWorkspaceView("workshop") },
    { id: "console", label: "Toggle Login Console", detail: "Open purpose-bound provider sessions", group: "Workspace", icon: SquareTerminal, shortcut: "⌘J", onRun: () => setTerminalOpen((value) => !value) },
    { id: "missions", label: "Toggle Mission Explorer", detail: "Show or hide the mission list", group: "Workspace", icon: PanelLeftOpen, shortcut: "⌘B", onRun: () => setMissionExplorerOpen((value) => !value) },
    { id: "trust", label: "Open Trust Inspector", detail: "Review route receipt and approval state", group: "Go to", icon: ShieldCheck, onRun: () => setInspectorOpen(true) },
    { id: "connect-codex", label: "Connect Codex", detail: providers.codex.state === "authenticated" ? "Already connected" : "Open restricted Codex login", group: "Controller", icon: Braces, disabled: providers.codex.state === "authenticated", onRun: () => void startLogin("codex", "console") },
    { id: "connect-claude", label: "Connect Claude Console", detail: providers.claude.state === "authenticated" ? "Already connected" : "Production-recommended connection path", group: "Controller", icon: Code2, disabled: providers.claude.state === "authenticated", onRun: () => void startLogin("claude", "console") },
    { id: "appearance", label: "Appearance settings", detail: "System, light, dark, and atmosphere", group: "Settings", icon: Settings2, shortcut: "⌘,", onRun: () => setDisplayOpen(true) },
    { id: "create", label: "Create mission", detail: "Unavailable: no execution service is connected", group: "Missions", icon: Zap, disabled: true, onRun: () => undefined },
  ];

  if (booting) {
    return (
      <main className="bootScreen" aria-live="polite">
        <span className="bootMark">A</span>
        <div><strong>Preparing local control plane</strong><span>Detecting the protected desktop bridge…</span></div>
      </main>
    );
  }

  return (
    <div className="desktopApp" data-appearance={appearance} data-atmosphere={atmosphere}>
      <a className="skipLink" href="#workspace-main">Skip to workspace</a>
      <div className={`nativeTitlebar platform-${desktopApi.platform}`}>
        <span className="titlebarName">AOS</span>
        <span className="titlebarContext">{workspace?.name || "Setup"}</span>
        <span className="titlebarDrag" />
        <span className="titlebarStatus"><span className={isBrowserPreview ? "is-preview" : "is-live"} />{isBrowserPreview ? "Browser preview · simulated" : "Desktop host"}</span>
      </div>

      <div className="appBody">
        <aside className="primaryRail" aria-label="Primary navigation">
          <div className="railBrand" aria-label="AOS home">A</div>
          <nav>
            <button className="is-active" type="button" aria-label="Workbench" title="Workbench"><Activity size={20} /><span>Workbench</span></button>
            <button type="button" aria-label="Approvals" title="Approvals" onClick={() => setInspectorOpen(true)}><Inbox size={20} /><span>Approvals</span><em>1</em></button>
            <button type="button" aria-label="Missions" title="Missions" onClick={() => setMissionExplorerOpen(true)}><Layers3 size={20} /><span>Missions</span></button>
            <button type="button" aria-label="Models" title="Models" onClick={() => setToast("No real worker fleet is connected in this build.")}><Cpu size={20} /><span>Models</span></button>
            <button type="button" aria-label="Audit" title="Audit" onClick={() => setInspectorOpen(true)}><ReceiptText size={20} /><span>Audit</span></button>
          </nav>
          <div className="railSpacer" />
          <button type="button" aria-label="Toggle console" title="Console · ⌘J" onClick={() => setTerminalOpen((value) => !value)}><PanelBottom size={20} /><span>Console</span></button>
          <button type="button" aria-label="Appearance settings" title="Settings · ⌘," onClick={() => setDisplayOpen((value) => !value)}><Settings2 size={20} /><span>Settings</span></button>
        </aside>

        <div className="workspaceShell">
          <header className="workspaceHeader">
            <div className="headerIdentity">
              <button className="paneToggle" type="button" aria-label="Toggle mission explorer" aria-expanded={missionExplorerOpen} onClick={() => setMissionExplorerOpen((value) => !value)}>
                {missionExplorerOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              </button>
              <button className="workspaceButton" type="button" onClick={() => void chooseWorkspace()} title={workspace?.path}>
                <FolderGit2 size={18} />
                <span><small>Workspace</small><strong>{workspace?.name || "Choose workspace"}</strong></span>
                <ChevronDown size={14} />
              </button>
              <div className="controllerControl">
                <button className="controllerButton" type="button" aria-expanded={controllerMenuOpen} onClick={() => setControllerMenuOpen((value) => !value)}>
                  {activeController === "codex" ? <Braces size={17} /> : <Code2 size={17} />}
                  <span><small>Base controller</small><strong>{providerNames[activeController]}</strong></span>
                  <span className={`controllerHealth state-${providers[activeController].state}`}>{providerStatusLabel(providers[activeController])}</span>
                  <ChevronDown size={14} />
                </button>
                {controllerMenuOpen ? (
                  <div className="controllerPopover motionPopover" role="dialog" aria-label="Controller connections">
                    <header><div><p className="eyebrow">Workspace controller</p><h2>Choose new-session base</h2></div><button className="iconButton" type="button" aria-label="Close controller menu" onClick={() => setControllerMenuOpen(false)}><X size={17} /></button></header>
                    <p>Both providers can stay connected. AOS never changes an active session or transfers hidden context.</p>
                    {(["codex", "claude"] as ProviderId[]).map((provider) => (
                      <div className="controllerChoice" key={provider}>
                        <ProviderCard provider={provider} status={providers[provider]} selected={activeController === provider} onSelect={() => undefined} compact />
                        {providers[provider].state === "authenticated" ? (
                          <button className="textButton" type="button" disabled={provider === activeController} onClick={() => setSwitchTarget(provider)}>{provider === activeController ? "Active" : "Make controller"}</button>
                        ) : (
                          <button className="textButton" type="button" onClick={() => void startLogin(provider, "console")}>Connect</button>
                        )}
                      </div>
                    ))}
                    {activeController === "claude" ? <div className="legalNote"><AlertCircle size={15} /><span>Production distribution uses Claude Console or another approved enterprise connection—not personal Pro/Max subscription passthrough.</span></div> : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="headerActions">
              <button
                className="primaryButton headerSessionButton"
                type="button"
                disabled={
                  !controllerSessionBusy &&
                  (!workspace || (!isBrowserPreview && providers[activeController].state !== "authenticated"))
                }
                title={
                  controllerSessionBusy
                    ? "Open the active controller session"
                    : `Start a fresh ${providerNames[activeController]} session for this workspace`
                }
                onClick={() => {
                  if (controllerSessionBusy) {
                    setTerminalTab("run");
                    setTerminalOpen(true);
                  } else {
                    void startControllerSession();
                  }
                }}
              >
                {controllerState === "stopping" ? (
                  <RefreshCw size={16} className="spin" aria-hidden="true" />
                ) : controllerSessionBusy ? (
                  <Activity size={16} aria-hidden="true" />
                ) : (
                  <Play size={16} aria-hidden="true" />
                )}
                {controllerState === "starting"
                  ? "Starting…"
                  : controllerState === "stopping"
                    ? "Stopping…"
                    : controllerState === "running"
                      ? "Session active"
                      : isBrowserPreview
                        ? "Preview new session"
                        : "Start new session"}
              </button>
              <button className="commandTrigger" type="button" onClick={() => setCommandOpen(true)}><Search size={16} /><span>Commands</span><kbd>⌘K</kbd></button>
              <div className="viewSwitch" role="group" aria-label="Workspace view">
                <button type="button" aria-pressed={workspaceView === "ledger"} title="Ledger · ⌘1" onClick={() => setWorkspaceView("ledger")}><LayoutList size={17} /><span>Ledger</span></button>
                <button type="button" aria-pressed={workspaceView === "workshop"} title="Workshop · ⌘2" onClick={() => setWorkspaceView("workshop")}><MapIcon size={17} /><span>Workshop</span></button>
              </div>
              <button className="attentionButton" type="button" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}><PanelRightOpen size={17} /><span>Trust</span><em>1</em></button>
            </div>
          </header>

          <div className="truthBar" role="status">
            <span className="truthMode"><Sparkles size={14} />Preview mission data</span>
            <span><AlertTriangle size={14} />No worker runtime connected</span>
            <span>
              <Bot size={14} />
              {providerNames[activeController]} · {controllerSessionBusy ? `new session ${controllerState}` : "base for new sessions"}
            </span>
            {isBrowserPreview ? <span><Monitor size={14} />Browser preview · no CLI process or credential</span> : null}
          </div>

          <div className="workspaceLayout">
            <button className={`paneScrim missionScrim${missionExplorerOpen ? " is-open" : ""}`} type="button" tabIndex={-1} aria-label="Close mission explorer" onClick={() => setMissionExplorerOpen(false)} />
            <MissionExplorer selectedId={selectedMissionId} onSelect={(id) => { setSelectedMissionId(id); setLedgerTab("timeline"); }} open={missionExplorerOpen} onClose={() => setMissionExplorerOpen(false)} />
            <main id="workspace-main" className="workspaceMain" tabIndex={-1}>
              {workspaceView === "ledger" ? <LedgerView mission={selectedMission} tab={ledgerTab} onTab={setLedgerTab} /> : <WorkshopView selectedId={selectedMissionId} onSelect={(id) => setSelectedMissionId(id)} />}
            </main>
            <button className={`paneScrim trustScrim${inspectorOpen ? " is-open" : ""}`} type="button" tabIndex={-1} aria-label="Close trust inspector" onClick={() => setInspectorOpen(false)} />
            <TrustInspector mission={selectedMission} open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
          </div>
        </div>
      </div>

      <TerminalPanel
        open={terminalOpen}
        tab={terminalTab}
        onTab={setTerminalTab}
        activeLogin={activeLogin}
        activeSession={activeControllerSession}
        onCancel={async () => {
          if (!activeLogin) return;
          const { terminalId } = activeLogin;
          cancelledLoginTerminalIds.current.add(terminalId);
          try {
            await desktopApi.providers.login.cancel(terminalId);
            loginProviderBySession.current.delete(terminalId);
            terminalEvents.clear(terminalId);
            setActiveLogin(null);
          } catch (error) {
            cancelledLoginTerminalIds.current.delete(terminalId);
            setToast(error instanceof Error ? error.message : "The login session could not be cancelled.");
          }
        }}
        onClose={() => setTerminalOpen(false)}
        onError={setToast}
        onStopSession={stopControllerSession}
      />

      {displayOpen ? <DisplayPanel appearance={appearance} atmosphere={atmosphere} onAppearance={setAppearance} onAtmosphere={setAtmosphere} onClose={() => setDisplayOpen(false)} /> : null}
      {commandOpen ? <CommandPalette items={commandItems} onClose={() => setCommandOpen(false)} /> : null}
      {switchTarget ? <ControllerSwitchDialog current={activeController} target={switchTarget} state={controllerState} workspace={workspace} onConfirm={confirmSwitch} onClose={() => setSwitchTarget(null)} /> : null}
      {showOnboarding ? (
        <Onboarding
          step={onboardingStep}
          setStep={setOnboardingStep}
          providers={providers}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
          workspace={workspace}
          onDetect={detect}
          detecting={detecting}
          onStartLogin={startLogin}
          loginMode={loginMode}
          setLoginMode={setLoginMode}
          activeLogin={activeLogin}
          onChooseWorkspace={chooseWorkspace}
          choosingWorkspace={choosingWorkspace}
          onFinish={finishOnboarding}
          onPreview={explorePreview}
        />
      ) : null}
      {toast ? <div className="toast" role="status"><CheckCircle2 size={17} /><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div> : null}
      <div className="srOnly" aria-live="polite">{activeLogin ? `${providerNames[activeLogin.provider]} login ${activeLogin.state}` : ""}</div>
    </div>
  );
}
