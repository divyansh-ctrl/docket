import { TABS, nextTab, type TabDefinition, type TabId } from "./tabs";

/**
 * The strip itself.
 *
 * `role="tablist"` with roving focus: one stop in the tab order, arrows move
 * between the tabs. That is the pattern screen readers announce as a tab strip,
 * and a row of plain buttons is not.
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

  return (
    <div className="tabBar" role="tablist" aria-label="Views">
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
            aria-controls={`panel-${tab.id}`}
            // Roving tabindex: the strip is one stop, arrows move within it.
            tabIndex={selected ? 0 : -1}
            disabled={!enabled}
            // The name is stated rather than left to be computed. With only a
            // `title` for the reason, the accessible name resolved to "Open a
            // repository first" and the tab announced as its own tooltip --
            // caught by reading the accessibility tree in the preview, not by
            // looking at it. The label and the reason are different things and
            // the reason belongs in the tooltip alone.
            aria-label={tab.label}
            title={enabled ? undefined : "Open a repository first"}
            className="tabButton"
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const target = nextTab(active, event.key === "ArrowRight" ? 1 : -1, openable);
              onSelect(target);
              document.getElementById(`tab-${target}`)?.focus();
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
