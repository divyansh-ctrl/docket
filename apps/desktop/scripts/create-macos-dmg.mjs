// Builds a distributable .dmg for each packaged macOS architecture.
//
//   node scripts/create-macos-dmg.mjs              # every packaged arch
//   node scripts/create-macos-dmg.mjs --arch=arm64 # one arch
//
// A custom hdiutil script is used instead of @electron-forge/maker-dmg so the
// build does not depend on appdmg and its native dependency tree.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import process from "node:process";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const outDirectory = join(projectRoot, "out");

if (process.platform !== "darwin") {
  throw new Error("A .dmg can only be built on macOS (hdiutil and ditto are required).");
}

const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const requestedArchitectures = process.argv
  .filter((argument) => argument.startsWith("--arch="))
  .flatMap((argument) => argument.slice("--arch=".length).split(","))
  .filter(Boolean);

const architectures = requestedArchitectures.length
  ? requestedArchitectures
  : await packagedArchitectures();

if (architectures.length === 0) {
  throw new Error("No packaged macOS application was found in out/. Run electron-forge package first.");
}

for (const architecture of architectures) {
  await createDmg(architecture);
}

async function packagedArchitectures() {
  const entries = await readdir(outDirectory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("AOS-darwin-"))
    .map((entry) => entry.name.slice("AOS-darwin-".length));
}

async function createDmg(architecture) {
  if (!/^[a-z0-9]+$/.test(architecture)) {
    throw new Error(`Refusing to build a DMG for an unexpected architecture: ${architecture}`);
  }
  const packageDirectory = join(outDirectory, `AOS-darwin-${architecture}`);
  const appPath = join(packageDirectory, "AOS.app");
  const makeDirectory = join(outDirectory, "make", "dmg", architecture);
  const outputPath = join(makeDirectory, `AOS-${version}-${architecture}.dmg`);

  const canonicalApp = await realpath(appPath);
  if (canonicalApp !== appPath || basename(canonicalApp) !== "AOS.app") {
    throw new Error("Refusing to package an unexpected application path");
  }

  await mkdir(makeDirectory, { recursive: true });
  await rm(outputPath, { force: true });
  const stagingDirectory = await mkdtemp(join(tmpdir(), "aos-dmg-"));

  try {
    await execFileAsync("/usr/bin/ditto", [appPath, join(stagingDirectory, "AOS.app")]);
    await symlink("/Applications", join(stagingDirectory, "Applications"));
    const entries = (await readdir(stagingDirectory)).sort();
    if (entries.join(",") !== "AOS.app,Applications") {
      throw new Error("Unexpected DMG staging contents");
    }
    await execFileAsync("/usr/bin/hdiutil", [
      "create",
      "-volname",
      "AOS",
      "-srcfolder",
      stagingDirectory,
      "-format",
      "UDZO",
      "-ov",
      outputPath,
    ]);
    process.stdout.write(`Created ${outputPath}\n`);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
