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
  { draft: true, assets: [{ name: "Docket-0.1.0-arm64.dmg", url: "https://api.example/assets/1" }] },
  { draft: false, assets: [{ name: "Docket-old.dmg", url: "https://api.example/assets/0" }] },
]);

// Mirrors the real storage: the asset URL answers 302 to a pre-signed URL on
// another host, and only that second host serves bytes.
const SIGNED = "https://signed.example/blob?sig=abc";
let hops = [];

globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  calls.push(target);
  hops.push({ url: target, headers: new Headers(init.headers ?? {}), redirect: init.redirect });

  if (target.includes("/releases")) {
    return new Response(DRAFT_LISTING, { status: 200 });
  }
  if (target.startsWith("https://api.example/assets/")) {
    return new Response(null, { status: 302, headers: { location: SIGNED } });
  }
  const range = new Headers(init.headers ?? {}).get("range");
  if (range) {
    return new Response("BIN", {
      status: 206,
      headers: { "content-length": "3", "content-range": "bytes 0-2/6" },
    });
  }
  return new Response("BINARY", { status: 200, headers: { "content-length": "6" } });
};

const worker = (await import("./index.ts")).default;
const env = { BUILD_REPO: "owner/repo", BUILD_TOKEN: "t", ASSETS: { fetch: async () => new Response("site") } };
const context = { waitUntil() {} };

// A draft release must resolve: the build workflow only ever creates drafts.
const hit = await worker.fetch(new Request("https://d.test/download/Docket-0.1.0-arm64.dmg"), env, context);
assert.equal(hit.status, 200, "draft release asset should be served");
assert.equal(await hit.text(), "BINARY");
assert.equal(hit.headers.get("content-disposition"), 'attachment; filename="Docket-0.1.0-arm64.dmg"');
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
const unset = await worker.fetch(new Request("https://d.test/download/Docket-0.1.0-arm64.dmg"), { ASSETS: env.ASSETS }, context);
assert.equal(unset.status, 404);

// The credential must not follow the redirect. A pre-signed URL that also
// carries an Authorization header is rejected, and the runtime forwards
// headers across redirects, so "follow" breaks every download silently.
calls = [];
hops = [];
const viaRedirect = await worker.fetch(new Request("https://d.test/download/Docket-0.1.0-arm64.dmg"), env, context);
assert.equal(viaRedirect.status, 200);
assert.equal(await viaRedirect.text(), "BINARY");

const apiHop = hops.find((hop) => hop.url.startsWith("https://api.example/assets/"));
const signedHop = hops.find((hop) => hop.url === SIGNED);
assert.ok(apiHop, "the asset API must be called");
assert.equal(apiHop.redirect, "manual", "the redirect must not be followed automatically");
assert.ok(apiHop.headers.get("authorization"), "the API hop is the one that needs the credential");
assert.ok(signedHop, "the pre-signed URL must be fetched");
assert.equal(signedHop.headers.get("authorization"), null, "the credential must not reach the signed URL");

// A resumed download must come back as 206 with its range intact. Normalizing
// it to 200 makes the client write the partial body at the wrong offset.
hops = [];
const partial = await worker.fetch(
  new Request("https://d.test/download/Docket-0.1.0-arm64.dmg", { headers: { range: "bytes=0-2" } }),
  env,
  context,
);
assert.equal(partial.status, 206, "a ranged request must stay a 206");
assert.equal(partial.headers.get("content-range"), "bytes 0-2/6");
assert.equal(partial.headers.get("accept-ranges"), "bytes");
assert.equal(await partial.text(), "BIN");
assert.equal(
  hops.find((hop) => hop.url === SIGNED)?.headers.get("range"),
  "bytes=0-2",
  "the range belongs on the hop that serves bytes, not the API hop",
);

console.log("all worker checks passed");
