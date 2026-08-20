import { TABS, nextTab, type TabDefinition, type TabId } from "./tabs";

/**
 * The navigation, in the rail beside everything it switches between.
 *
 * It began as a strip in the header and each tab opened a modal sheet over the
 * room. That made every surface a thing you were *in* and had to close, rather
 * than a place you were looking at, and it put the way out of a surface inside
 * the surface. Vertical in the rail, with the panels rendered in the body, the
 * navigation stays on screen and switching is one click from anywhere.
 *
 * `aria-orientation` is stated because it changes which arrow keys a screen
 * reader tells someone to use, and Home and End are here because a vertical
 * list long enough to want them is exactly what this is becoming.
 */
export function TabBar({
  active,
  workspaceOpen,
  onSelect,
}: {
  active: TabId;
  workspaceOpen: boolean;
  onSelect: (tab: TabId) => void;
}) {
  const openable = (tab: TabDefinition): boolean => !tab.requiresWorkspace || workspaceOpen;

  const move = (target: TabId): void => {
    onSelect(target);
    document.getElementById(`tab-${target}`)?.focus();
  };

  return (
    <div className="tabBar" role="tablist" aria-orientation="vertical" aria-label="Views">
      {TABS.map((tab) => {
        const enabled = openable(tab);
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            // Only the selected tab's panel is rendered, so only the selected
            // tab claims to control one. Set unconditionally -- as it was from
            // the start -- every tab pointed at an id that did not exist.
            aria-controls={selected ? `panel-${tab.id}` : undefined}
            // Roving tabindex: the strip is one stop, arrows move within it.
            tabIndex={selected ? 0 : -1}
            disabled={!enabled}
            // The name is stated rather than left to be computed. With only a
            // `title` for the reason, the accessible name resolved to "Open a
            // repository first" and the tab announced as its own tooltip --
            // caught by reading the accessibility tree, not by looking at it.
            // The label and the reason are different things and the reason
            // belongs in the tooltip alone.
            aria-label={tab.label}
            title={enabled ? undefined : "Open a repository first"}
            className="tabButton"
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              const usable = TABS.filter(openable);
              if (event.key === "Home" || event.key === "End") {
                if (usable.length === 0) return;
                event.preventDefault();
                move(usable[event.key === "Home" ? 0 : usable.length - 1].id);
                return;
              }
              // Left and right still work: the list reads as a list either way,
              // and taking away a key that used to move is a regression for
              // anyone who had learned it.
              const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
              const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
              if (!forward && !back) return;
              event.preventDefault();
              move(nextTab(active, forward ? 1 : -1, openable));
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
