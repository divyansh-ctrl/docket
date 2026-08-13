import { constants as fsConstants } from "node:fs";
import { access, chmod, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// node-pty resolves its native code from the first directory that exists, in
// this order (see node-pty/lib/utils.js). Platforms with a published prebuild
// use it directly; Linux has no prebuild and is compiled by node-pty's own
// install script into build/Release.
const NATIVE_DIRECTORY_CANDIDATES = [
  "build/Release",
  "build/Debug",
  `prebuilds/${process.platform}-${process.arch}`,
];

// Files that must load for a PTY to start on each platform. Anything missing
// here means the packaged app would fail at the first login or session.
//
// spawn-helper is macOS-only: node-pty's binding.gyp guards that target with
// OS=="mac", so it is never built on Linux and must not be required there.
const REQUIRED_BINARIES = {
  darwin: ["pty.node", "spawn-helper"],
  linux: ["pty.node"],
  win32: ["pty.node", "conpty.node"],
};

// POSIX spawn-helper is exec'd directly by node-pty. npm, git, and zip all
// drop the executable bit, so it is restored on every install and package.
const EXECUTABLE_BINARIES = new Set(["spawn-helper"]);

const projectRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const moduleRoot = await realpath(join(projectRoot, "node_modules", "node-pty"));

const required = REQUIRED_BINARIES[process.platform];
if (!required) {
  throw new Error(
    `AOS desktop does not support ${process.platform}. Supported platforms are macOS, Linux, and Windows.`,
  );
}

const nativeDirectory = await resolveNativeDirectory();
if (!nativeDirectory) {
  throw new Error(buildInstructions());
}

const prepared = [];
for (const binary of required) {
  const binaryPath = await verifiedBinaryPath(nativeDirectory, binary);
  if (EXECUTABLE_BINARIES.has(binary)) {
    await chmod(binaryPath, 0o755);
    await access(binaryPath, fsConstants.X_OK);
  }
  prepared.push(binary);
}

process.stdout.write(
  `Prepared node-pty for ${process.platform}-${process.arch} from ${relative(moduleRoot, nativeDirectory)} (${prepared.join(", ")}).\n`,
);

async function resolveNativeDirectory() {
  for (const candidate of NATIVE_DIRECTORY_CANDIDATES) {
    const directory = join(moduleRoot, candidate);
    try {
      const canonical = await realpath(directory);
      assertWithinModule(canonical, dirname(directory));
      if (!(await stat(canonical)).isDirectory()) continue;
      // Existing is not the same as usable. On Windows a build/Release
      // directory is left behind without pty.node in it, and node-pty's own
      // loader falls through to the next candidate in exactly this case, so
      // a directory missing any required binary must not win here either.
      if (await containsAll(canonical, required)) return canonical;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function containsAll(directory, binaries) {
  for (const binary of binaries) {
    try {
      if (!(await stat(join(directory, binary))).isFile()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function verifiedBinaryPath(directory, binary) {
  const canonical = await realpath(join(directory, binary));
  assertWithinModule(canonical, directory);
  if (!(await stat(canonical)).isFile()) {
    throw new Error(`The node-pty ${binary} is not a regular file`);
  }
  return canonical;
}

// The original single-platform script refused to touch anything outside
// node_modules/node-pty. That containment check is kept for every platform so
// a tampered symlink cannot redirect a chmod outside the module.
function assertWithinModule(canonicalPath, expectedParent) {
  const difference = relative(moduleRoot, canonicalPath);
  if (!difference || difference.startsWith("..") || isAbsolute(difference)) {
    throw new Error(`Refusing to prepare a node-pty path outside the module: ${canonicalPath}`);
  }
  if (dirname(canonicalPath) !== expectedParent) {
    throw new Error(`Refusing to prepare an unexpected node-pty path: ${canonicalPath}`);
  }
}

function buildInstructions() {
  if (process.platform === "linux") {
    return [
      "node-pty has no published Linux prebuild and was not compiled during install.",
      "Install the build toolchain, then reinstall:",
      "  Debian/Ubuntu: sudo apt-get install -y python3 make g++",
      "  Fedora/RHEL:   sudo dnf install -y python3 make gcc-c++",
      "  Arch:          sudo pacman -S --needed python make gcc",
      "  then: npm rebuild node-pty --build-from-source",
    ].join("\n");
  }
  return `node-pty has no native build for ${process.platform}-${process.arch}. Run: npm rebuild node-pty --build-from-source`;
}
