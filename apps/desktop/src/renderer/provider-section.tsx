/**
 * Providers as a place of their own, instead of a word inside a button.
 *
 * Before this, the only provider surface was "Run Codex" in the header: which
 * CLI Docket would drive was decided by a setting nothing on screen let you
 * change, and the setup tour showed the status of only the one already chosen.
 * This section shows both, says plainly what was detected about each, and lets
 * the controller be chosen -- at first start, from the setup tour, and any time
 * after from the sidebar.
 *
 * Status lines here are detection results, never aspirations: "not found" and
 * "not signed in" are shown in exactly those words. Signing in happens in the
 * provider's own flow inside a restricted terminal; the buttons for that land
 * here when that surface is built, and until then this section says so instead
 * of showing a control that silently does nothing.
 */
import type { ProviderId, ProviderViewStatus } from "./bridge";
import { Pane } from "./pane";

const NAMES: Record<ProviderId, string> = { codex: "Codex", claude: "Claude Code" };
const ORDER: readonly ProviderId[] = ["codex", "claude"];

function describe(status: ProviderViewStatus | undefined): string {
  if (!status) return "Not checked yet.";
  if (!status.available) return "Not found on this machine. Install it and sign in with it as you normally would.";
  const version = status.version ? ` ${status.version}` : "";
  switch (status.state) {
    case "authenticated":
      return `Found${version}. Signed in.`;
    case "installed_unauthenticated":
      return `Found${version}. Not signed in yet.`;
    case "expired":
      return `Found${version}. The sign-in has expired.`;
    case "error":
      return status.message ?? `Found${version}, but its state could not be read.`;
    default:
      return `Found${version}.`;
  }
}

export function ProviderSection({
  providers,
  controller,
  busy,
  onChoose,
}: {
  providers: Record<ProviderId, ProviderViewStatus> | null;
  controller: ProviderId;
  busy: boolean;
  onChoose: (provider: ProviderId) => void;
}) {
  return (
    <Pane tab="providers">
        <header className="sheetHead">
          <div>
            <h2>Providers</h2>
            <p>
              Docket drives a CLI you already have and are already signed in to. It never asks for
              an API key. Choose which one leads the session.
            </p>
          </div>
        </header>

        <ul className="providerList">
          {ORDER.map((id) => {
            const status = providers?.[id];
            const chosen = id === controller;
            return (
              <li key={id} className="providerRow" data-chosen={chosen}>
                <div className="providerMain">
                  <p className="providerName">
                    {NAMES[id]}
                    {chosen ? <span className="providerChosen">controller</span> : null}
                  </p>
                  <p className="providerState">{describe(status)}</p>
                </div>
                <button
                  type="button"
                  className={chosen ? "buttonQuiet" : "buttonSolid"}
                  disabled={busy || chosen || !status?.available}
                  title={
                    status?.available
                      ? undefined
                      : `${NAMES[id]} was not found, so it cannot lead the session.`
                  }
                  onClick={() => onChoose(id)}
                >
                  {chosen ? "Leading" : "Use as controller"}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="providerFoot">
          Signing in happens in the provider&apos;s own flow. A guided sign-in from this screen is
          not built yet; run <code>codex</code> or <code>claude</code> once in your terminal and
          Docket will detect the result.
        </p>
    </Pane>
  );
}
