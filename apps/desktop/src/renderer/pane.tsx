import type { ReactNode } from "react";
import type { TabId } from "./tabs";

/**
 * A surface the navigation switches to, rather than a dialog over the room.
 *
 * `role="tabpanel"` with the id its tab already claimed to control, and named
 * by that tab rather than by a repeated label -- so the tab and the panel are
 * one relationship stated once, and a screen reader can move between them.
 *
 * `tabIndex={0}` because a panel whose content is not focusable has to be
 * reachable itself, or a keyboard user selects a tab and lands nowhere.
 */
export function Pane({ tab, children }: { tab: TabId; children: ReactNode }) {
  return (
    <section className="pane" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
      <div className="paneInner">{children}</div>
    </section>
  );
}
