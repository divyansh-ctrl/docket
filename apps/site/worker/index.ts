/**
 * Serves the Docket site and its installers from one origin.
 *
 * The installers are 100 MB+, well past the 25 MiB per-file limit for Worker
 * static assets, so they cannot be part of the site bundle. This Worker streams
 * them instead, from whichever storage is configured:
 *
 *   1. An R2 bucket, if the DOWNLOADS binding exists. Preferred: no egress
 *      cost, no third party in the path.
 *   2. Otherwise the private build storage, using a scoped token held as a
 *      Worker secret.
 *
 * Either way the visitor only ever sees this origin. No download URL, redirect,
 * or error message reveals where the build actually came from.
 */

interface Env {
  ASSETS: Fetcher;
  DOWNLOADS?: R2Bucket;
  BUILD_REPO?: string;
  BUILD_TOKEN?: string;
}

// Installer names are fixed by the build; anything else is refused before it
// can be used to probe storage.
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ALLOWED_EXTENSIONS = [".dmg", ".zip", ".exe", ".deb", ".rpm", ".txt"];

const CONTENT_TYPES: Record<string, string> = {
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".deb": "application/vnd.debian.binary-package",
  ".rpm": "application/x-rpm",
  ".txt": "text/plain; charset=utf-8",
};

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/download/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const name = decodeURIComponent(url.pathname.slice("/download/".length));
    if (!ASSET_NAME.test(name) || !ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      return new Response("Not found", { status: 404 });
    }

    const response = env.DOWNLOADS
      ? await fromBucket(env.DOWNLOADS, name, request)
      : await fromBuildStorage(env, name, request, context);

    return response ?? new Response("That download is not available yet.", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function downloadHeaders(name: string, extra: HeadersInit = {}): Headers {
  const extension = name.slice(name.lastIndexOf("."));
  const headers = new Headers(extra);
  headers.set("content-type", CONTENT_TYPES[extension] ?? "application/octet-stream");
  headers.set("content-disposition", `attachment; filename="${name}"`);
  // Installers are immutable once published, so they cache hard.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

async function fromBucket(bucket: R2Bucket, name: string, request: Request): Promise<Response | null> {
  // Range support matters here: a dropped 130 MB download should resume
  // rather than start over.
  const object = await bucket.get(name, { range: request.headers, onlyIf: request.headers });
  if (!object) return null;

  const headers = downloadHeaders(name);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");

  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }
  const partial = object.range !== undefined && request.headers.has("range");
  if (partial) {
    const { offset = 0, length = object.size } = object.range as { offset?: number; length?: number };
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
  }
  return new Response(object.body, { status: partial ? 206 : 200, headers });
}

async function fromBuildStorage(
  env: Env,
  name: string,
  request: Request,
  context: ExecutionContext,
): Promise<Response | null> {
  if (!env.BUILD_REPO || !env.BUILD_TOKEN) return null;

  const asset = await findAsset(env, name, context);
  if (!asset) {
    console.log(`download: ${name} is not in any listed release`);
    return null;
  }

  const upstream = await fetchAsset(asset.url, env.BUILD_TOKEN, request.headers.get("range"));
  if (!upstream?.ok) console.log(`download: ${name} fetch returned ${upstream?.status ?? "nothing"}`);
  // Never surface an upstream status or message: it would leak both the
  // storage provider and whether a given name exists there.
  if (!upstream || !upstream.ok || !upstream.body) return null;

  const headers = downloadHeaders(name);
  // Advertised unconditionally so a client knows it may resume at all; the
  // storage honours ranges whether or not this particular request used one.
  headers.set("accept-ranges", "bytes");
  for (const header of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  // 206 is passed through rather than normalized to 200: a client that asked
  // for a range and gets 200 assumes the whole body and writes it at the wrong
  // offset, silently corrupting a resumed download.
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}

/**
 * Fetches a release asset, following the redirect by hand.
 *
 * The API answers with a 302 to a pre-signed URL on a different host. The
 * credential must not follow it: a pre-signed URL that also carries an
 * Authorization header is rejected outright, and the Workers runtime forwards
 * request headers across redirects. Using redirect: "follow" therefore breaks
 * every download with no exception and nothing in the logs -- the Worker just
 * returns the same generic 404 it returns for a name that does not exist,
 * which is indistinguishable from a missing token or an unpublished release.
 */
async function fetchAsset(url: string, token: string, range: string | null): Promise<Response | null> {
  const authorized = await fetch(url, {
    headers: {
      accept: "application/octet-stream",
      authorization: `Bearer ${token}`,
      "user-agent": "docket-downloads",
    },
    redirect: "manual",
  });

  if (authorized.status < 300 || authorized.status >= 400) return authorized;

  const location = authorized.headers.get("location");
  if (!location) return null;

  // Second hop carries no credential: the signature in the URL is the auth.
  // The range rides on this hop rather than the first, where the API would
  // ignore it and answer with the redirect regardless.
  const headers = new Headers({ accept: "application/octet-stream" });
  if (range) headers.set("range", range);
  return fetch(location, { headers });
}

type BuildAsset = { name: string; url: string };

async function findAsset(env: Env, name: string, context: ExecutionContext): Promise<BuildAsset | null> {
  // The release listing is cached so a burst of downloads does not spend an
  // API call each; the binaries themselves stream straight through.
  const cacheKey = new Request(`https://docket.internal/releases/${env.BUILD_REPO}`);
  const cache = caches.default;
  let listing = await cache.match(cacheKey);

  if (!listing) {
    // Deliberately not /releases/latest: GitHub defines "latest" as the newest
    // non-draft, non-prerelease release. This listing also returns drafts, but
    // only to a token with push access, so a read-only token sees published
    // releases only.
    const fetched = await fetch(`https://api.github.com/repos/${env.BUILD_REPO}/releases?per_page=20`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.BUILD_TOKEN}`,
        "user-agent": "docket-downloads",
      },
    });
    if (!fetched.ok) {
      // Logged because the client response is deliberately indistinguishable
      // from every other failure, which once cost hours of guessing. 404 here
      // means the token cannot see the repository: GitHub answers 404 rather
      // than 403 for private resources, so this reads as "no such repo" even
      // when the name is right and only the token's repository access is wrong.
      console.log(`download: release listing failed with ${fetched.status}`);
      return null;
    }
    listing = new Response(await fetched.text(), {
      headers: { "content-type": "application/json", "cache-control": "max-age=300" },
    });
    context.waitUntil(cache.put(cacheKey, listing.clone()));
  }

  // First match wins, and the listing is newest first, so a re-released build
  // supersedes an older one carrying the same filename.
  const releases = (await listing.json()) as Array<{ assets?: BuildAsset[] }>;
  if (!Array.isArray(releases)) return null;
  for (const release of releases) {
    const asset = release.assets?.find((candidate) => candidate.name === name);
    if (asset) return asset;
  }
  return null;
}
