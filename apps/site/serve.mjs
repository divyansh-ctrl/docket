// Zero-dependency static server for local development.
//
//   node apps/site/serve.mjs [port]
//
// Files are resolved from this file's own directory rather than the working
// directory, so it behaves the same wherever it is launched from.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import process from "node:process";

const root = import.meta.dirname;
const port = Number(process.argv[2] ?? process.env.PORT ?? 4321);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? "/", `http://localhost:${port}`);
    const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    // Refuse anything that climbs out of the site directory.
    if (relative.split(sep).includes("..")) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const target = join(root, relative === "" ? "index.html" : relative);
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, () => {
  process.stdout.write(`AOS site on http://localhost:${port}\n`);
});
