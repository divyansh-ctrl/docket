/**
 * One surface at a time, named.
 *
 * The app had four independent booleans deciding what was on screen --
 * `settingsOpen`, `providersOpen`, `officeOpen`, `terminalOpen` -- and nothing
 * stopped two of them being true at once. In practice they layered: a sheet
 * over a full-screen office over the floor, each with its own close button and
 * its own idea of what "back" meant.
 *
 * Four was already one too many, and the work ahead adds tabs for models, keys,
 * usage and MCP servers. Eight booleans with no shared rule would be a bug
 * waiting rather than a design.
 *
 * So: one `TabId`, one active surface, and the invariant is structural rather
 * than remembered.
 *
 * The navigation rules live here rather than in the component for the reason
 * the scene module exists beside `office-3d.tsx`: a rule the suite can hold is
 * one that stays true, and wrapping and skip behaviour is exactly the kind of
 * thing that quietly regresses inside a keydown handler.
 *
 * **Only tabs that exist appear here.** It is tempting to lay out the whole
 * planned set and leave the unbuilt ones disabled or empty, and it is the same
 * mistake as a packet with an empty section: a person reads a tab strip as a
 * description of what the app does. A tab is added when it has something behind
 * it.
 */

/** The surfaces that exist. Added to as each is built, never before. */
export const TAB_IDS = ["floor", "office", "agents", "providers"] as const;

export type TabId = (typeof TAB_IDS)[number];

export type TabDefinition = Readonly<{
  id: TabId;
  label: string;
  /** Why it is unavailable, or null when it can be opened. */
  requiresWorkspace: boolean;
}>;

export const TABS: readonly TabDefinition[] = Object.freeze([
  { id: "floor", label: "Floor", requiresWorkspace: false },
  { id: "office", label: "Office", requiresWorkspace: true },
  { id: "agents", label: "Agents", requiresWorkspace: false },
  { id: "providers", label: "Providers", requiresWorkspace: false },
]);

/**
 * The next tab under an arrow key, wrapping at both ends.
 *
 * Pure so the suite can hold it to the wrapping rule without a DOM. Disabled
 * tabs are skipped rather than landed on and silently ignored -- arrowing onto
 * something that cannot be opened is how a keyboard user loses their place.
 */
export function nextTab(
  current: TabId,
  direction: 1 | -1,
  openable: (tab: TabDefinition) => boolean,
): TabId {
  const usable = TABS.filter(openable);
  if (usable.length === 0) return current;
  const at = usable.findIndex((tab) => tab.id === current);
  // A current tab that is no longer openable lands on the first that is.
  if (at < 0) return usable[0].id;
  const next = (at + direction + usable.length) % usable.length;
  return usable[next].id;
}
