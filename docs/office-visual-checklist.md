# The office: the visual checklist

**Status:** in use
**Date:** 2026-08-18

A scene renderer cannot cheaply screenshot-diff in CI. Pixel comparison over a
WebGL canvas fails on driver differences and passes on the defects that
actually shipped here — a seat detached from its chair, a screen facing the
wrong way, a figure whose only moving part was its hands. None of those change
enough pixels to trip a threshold, and all of them are obvious to a person in
under a second.

So the automated half is the invariants in `tests/office-scene.test.mjs`, which
hold the geometry and the poses, and this is the other half: walked by hand
before an office PR merges, with the result written into the PR. A checklist
whose result is not recorded is not a check.

## How to walk it

```bash
npx vite --config vite.renderer.config.ts --port 5273
```

from `apps/desktop`, open a repository, open the Office. Walk every row in both
themes. The theme follows the OS setting and is read once when the office
mounts, so switch the OS appearance and reopen the office rather than expecting
it to change under you.

## The rows

| # | What to do | What must be true |
|---|---|---|
| 1 | Default framing | The whole floorplate is in shot with air around it. Every zone label is legible. No figure is inside furniture. |
| 2 | Zoom fully in on a pod | You arrive at a desk, not at a floorboard. The sitter, the screen and the keyboard are all in shot and on the same side of the desk. |
| 3 | Zoom fully out | The room stays in frame. Names have dropped; speech bubbles have not. |
| 4 | Zoom in and out repeatedly | The view keeps responding at both ends — slowing into each stop rather than hitting it. The wheel never reverses direction. |
| 5 | Orbit 180° | Glazing on all four sides; no missing wall, no camera under the slab, no view of the room's underside. |
| 6 | Watch one seated agent for 30s | The torso, head and legs move, not only the hands. Typing comes in bursts with visible pauses. |
| 7 | Watch the floor for 30s | Agents are not typing in unison. |
| 8 | Watch one agent walk | The knees bend on the backswing, the torso leans into the walk, and the path follows the aisle rather than crossing a desk. |
| 9 | Hover an agent | The floor ring fades in under that agent and no other. The intent line appears. |
| 10 | An agent waiting on you | The amber marker is visible from the default framing without hovering. |
| 11 | The plan view | Every state readable in the 3D floor is readable here too. |
| 12 | Console on open | One `office: N draw calls …` line. Compare N against the last recorded walk. |

## Recorded walks

| Date | Themes walked | Result |
|------|---------------|--------|
| 2026-08-18 | dark only | Rows 1–5, 9, 12 walked in the browser preview: pass. 295 draw calls, 60fps median. **Light theme not walked** — the preview pane's scaling broke when the colour scheme was switched. Rows 6–8, 10, 11 not walked in this session; the seated-motion and gait rows are covered by invariants but not by eye. |
