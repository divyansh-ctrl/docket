// Progressive enhancement only. With JavaScript blocked the page is still
// fully readable; the download lists are the one thing that needs the
// manifest, so they carry a plain fallback message in the markup.

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const supportsObserver = "IntersectionObserver" in window;

/* Reveals ----------------------------------------------------------------- */

function setupReveals() {
  const targets = document.querySelectorAll(".reveal");
  if (reducedMotion.matches || !supportsObserver) {
    targets.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const siblings = [...(entry.target.parentElement?.children ?? [])];
        const delay = Math.min(siblings.indexOf(entry.target), 6) * 55;
        setTimeout(() => entry.target.classList.add("is-visible"), delay);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
  );

  targets.forEach((element) => observer.observe(element));
}

/* Steps ------------------------------------------------------------------- */

function setupSteps() {
  const steps = [...document.querySelectorAll(".step")];
  if (steps.length === 0 || reducedMotion.matches || !supportsObserver) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle("is-current", entry.isIntersecting);
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );

  steps.forEach((step) => observer.observe(step));
}

/* Platform ---------------------------------------------------------------- */

function detectPlatform() {
  const platform = (navigator.userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  const haystack = `${platform} ${navigator.userAgent.toLowerCase()}`;
  if (/iphone|ipad|ipod|android/.test(haystack)) return null;
  if (/win/.test(haystack)) return "windows";
  if (/mac/.test(haystack)) return "mac";
  if (/linux|x11|cros/.test(haystack)) return "linux";
  return null;
}

function detectArch() {
  // Apple silicon is not reported directly; a WebGL renderer string is the
  // only broadly available hint, so an unknown result stays unknown rather
  // than guessing an architecture and offering the wrong binary.
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/apple\s+m\d/i.test(renderer)) return "arm64";
    if (/intel/i.test(renderer)) return "x64";
  } catch {
    // Fall through to unknown.
  }
  return null;
}

const LABELS = { mac: "Download for macOS", windows: "Download for Windows", linux: "Download for Linux" };

/* Downloads --------------------------------------------------------------- */

function formatSize(bytes) {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function renderPlatform(key, platform, baseUrl, preferredArch) {
  const list = document.querySelector(`[data-assets="${key}"]`);
  if (!list) return;

  const assets = [...platform.assets];
  // Put the visitor's likely architecture first so the obvious choice is the
  // right one, without hiding the alternative.
  if (preferredArch) {
    assets.sort((a, b) => Number(b.arch === preferredArch) - Number(a.arch === preferredArch));
  }

  list.replaceChildren(
    ...assets.map((asset) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `${baseUrl.replace(/\/$/, "")}/${asset.file}`;
      link.textContent = asset.label;
      const size = document.createElement("span");
      size.className = "assetSize";
      size.textContent = formatSize(asset.size);
      link.append(size);
      item.append(link);
      return item;
    }),
  );
}

function showStatus(message, tone = "warn") {
  const status = document.querySelector("[data-release-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = false;
}

async function setupDownloads() {
  const detected = detectPlatform();
  const note = document.querySelector("[data-platform-note]");

  if (detected) {
    const label = document.querySelector("[data-download-label]");
    if (label) label.textContent = LABELS[detected];
    const card = document.querySelector(`.platform[data-os="${detected}"]`);
    card?.classList.add("is-detected");
    const tag = card?.querySelector("[data-detected-tag]");
    if (tag) tag.hidden = false;
  }
  if (note) note.textContent = "Free · unsigned builds · macOS / Windows / Linux";

  try {
    const response = await fetch("/downloads.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(String(response.status));
    const manifest = await response.json();

    if (!manifest.baseUrl) {
      showStatus(
        "Builds are not published yet. The installers are ready but the download host is not configured, so these links are unavailable.",
      );
      return;
    }

    const arch = detected === "mac" ? detectArch() : "x64";
    for (const [key, platform] of Object.entries(manifest.platforms ?? {})) {
      renderPlatform(key, platform, manifest.baseUrl, arch);
    }
    showStatus(
      `Version ${manifest.version} · verify your download against ${manifest.checksums}.`,
      "info",
    );
  } catch {
    showStatus("The download list could not be loaded. Please try again shortly.");
  }
}

/* Review demo -------------------------------------------------------------
 *
 * A visitor plays the reviewer: read the evidence for each unit, then decide.
 * The point is that the decision is genuinely theirs -- the docs unit has an
 * open gate, so "Approve" is not the obviously correct answer. */

const UNITS = {
  implement: {
    facts: {
      model: "Qwen3-Coder-Next-FP8",
      placement: "private GPU · vLLM",
      egress: "none",
      cost: "$0.31 · 8m 04s",
    },
    diff: [
      ["meta", "auth/refresh.ts  +18 −6"],
      ["del", "- const token = readRefresh(req)"],
      ["add", "+ const token = readRefresh(req)"],
      ["add", "+ if (isReused(token)) {"],
      ["add", "+   await revokeFamily(token.familyId)"],
      ["add", "+   throw new AuthError('refresh reuse detected')"],
      ["add", "+ }"],
    ],
    gates: ["unit 42/42", "types clean", "reuse-detection test added"],
  },
  tests: {
    facts: {
      model: "gpt-oss-20B",
      placement: "local · llama.cpp",
      egress: "none",
      cost: "$0.00 · 2m 51s",
    },
    diff: [
      ["meta", "auth/refresh.test.ts  +64 −0"],
      ["add", "+ it('revokes the family when a refresh token is reused')"],
      ["add", "+ it('rejects a rotated token after its successor is used')"],
      ["add", "+ it('keeps unrelated sessions alive')"],
    ],
    gates: ["unit 42/42", "coverage +4.1%", "no network in tests"],
  },
  docs: {
    facts: {
      model: "Haiku 4.5",
      placement: "hosted · API",
      egress: "prompt only",
      cost: "$0.07 · 47s",
    },
    diff: [
      ["meta", "docs/auth.md  +12 −2"],
      ["del", "- Refresh tokens are long-lived."],
      ["add", "+ Refresh tokens rotate on every use."],
      ["meta", "  … claim not covered by any test"],
    ],
    // Deliberately unresolved: this is the judgement call the demo hands over.
    gates: ["style clean", "links valid", { label: "claim unverified", open: true }],
  },
};

function renderUnit(key) {
  const unit = UNITS[key];
  if (!unit) return;

  const facts = document.querySelector("[data-unit-facts]");
  facts.replaceChildren(
    ...Object.entries(unit.facts).map(([term, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }),
  );

  const diff = document.querySelector("[data-unit-diff]");
  const code = document.createElement("code");
  for (const [kind, line] of unit.diff) {
    const span = document.createElement("span");
    span.className = kind;
    span.textContent = `${line}\n`;
    code.append(span);
  }
  diff.replaceChildren(code);

  const gates = document.querySelector("[data-unit-gates]");
  gates.replaceChildren(
    ...unit.gates.map((gate) => {
      const label = typeof gate === "string" ? gate : gate.label;
      const open = typeof gate === "object" && gate.open;
      const element = document.createElement("span");
      element.className = open ? "gate is-open" : "gate";
      element.textContent = open ? `! ${label}` : `✓ ${label}`;
      return element;
    }),
  );
}

function setupReview() {
  const review = document.querySelector("[data-review]");
  if (!review) return;

  const tabs = [...review.querySelectorAll(".unitTab")];
  const panel = review.querySelector("#panel-unit");
  const outcome = review.querySelector("[data-outcome]");
  const chip = review.querySelector("[data-review-chip]");
  const prompt = review.querySelector("[data-review-prompt]");

  const select = (tab) => {
    for (const other of tabs) {
      const active = other === tab;
      other.setAttribute("aria-selected", String(active));
      other.tabIndex = active ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", tab.id);
    renderUnit(tab.dataset.unit);
  };

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab));
    // Arrow-key navigation is expected of a tablist.
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  }

  const settle = (kind) => {
    const approved = kind === "approved";
    outcome.hidden = false;
    outcome.className = `outcome ${approved ? "is-approved" : "is-changes"}`;
    outcome.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = approved ? "Approved by you" : "Changes requested";
    const body = document.createElement("span");
    body.textContent = approved
      ? "The receipt is stamped with your decision and the branch becomes eligible to merge. Docket never reaches this state on its own — the approval is the gate."
      : "The docs unit returns to its worker with your note attached. The other two units stay approved and are not re-run, because their evidence has not changed.";
    outcome.append(heading, body);
    chip.textContent = approved ? "Settled · approved" : "Settled · changes requested";
    chip.classList.add("is-settled");
    prompt.textContent = "Decision recorded. Reload to try the other answer.";
  };

  review.querySelector("[data-approve]").addEventListener("click", () => settle("approved"));
  review.querySelector("[data-changes]").addEventListener("click", () => settle("changes"));

  select(tabs[0]);
}

/* The table ---------------------------------------------------------------
 *
 * Selecting a seat shows what that unit is holding. Seats describe work and
 * models, never personas, which is the same line the product itself draws. */

const SEATS = {
  lead: {
    role: "lead · owns the thread",
    title: "Codex",
    facts: { holds: "the conversation", placement: "local CLI", replaced: "never" },
    note: "Your lead keeps the thread and hands out the work. Routing a unit to another model does not replace them, and swapping leads only ever applies to a new session.",
    // Each entry is what the seat is doing at that beat of the shift.
    shift: ["reading the request", "splitting into 3 units", "handing out work", "collecting evidence", "packaging for you"],
  },
  implement: {
    role: "engineer · high risk",
    title: "Qwen3-Coder-Next-FP8",
    facts: { unit: "refresh rotation", placement: "private GPU · vLLM", egress: "none", gates: "3 / 3" },
    note: "Earned this unit by passing tool-use, patching, and schema certification on your own hardware. High-risk work is pinned to private placement, so the code never leaves your machines.",
    shift: ["idle", "picking up the unit", "writing the reuse guard", "42/42 passing", "done · 3/3 gates"],
  },
  tests: {
    role: "test engineer · low risk",
    title: "gpt-oss-20B",
    facts: { unit: "reuse coverage", placement: "local · llama.cpp", egress: "none", gates: "3 / 3" },
    note: "The cheapest model that passed certification for test authoring. Runs entirely on your machine, so nothing is sent anywhere.",
    shift: ["idle", "waiting on the guard", "writing 3 cases", "coverage +4.1%", "done · 3/3 gates"],
  },
  docs: {
    role: "writer · low risk",
    title: "Haiku 4.5",
    facts: { unit: "auth.md", placement: "hosted · API", egress: "prompt only", gates: "2 / 3" },
    note: "One gate is still open: a documented claim is not covered by a test. Your writer flagged it instead of quietly shipping it, which is the judgement call that comes to you.",
    shift: ["idle", "reading the diff", "rewriting auth.md", "flagging a claim", "needs you · 2/3"],
  },
  review: {
    role: "reviewer · second pair of eyes",
    title: "Claude Sonnet",
    facts: { holds: "second opinion", placement: "hosted · API", egress: "diff only", gates: "advisory" },
    note: "Your reviewer reads the others' work but can never approve it. It only raises concerns, because approval is the one job on this team that stays yours.",
    shift: ["idle", "idle", "reading the guard", "no objection", "one note for you"],
  },
  open: {
    role: "open seat",
    title: "Hire a model",
    facts: { holds: "nothing", placement: "—", egress: "—", gates: "uncertified" },
    note: "Point Docket at a local llama.cpp or Ollama endpoint, or any OpenAI-compatible one. It only takes a seat on the team after passing certification on your hardware.",
    shift: ["—", "—", "—", "—", "—"],
  },
};

// How many units have cleared by each beat of the shift.
const CLEARED_BY_BEAT = [0, 0, 0, 2, 2];
const BEAT_MS = 2200;

// Where each teammate's cursor sits at each beat, as a fraction of the table
// box. "seat" means at their own chair, "table" means leaning into the shared
// work in the middle.
const CURSOR_PATH = {
  lead:      ["seat", "table", "table", "seat", "table"],
  implement: ["seat", "seat", "table", "table", "seat"],
  tests:     ["seat", "seat", "seat", "table", "table"],
  docs:      ["seat", "table", "table", "table", "seat"],
  review:    ["seat", "seat", "seat", "table", "table"],
};

function setupTable() {
  const table = document.querySelector("[data-table]");
  const agents = [...document.querySelectorAll(".agent")];
  const detail = document.querySelector("[data-seat-detail]");
  const layer = document.querySelector("[data-presence]");
  if (!table || agents.length === 0 || !detail || !layer) return;

  const reduce = reducedMotion.matches;
  const counter = document.querySelector("[data-centre-count]");

  // One cursor per working teammate, coloured and labelled like a presence
  // indicator in a shared document.
  const cursors = new Map();
  for (const agent of agents) {
    const key = agent.dataset.seat;
    if (!CURSOR_PATH[key]) continue;
    const cursor = document.createElement("div");
    cursor.className = "cursor";
    cursor.style.setProperty("--hue", getComputedStyle(agent).getPropertyValue("--hue"));
    cursor.innerHTML =
      '<svg viewBox="0 0 12 16" width="12" height="16"><path d="M0 0l12 7-5 1.5L4.5 14z" fill="currentColor"/></svg>';
    const label = document.createElement("span");
    label.className = "cursorLabel";
    label.textContent = agent.querySelector(".agentName").textContent;
    cursor.append(label);
    layer.append(cursor);
    cursors.set(key, cursor);
  }

  // Seat coordinates come from the same custom properties that place the
  // avatars, so the cursors and the people never drift apart.
  const seatPoint = (agent) => ({
    x: parseFloat(agent.style.getPropertyValue("--x")),
    y: parseFloat(agent.style.getPropertyValue("--y")),
  });

  const place = (key, where) => {
    const cursor = cursors.get(key);
    const agent = agents.find((a) => a.dataset.seat === key);
    if (!cursor || !agent) return;
    const seat = seatPoint(agent);
    // Leaning in: a third of the way from the chair toward the middle, with a
    // small offset so cursors do not stack on the exact centre.
    // Both targets are expressed as a fraction of the way toward the centre,
    // so a cursor can never leave the table. A flat offset pushed the
    // right-hand seats past 100% and onto the panel beside the table.
    const toward = (from, ratio) => from + (50 - from) * ratio;
    const target = where === "table"
      ? { x: toward(seat.x, 0.62), y: toward(seat.y, 0.62) }
      : { x: toward(seat.x, 0.18), y: toward(seat.y, 0.18) };
    const box = table.getBoundingClientRect();
    cursor.style.setProperty("--cx", `${(target.x / 100) * box.width}px`);
    cursor.style.setProperty("--cy", `${(target.y / 100) * box.height}px`);
  };

  const paint = (beat) => {
    for (const agent of agents) {
      const data = SEATS[agent.dataset.seat];
      const status = agent.querySelector("[data-status]");
      if (!data || !status) continue;
      const text = data.shift[beat] ?? data.shift.at(-1);
      status.textContent = text;
      const working = !/^(idle|—|done|no objection|holding)/.test(text);
      agent.classList.toggle("is-working", working && !reduce);
      agent.classList.toggle("is-flagged", text.startsWith("needs you"));
      if (CURSOR_PATH[agent.dataset.seat]) {
        place(agent.dataset.seat, CURSOR_PATH[agent.dataset.seat][beat] ?? "seat");
      }
    }
    if (counter) counter.textContent = `${CLEARED_BY_BEAT[beat] ?? 2} / 3`;
  };

  for (const agent of agents) agent.setAttribute("aria-pressed", "false");

  if (reduce || !supportsObserver) {
    paint(SEATS.lead.shift.length - 1);
  } else {
    let beat = 0;
    let timer = null;
    const run = () => {
      paint(beat);
      beat = (beat + 1) % SEATS.lead.shift.length;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && timer === null) {
            run();
            timer = setInterval(run, BEAT_MS);
          } else if (!entry.isIntersecting && timer !== null) {
            clearInterval(timer);
            timer = null;
          }
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(table);
    // Percentages become pixels, so the cursors need repositioning on resize.
    window.addEventListener("resize", () => paint(Math.max(0, beat - 1)), { passive: true });
  }

  // Your own presence, so the table reads as a room you are actually in.
  const self = document.querySelector("[data-self-cursor]");
  if (self && !reduce) {
    table.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const box = table.getBoundingClientRect();
      self.hidden = false;
      self.style.setProperty("--cx", `${event.clientX - box.left}px`);
      self.style.setProperty("--cy", `${event.clientY - box.top}px`);
    });
    table.addEventListener("pointerleave", () => {
      self.hidden = true;
    });
  }

  const show = (agent) => {
    const data = SEATS[agent.dataset.seat];
    if (!data) return;
    for (const other of agents) other.setAttribute("aria-pressed", String(other === agent));
    detail.style.setProperty("--hue", getComputedStyle(agent).getPropertyValue("--hue"));

    const role = document.createElement("span");
    role.className = "seatDetailRole";
    role.textContent = data.role;

    const title = document.createElement("h3");
    title.textContent = data.title;

    const list = document.createElement("dl");
    for (const [term, value] of Object.entries(data.facts)) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      list.append(row);
    }

    const note = document.createElement("p");
    note.className = "seatDetailNote";
    note.textContent = data.note;

    detail.replaceChildren(role, title, list, note);
  };

  for (const agent of agents) agent.addEventListener("click", () => show(agent));
  show(agents.find((agent) => agent.dataset.seat === "implement") ?? agents[0]);
}

setupReveals();
setupSteps();
setupReview();
setupTable();
void setupDownloads();
