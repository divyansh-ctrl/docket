/**
 * The office's one check that a machine cannot make.
 *
 * Every other guarantee about the floor is a test: seats sit on chairs, knees
 * bend the way knees bend, no agent is counted twice. What no test here can
 * tell you is whether the room *looks* right, and the two defects that shipped
 * furthest -- figures whose only moving part was a pair of hands, and name
 * tags drawn a line below the heads they named -- were both invisible to
 * every assertion in the suite and obvious to a person in under a second.
 *
 * So the checklist exists, and this makes skipping it a decision rather than
 * an oversight: change the office, and the recorded-walks table has to gain a
 * row in the same change.
 *
 * It is worth being plain about the limit. Nothing here can tell whether the
 * walk happened -- a row saying "walked, fine" passes, and a person who wants
 * to lie to this gate will find it takes one line. That is not the failure
 * mode it is built for. It is built for the ordinary one: a small office
 * change, a green suite, and nobody remembering there was a checklist at all.
 */

/** The files whose change means the room might now look different. */
export const OFFICE_SOURCES = Object.freeze([
  "apps/desktop/src/renderer/office-3d.tsx",
  "apps/desktop/src/renderer/office-scene.ts",
  "apps/desktop/src/renderer/office-shell.ts",
  "apps/desktop/src/renderer/office-floor.tsx",
  "apps/desktop/src/renderer/office.tsx",
]);

export const CHECKLIST = "docs/office-visual-checklist.md";

/**
 * Whether a changed-file list touches the room.
 *
 * The stylesheet counts only when the change is inside the office's own
 * rules. It is one file for the whole app, so treating any edit to it as an
 * office change would make this gate fire on work that never opens the
 * office -- and a gate that cries wolf gets satisfied with junk rows, which
 * is worse than no gate.
 */
export function touchesOffice(
  changed: readonly string[],
  stylesheetDiff = "",
): boolean {
  if (changed.some((file) => OFFICE_SOURCES.includes(file))) return true;
  if (!changed.includes("apps/desktop/src/renderer/styles.css")) return false;
  return /^[+-].*\.(floor|desk|rail|stage|tag)/im.test(stylesheetDiff);
}

/**
 * How many walks the checklist records.
 *
 * Counts body rows under the "Recorded walks" heading, so adding a row to the
 * rows-to-walk table above it does not read as having walked them.
 */
export function countWalks(markdown: string): number {
  const heading = markdown.indexOf("## Recorded walks");
  if (heading < 0) return 0;
  const section = markdown.slice(heading);
  return section
    .split("\n")
    .filter((line) => {
      const row = line.trim();
      if (!row.startsWith("|") || !row.endsWith("|")) return false;
      const cells = row.slice(1, -1).split("|");
      if (cells.length < 3) return false;
      // Skip the header and its ---|---|--- rule.
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) return false;
      if (cells[0]?.trim().toLowerCase() === "date") return false;
      return cells.some((cell) => cell.trim().length > 0);
    }).length;
}

/**
 * The verdict, given what changed and the checklist before and after.
 *
 * Returns null when there is nothing to say. Everything else is a sentence
 * naming what is missing, because a gate that fails without saying which row
 * to add is a gate people learn to route around.
 */
export function verdict(
  changed: readonly string[],
  before: string,
  after: string,
  stylesheetDiff = "",
): string | null {
  if (!touchesOffice(changed, stylesheetDiff)) return null;
  const gained = countWalks(after) - countWalks(before);
  if (gained > 0) return null;
  const files = changed.filter(
    (file) => OFFICE_SOURCES.includes(file) || file.endsWith("styles.css"),
  );
  return [
    `This change touches the office (${files.join(", ")}) but records no walk.`,
    `Open the room, walk ${CHECKLIST}, and add a row to its "Recorded walks"`,
    `table saying which rows you covered -- including the ones you did not.`,
  ].join(" ");
}

/* ------------------------------------------------------------------ main -- */

/**
 * Run against a base commit: `node --experimental-strip-types
 * scripts/office-walk.ts <base-sha>`.
 *
 * Exits 0 with a sentence either way. Exit 1 is reserved for "you changed the
 * room and recorded no walk", which is the only thing this is here to catch.
 */
async function main(): Promise<number> {
  const { execFileSync } = await import("node:child_process");
  const base = process.argv[2];
  if (!base) {
    console.error("usage: office-walk.ts <base-sha>");
    return 2;
  }

  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() });

  const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  if (changed.length === 0) {
    console.log("office walk: nothing changed.");
    return 0;
  }

  const stylesheet = "apps/desktop/src/renderer/styles.css";
  const stylesheetDiff = changed.includes(stylesheet)
    ? git("diff", `${base}...HEAD`, "--", stylesheet)
    : "";

  if (!touchesOffice(changed, stylesheetDiff)) {
    console.log("office walk: this change does not touch the room.");
    return 0;
  }

  // The checklist as it was, and as it is. A file that did not exist at the
  // base is an empty string, which counts zero walks -- correct, and the
  // reason this reads the blob rather than assuming the file is there.
  let before = "";
  try {
    before = git("show", `${base}:${CHECKLIST}`);
  } catch {
    before = "";
  }
  const { readFileSync } = await import("node:fs");
  const after = readFileSync(CHECKLIST, "utf8");

  const problem = verdict(changed, before, after, stylesheetDiff);
  if (problem) {
    console.error(`office walk: ${problem}`);
    return 1;
  }
  console.log(
    `office walk: recorded (${countWalks(before)} -> ${countWalks(after)} walks).`,
  );
  return 0;
}

// Only when invoked directly, so the tests can import the functions above.
if (process.argv[1]?.endsWith("office-walk.ts")) {
  main().then((code) => process.exit(code));
}
