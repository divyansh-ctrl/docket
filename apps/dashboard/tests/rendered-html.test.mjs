import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the evidence-first workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Workbench · Docket<\/title>/i);
  assert.match(html, /Harden refresh-token rotation/);
  assert.match(html, /Execution path/);
  assert.match(html, /Controller/);
  assert.match(html, /Actual worker/);
  assert.match(html, /Interactive prototype/);
  assert.match(html, /Operational workshop/);
  assert.match(html, /Atmosphere/);
  assert.match(html, /Integrate: pending/);
  assert.match(html, /Simulated product data/);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});
