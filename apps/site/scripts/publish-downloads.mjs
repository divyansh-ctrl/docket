// Publishes built installers to the download host and rewrites the site's
// manifest so the download page lists exactly what was uploaded.
//
//   node scripts/publish-downloads.mjs --dir ../../dist-release [--dry-run]
//
// The installers are 100 MB+ each, which is far above Cloudflare's 25 MiB
// per-file limit for Worker/Pages static assets, so they cannot live in this
// site's own bundle. They are uploaded to an R2 bucket instead and served from
// its public URL.
//
// One-time setup, in the Cloudflare dashboard and CLI:
//   1. Enable R2 on the account (dashboard -> R2).
//   2. npx wrangler r2 bucket create aos-downloads
//   3. Attach a public URL: either enable the managed r2.dev domain for the
//      bucket, or bind a custom domain such as downloads.example.com.
//   4. Put that origin in AOS_DOWNLOAD_BASE_URL (or pass --base-url).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const siteRoot = resolve(import.meta.dirname, "..");
const manifestPath = join(siteRoot, "downloads.json");

const BUCKET = process.env.AOS_DOWNLOAD_BUCKET ?? "aos-downloads";
const INSTALLER_PATTERN = /\.(dmg|zip|exe|deb|rpm)$/i;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceDirectory = resolve(readFlag("--dir") ?? join(siteRoot, "../../dist-release"));
const baseUrl = readFlag("--base-url") ?? process.env.AOS_DOWNLOAD_BASE_URL ?? "";

function readFlag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const files = (await readdir(sourceDirectory)).filter((name) => INSTALLER_PATTERN.test(name));
if (files.length === 0) {
  throw new Error(`No installers found in ${sourceDirectory}. Build them first.`);
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
  const bytes = await readFile(path);
  const size = (await stat(path)).size;
  const digest = createHash("sha256").update(bytes).digest("hex");
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
await writeFile(checksumPath, checksums);
if (!dryRun) {
  await execFileAsync(
    "npx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/SHA256SUMS.txt`, "--file", checksumPath, "--content-type", "text/plain", "--remote"],
    { cwd: siteRoot },
  );
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (baseUrl) manifest.baseUrl = baseUrl.replace(/\/$/, "");

const sizes = new Map(uploaded.map(({ file, size }) => [file, size]));
let missing = [];
for (const platform of Object.values(manifest.platforms)) {
  for (const asset of platform.assets) {
    const size = sizes.get(asset.file);
    if (size === undefined) missing.push(asset.file);
    else asset.size = size;
  }
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`\nWrote ${basename(manifestPath)} (${uploaded.length} files).\n`);
if (!manifest.baseUrl) {
  process.stdout.write("baseUrl is still empty: set --base-url or AOS_DOWNLOAD_BASE_URL, or the site will show downloads as unavailable.\n");
}
if (missing.length > 0) {
  // Loud, because a missing file means the page would link to a 404.
  process.stdout.write(`\nWARNING: listed in the manifest but not uploaded:\n  ${missing.join("\n  ")}\n`);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
