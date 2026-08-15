// Checks that the download manifest is internally consistent:
//
//   node scripts/check-downloads.mjs
//
// The manifest is the only thing standing between a visitor and a 404. Nothing
// validated it until now, and it has already been wrong once: when the Windows
// installer gained a version in its filename, the manifest kept listing
// `Docket-Setup.exe`, so the Windows download resolved to a name the build no
// longer produced.
//
// Every rule here is about the manifest agreeing with itself, never about
// agreeing with a build. Comparing against the desktop app's version would fail
// on every version bump, since the manifest describes the last published
// release rather than the code in the tree.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(new URL("../public/downloads.json", import.meta.url));

const problems = [];
const fail = (message) => problems.push(message);

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  console.error(`downloads.json does not parse: ${error.message}`);
  process.exit(1);
}

const { version, baseUrl, platforms, checksums } = manifest;

if (typeof version !== "string" || version.length === 0) {
  fail("version is missing or empty");
}

// The page's stated property is that no external host appears in any download
// link; the worker streams each file from storage on this origin. A baseUrl
// that stopped being a relative path would break that silently.
if (typeof baseUrl !== "string" || !baseUrl.startsWith("/")) {
  fail(`baseUrl must be a same-origin path starting with "/", got ${JSON.stringify(baseUrl)}`);
}

if (typeof checksums !== "string" || checksums.length === 0) {
  fail("checksums must name the published checksum file");
}

if (!platforms || typeof platforms !== "object" || Object.keys(platforms).length === 0) {
  fail("platforms is missing or empty");
} else {
  for (const [key, platform] of Object.entries(platforms)) {
    if (!platform?.name) fail(`${key}: missing name`);
    const assets = platform?.assets;
    if (!Array.isArray(assets) || assets.length === 0) {
      fail(`${key}: no assets listed`);
      continue;
    }

    for (const asset of assets) {
      const file = asset?.file;
      if (typeof file !== "string" || file.length === 0) {
        fail(`${key}: an asset has no file name`);
        continue;
      }
      if (typeof asset.label !== "string" || asset.label.length === 0) {
        fail(`${file}: missing label`);
      }
      // A filename without the version is the failure that already shipped.
      if (!file.includes(version)) {
        fail(`${file}: does not contain the manifest version ${version}`);
      }
      // A path separator or scheme here would escape the download route.
      if (file.includes("/") || file.includes("\\") || file.includes(":")) {
        fail(`${file}: must be a bare filename`);
      }
    }
  }
}

const names = Object.values(platforms ?? {})
  .flatMap((platform) => platform?.assets ?? [])
  .map((asset) => asset?.file)
  .filter((file) => typeof file === "string");
const duplicates = names.filter((file, index) => names.indexOf(file) !== index);
for (const file of new Set(duplicates)) fail(`${file}: listed more than once`);

if (problems.length > 0) {
  console.error(`downloads.json has ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`downloads.json is consistent: version ${version}, ${names.length} files.`);
