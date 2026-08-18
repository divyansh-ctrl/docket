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

## Two rows need conditions the demonstration cannot give you

Rows 6 and 7 ask you to watch a **seated** agent for half a minute. With no
session running, the floor is in demonstration mode, and demonstration mode
moves one agent to a different zone every 3.2 seconds -- so nobody stays
seated long enough to watch. Walking these rows against the demonstration is
not a strict test; it is an impossible one, and a row that cannot pass is a
row that gets skipped and then forgotten.

Walk them with **a session running**, where agents sit until a recorded event
moves them. This was found by trying: the first attempt at row 6 in the
packaged app failed for exactly this reason, not because anything was wrong
with the room.

Row 16 needs the OS reduced-motion preference turned on, which is a change to
your machine's settings. **It is a row for a person, not for an agent** --
Claude does not change system settings, so an automated walk will always
leave row 16 unwalked and must say so rather than pass it.

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
| 13 | Press each stage in the strip | The camera frames that stage. Empty stages are still pressable and still say zero. |
| 14 | Select an agent in the rail | Its card and its figure carry the same ring, in that agent's tone. |
| 15 | Escape, and Tab on open | Escape closes the office. On open, focus is inside it — the first Tab does not reach the page behind. |
| 16 | Turn on Reduce Motion in the OS, reopen *(person only — see above)* | Nobody walks or breathes; the waiting marker stops bobbing; framing a stage snaps rather than glides. Seated people are still seated. |

## Recorded walks

| Date | Themes walked | Result |
|------|---------------|--------|
| 2026-08-18 | dark only | Rows 1–5, 9, 12 walked in the browser preview: pass. 295 draw calls, 60fps median. **Light theme not walked** — the preview pane's scaling broke when the colour scheme was switched. Rows 6–8, 10, 11 not walked in this session; the seated-motion and gait rows are covered by invariants but not by eye. |
| 2026-08-18 | dark only | Phase 4. Rows 13–15 verified through the DOM rather than by eye — strip counts with empty stages kept, framing and selection both taking, the selected card measured as `--tone-lead`, focus inside the dialog, Escape closing it. **Row 16 not walked**: the OS reduced-motion preference cannot be toggled from the preview, so that path is implemented and unproven. Rows 6–8, 10, 11 still unwalked. |
| 2026-08-18 | dark only | Token accounting. The change touches the desk panel and the office stylesheet, and this gate caught it — the walk had been done but not recorded. Covered in the browser preview: row 1 (default framing intact, labels legible), row 13 (the stage strip unaffected), and the desk panel itself with the spend readout populated — the figures, the per-figure tooltips, and the sentence saying the total is the session's rather than the selected agent's. **Not covered:** rows 2–8, 10, 11, 15, 16, and the light theme. The panel change is DOM, not scene, so the scene rows were not re-walked. |
| 2026-08-18 | dark only | Phase 5, and the first walk in the **packaged app** rather than the browser preview. Pass: row 1 (whole plate, labels legible, nobody inside furniture), row 13 (all six stages present, zeroes dimmed but kept, counts tracking the floor live), row 14 (the selected agent's card and its figure carrying the same ring in the same tone — seen directly), and agents walking between zones. Zoom responds and lands in the room rather than under it. **Rows 6 and 7 could not be walked**: demonstration mode relocates an agent every 3.2s, so nothing stays seated — the reason the "two rows need conditions" section above now exists. **Row 16 not walked**: it needs an OS settings change, which is a person's to make. Rows 3, 5, 11, 12 and the light theme remain unwalked. |
