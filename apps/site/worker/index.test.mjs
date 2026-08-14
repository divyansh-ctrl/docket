// Exercises the download worker against stubbed storage, with no network and
// no deployment needed:
//
//   node --experimental-strip-types worker/index.test.mjs
//
// The worker gates every download, so the cases that matter here are the ones
// that fail closed: an unknown name, a name that tries to climb out of the
// bucket, and a missing token.
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = {
  default: {
    async match(key) {
      return store.get(key.url)?.clone();
    },
    async put(key, response) {
      store.set(key.url, response);
    },
  },
};

let calls = [];
const DRAFT_LISTING = JSON.stringify([
  { draft: true, assets: [{ name: "AOS-0.1.0-arm64.dmg", url: "https://api.example/assets/1" }] },
  { draft: false, assets: [{ name: "AOS-old.dmg", url: "https://api.example/assets/0" }] },
]);

globalThis.fetch = async (url, init) => {
  calls.push(String(url));
  if (String(url).includes("/releases")) {
    return new Response(DRAFT_LISTING, { status: 200 });
  }
  return new Response("BINARY", { status: 200, headers: { "content-length": "6" } });
};

const worker = (await import("./index.ts")).default;
const env = { BUILD_REPO: "owner/repo", BUILD_TOKEN: "t", ASSETS: { fetch: async () => new Response("site") } };
const context = { waitUntil() {} };

// A draft release must resolve: the build workflow only ever creates drafts.
const hit = await worker.fetch(new Request("https://d.test/download/AOS-0.1.0-arm64.dmg"), env, context);
assert.equal(hit.status, 200, "draft release asset should be served");
assert.equal(await hit.text(), "BINARY");
assert.equal(hit.headers.get("content-disposition"), 'attachment; filename="AOS-0.1.0-arm64.dmg"');
assert.equal(hit.headers.get("content-type"), "application/x-apple-diskimage");
assert.ok(calls.some((c) => c.includes("/releases?per_page")), "must list releases, not /releases/latest");
assert.ok(!calls.some((c) => c.includes("/releases/latest")), "/releases/latest excludes drafts");

// An unknown name must not reveal whether it exists upstream.
calls = [];
const miss = await worker.fetch(new Request("https://d.test/download/nope.dmg"), env, context);
assert.equal(miss.status, 404);
assert.ok(!(await miss.text()).toLowerCase().includes("github"), "404 must not name the storage provider");

// Traversal and odd names are refused before any upstream call.
for (const bad of ["../secret.dmg", "a/b.dmg", "shell.sh", ""]) {
  calls = [];
  const refused = await worker.fetch(new Request(`https://d.test/download/${encodeURIComponent(bad)}`), env, context);
  assert.equal(refused.status, 404, `${bad} should be refused`);
  assert.equal(calls.length, 0, `${bad} must not reach storage`);
}

// Non-download paths fall through to the static site untouched.
const site = await worker.fetch(new Request("https://d.test/"), env, context);
assert.equal(await site.text(), "site");

// Without a token configured there is nothing to serve, and it must not throw.
const unset = await worker.fetch(new Request("https://d.test/download/AOS-0.1.0-arm64.dmg"), { ASSETS: env.ASSETS }, context);
assert.equal(unset.status, 404);

console.log("all worker checks passed");
