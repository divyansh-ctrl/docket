// Publishes built installers to the download bucket and rewrites the site's
// manifest so the download page lists exactly what was uploaded.
//
//   node scripts/publish-downloads.mjs --dir ../../dist-release [--dry-run]
//
// The installers are 100 MB+ each, which is far above Cloudflare's 25 MiB
// per-file limit for Worker/Pages static assets, so they cannot live in this
// site's own bundle. They go to an R2 bucket instead.
//
// The bucket is NOT public. worker/index.ts reads it through a binding and
// streams each installer from the site's own origin, so no download URL ever
// names the storage. That is deliberate: a public r2.dev link would advertise
// both the provider and the bucket, and would let anyone enumerate builds
// outside the site. Hence no --base-url flag -- baseUrl stays "/download".
//
// One-time setup:
//   1. Enable R2 on the account (dashboard -> R2).
//   2. npx wrangler r2 bucket create docket-downloads
//   3. Uncomment the r2_buckets binding in wrangler.jsonc, then deploy.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const siteRoot = resolve(import.meta.dirname, "..");
// The manifest is served to the browser, so it lives with the static files.
const manifestPath = join(siteRoot, "public", "downloads.json");

// Must match the bucket bound as DOWNLOADS in wrangler.jsonc, or the Worker
// would read from a different bucket than this uploads to.
const BUCKET = process.env.AOS_DOWNLOAD_BUCKET ?? "docket-downloads";
const INSTALLER_PATTERN = /\.(dmg|zip|exe|deb|rpm)$/i;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceDirectory = resolve(readFlag("--dir") ?? join(siteRoot, "../../dist-release"));

function readFlag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const files = (await readdir(sourceDirectory)).filter((name) => INSTALLER_PATTERN.test(name));
if (files.length === 0) {
  throw new Error(`No installers found in ${sourceDirectory}. Build them first.`);
}

// Read the manifest up front. It is only rewritten at the end, but a bad path
// or malformed JSON should stop the run before it spends a gigabyte of
// uploads, not after.
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

// Every listed file must exist locally, for the same reason: discovering a
// missing installer after uploading is a warning nobody can act on until the
// next full build.
const available = new Set(files);
const listed = Object.values(manifest.platforms).flatMap((platform) => platform.assets.map((asset) => asset.file));
const missing = listed.filter((file) => !available.has(file));
if (missing.length > 0) {
  throw new Error(`Listed in the manifest but not in ${sourceDirectory}:\n  ${missing.join("\n  ")}`);
}

// Content types matter: without them browsers may render an installer inline
// or mislabel it on download.
const CONTENT_TYPES = {
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".deb": "application/vnd.debian.binary-package",
  ".rpm": "application/x-rpm",
};

const uploaded = [];
const checksumLines = [];

for (const file of files.sort()) {
  const path = join(sourceDirectory, file);
  const size = (await stat(path)).size;
  // Streamed rather than read whole: these run to 162 MB each.
  const digest = await sha256(path);
  checksumLines.push(`${digest}  ${file}`);
  uploaded.push({ file, size });

  const extension = file.slice(file.lastIndexOf("."));
  process.stdout.write(`${dryRun ? "would upload" : "uploading"} ${file} (${mb(size)})\n`);
  if (dryRun) continue;

  await execFileAsync(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `${BUCKET}/${file}`,
      "--file",
      path,
      "--content-type",
      CONTENT_TYPES[extension] ?? "application/octet-stream",
      "--remote",
    ],
    { cwd: siteRoot, maxBuffer: 32 * 1024 * 1024 },
  );
}

// The checksum file is generated here so it always matches what was actually
// uploaded, rather than being carried over from a previous build.
const checksums = `${checksumLines.join("\n")}\n`;
const checksumPath = join(sourceDirectory, "SHA256SUMS.txt");
if (!dryRun) {
  await writeFile(checksumPath, checksums);
  await execFileAsync(
    "npx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/SHA256SUMS.txt`, "--file", checksumPath, "--content-type", "text/plain", "--remote"],
    { cwd: siteRoot },
  );
}

manifest.version = version(files) ?? manifest.version;

const sizes = new Map(uploaded.map(({ file, size }) => [file, size]));
for (const platform of Object.values(manifest.platforms)) {
  for (const asset of platform.assets) {
    asset.size = sizes.get(asset.file) ?? asset.size;
  }
}

if (!dryRun) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(
  `\n${dryRun ? "Would write" : "Wrote"} ${basename(manifestPath)}: version ${manifest.version}, ${uploaded.length} files.\n`,
);

// Anything built but not listed is unreachable from the download page. Not an
// error -- extra architectures get built that the page does not offer -- but
// worth saying, since the usual cause is a manifest that was not updated.
const unlisted = files.filter((file) => !listed.includes(file));
if (unlisted.length > 0) {
  process.stdout.write(`\nUploaded but not listed on the page:\n  ${unlisted.join("\n  ")}\n`);
}

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// Read back from the filenames the build produced, so the page cannot claim a
// version that was never uploaded.
function version(names) {
  const versions = new Set();
  for (const name of names) {
    const match = /(\d+\.\d+\.\d+)/.exec(name);
    if (match) versions.add(match[1]);
  }
  return versions.size === 1 ? [...versions][0] : undefined;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
