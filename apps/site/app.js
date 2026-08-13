// Progressive enhancement only. With JavaScript blocked the page is fully
// readable and every download link still resolves to the releases page.

const REPO = "divyansh-ctrl/aos";
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
        // Siblings resolve as a short cascade rather than all at once.
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

// Marks whichever stage is crossing the middle of the viewport, so the reader
// keeps their place in the sequence. Purely an accent on the index label.
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
  // Checked first: iPadOS reports a Mac platform, and there is no mobile build.
  if (/iphone|ipad|ipod|android/.test(haystack)) return null;
  if (/win/.test(haystack)) return "windows";
  if (/mac/.test(haystack)) return "mac";
  if (/linux|x11|cros/.test(haystack)) return "linux";
  return null;
}

const LABELS = {
  mac: "Download for macOS",
  windows: "Download for Windows",
  linux: "Download for Linux",
};

function setupPlatform() {
  const detected = detectPlatform();
  const note = document.querySelector("[data-platform-note]");

  if (!detected) {
    if (note) note.textContent = "Free · macOS / Windows / Linux";
    return;
  }

  const label = document.querySelector("[data-download-label]");
  if (label) label.textContent = LABELS[detected];

  const card = document.querySelector(`.platform[data-os="${detected}"]`);
  card?.classList.add("is-detected");
  const tag = card?.querySelector("[data-detected-tag]");
  if (tag) tag.hidden = false;
  if (note) note.textContent = "Free · unsigned builds · macOS / Windows / Linux";
}

/* Releases ---------------------------------------------------------------- */

function classifyAsset(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".dmg")) {
    return { os: "mac", label: lower.includes("arm64") ? "Apple silicon · dmg" : "Intel · dmg" };
  }
  if (lower.endsWith(".exe")) return { os: "windows", label: "Installer · exe" };
  if (lower.endsWith(".deb")) return { os: "linux", label: "Debian · deb" };
  if (lower.endsWith(".rpm")) return { os: "linux", label: "Fedora · rpm" };
  if (lower.endsWith(".zip")) {
    if (lower.includes("darwin")) return { os: "mac", label: "Zip archive" };
    if (lower.includes("win32")) return { os: "windows", label: "Zip archive" };
    if (lower.includes("linux")) return { os: "linux", label: "Zip archive" };
  }
  if (lower.startsWith("sha256sums")) return { os: "all", label: "Checksums" };
  return null;
}

function renderAssets(release) {
  const grouped = { mac: [], windows: [], linux: [] };
  for (const asset of release.assets ?? []) {
    const classified = classifyAsset(asset.name);
    if (!classified) continue;
    const entry = { label: classified.label, url: asset.browser_download_url };
    if (classified.os === "all") {
      for (const key of Object.keys(grouped)) grouped[key].push(entry);
    } else {
      grouped[classified.os].push(entry);
    }
  }

  let rendered = false;
  for (const [os, assets] of Object.entries(grouped)) {
    const list = document.querySelector(`[data-assets="${os}"]`);
    if (!list || assets.length === 0) continue;
    list.replaceChildren(
      ...assets.map(({ label, url }) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = url;
        link.rel = "noopener";
        link.textContent = label;
        item.append(link);
        return item;
      }),
    );
    rendered = true;
  }
  return rendered;
}

function showStatus(message) {
  const status = document.querySelector("[data-release-status]");
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
}

async function setupReleases() {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(String(response.status));
    const release = await response.json();
    if (!renderAssets(release)) throw new Error("no recognised assets");
    showStatus(`Latest release ${release.tag_name}. Check downloads against SHA256SUMS.txt.`);
  } catch {
    // A private or unreleased repository returns 404 to anonymous visitors.
    // The links already point at the releases page, so say so plainly rather
    // than presenting download buttons that lead nowhere.
    showStatus(
      "No published release yet — these links open the releases page. Builds appear once a version tag is pushed and the draft release is published.",
    );
  }
}

setupReveals();
setupSteps();
setupPlatform();
void setupReleases();
