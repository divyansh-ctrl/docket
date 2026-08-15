import type { ForgeConfig } from "@electron-forge/shared-types";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read rather than hardcoded: the installer name has to move with the version
// or two releases produce the same filename, and which one a download resolves
// to then depends on release ordering rather than on what was asked for.
const VERSION = (JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string })
  .version;

const APP_DESCRIPTION = "A local team room for coding agents. Runs the CLI you already have.";
const HOMEPAGE = "https://docket.dev";
const MAINTAINER = "Docket";

// Packager appends the platform-correct extension (.icns on macOS, .ico on
// Windows). Linux icons are supplied per maker below.
const ICON_BASE = "./assets/icon";

const SIGNING_REQUESTED = process.env.DOCKET_SIGN_MAC_APP === "1";
const NOTARIZATION_REQUESTED = process.env.DOCKET_NOTARIZE_MAC_APP === "1";

// Notarization submits a signed bundle; Apple rejects an unsigned one. Catching
// the combination here turns a confusing failure minutes into an upload into an
// immediate one with the reason attached.
if (NOTARIZATION_REQUESTED && !SIGNING_REQUESTED) {
  throw new Error(
    "DOCKET_NOTARIZE_MAC_APP=1 requires DOCKET_SIGN_MAC_APP=1: an unsigned app cannot be notarized.",
  );
}

/**
 * Proves the app was actually signed, and fails the build when it was not.
 *
 * Requesting signing used to be a silent no-op. With `DOCKET_SIGN_MAC_APP=1`
 * and no certificate on the machine, the build printed every step green, never
 * mentioned signing once, and produced an ad-hoc binary that Gatekeeper
 * rejects. A release pipeline wired to that flag would publish unsigned
 * artifacts and report success, which is worse than not supporting signing:
 * the pipeline would be lying rather than merely incapable.
 *
 * So the outcome is verified rather than assumed. `codesign` has to report a
 * real Developer ID team, not `adhoc` and not `linker-signed`.
 */
/**
 * Re-signs the bundle ad-hoc when there is no Developer ID certificate.
 *
 * This does not satisfy Gatekeeper and is not a substitute for signing. It
 * fixes a different problem: the packager rewrites `Info.plist` to set the
 * bundle identifier and name, which invalidates the signature Electron's own
 * binary arrived with. The result reports `com.github.Electron` as its signing
 * identifier while the plist says `com.docket.desktop`, and `codesign --verify`
 * rejects it outright as modified.
 *
 * An invalid signature is worse than an absent one. Apple silicon refuses to
 * execute a binary whose signature does not validate, so this is a latent
 * launch failure rather than only a distribution inconvenience, and hardened
 * runtime later requires a coherent signature to build on.
 *
 * Ad-hoc signing costs nothing and makes the bundle internally consistent.
 */
async function adHocSign(appPath: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  // --deep is deprecated for signing a real distribution, where each nested
  // binary should be signed on its own terms. For an ad-hoc pass whose only
  // job is internal consistency it is the right tool.
  await run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  await run("codesign", ["--verify", "--deep", "--strict", appPath]);
}

async function assertSigned(appPath: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  let output: string;
  try {
    // codesign writes its report to stderr.
    const result = await run("codesign", ["--display", "--verbose=2", appPath]);
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Signing was requested but ${appPath} carries no usable signature: ${detail}`);
  }

  if (/Signature=adhoc/.test(output) || /linker-signed/.test(output)) {
    throw new Error(
      `Signing was requested but ${appPath} is only ad-hoc signed. ` +
        "No Developer ID certificate was found. Install one, or unset DOCKET_SIGN_MAC_APP " +
        "so the build is honestly unsigned rather than falsely reported as signed.",
    );
  }
  if (!/TeamIdentifier=[A-Z0-9]/.test(output)) {
    throw new Error(`Signing was requested but ${appPath} has no team identifier.`);
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.docket.desktop",
    appCategoryType: "public.app-category.developer-tools",
    icon: ICON_BASE,
    asar: {
      // node-pty is unpacked whole rather than by prebuild path: besides the
      // .node binaries, it needs spawn-helper (macOS/Linux), the winpty and
      // conpty helper binaries (Windows), and a forkable console-list agent
      // script. Those are not *.node files, so the auto-unpack plugin alone
      // would leave them stranded inside the archive.
      unpack: "**/node_modules/node-pty/**",
    },
    executableName: "docket",
    ignore: (filePath) => {
      if (!filePath) return false;
      if (filePath.endsWith(".js.map")) return true;
      return !(
        filePath.startsWith("/.vite") ||
        // Runtime window icon for Linux, where there is no bundle to read it from.
        filePath === "/assets" ||
        filePath === "/assets/icon.png" ||
        filePath === "/node_modules" ||
        filePath.startsWith("/node_modules/node-pty") ||
        filePath.startsWith("/node_modules/node-addon-api")
      );
    },
    // The identity is named when one is supplied. Left to auto-discovery, a
    // machine holding several certificates signs with whichever is found first,
    // which is not a property a release should depend on.
    osxSign: SIGNING_REQUESTED
      ? process.env.APPLE_SIGNING_IDENTITY
        ? { identity: process.env.APPLE_SIGNING_IDENTITY }
        : {}
      : undefined,
    osxNotarize: NOTARIZATION_REQUESTED
      ? {
          appleId: requireEnv("APPLE_ID"),
          appleIdPassword: requireEnv("APPLE_ID_PASSWORD"),
          teamId: requireEnv("APPLE_TEAM_ID"),
        }
      : undefined,
  },
  rebuildConfig: {
    onlyModules: ["node-pty"],
  },
  hooks: {
    // A build that claims to sign has to prove it (assertSigned); a build that
    // does not sign still has to leave a bundle that validates (adHocSign).
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== "darwin") return;
      for (const outputPath of packageResult.outputPaths) {
        const entries = await readdir(outputPath);
        const bundle = entries.find((entry) => entry.endsWith(".app"));
        if (!bundle) throw new Error(`No .app bundle was produced in ${outputPath}`);
        const appPath = join(outputPath, bundle);

        if (SIGNING_REQUESTED) await assertSigned(appPath);
        else await adHocSign(appPath);
      }
    },
    // Runs after @electron/rebuild, which still needs binding.gyp and the C++
    // sources. node-pty otherwise ships prebuilt binaries for four
    // platform/arch pairs, Windows debug symbols, the winpty source tree, and
    // its own TypeScript sources -- together far more than the download needs.
    packageAfterPrune: async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const moduleRoot = join(buildPath, "node_modules", "node-pty");
      await pruneForeignPrebuilds(moduleRoot, `${platform}-${arch}`);
      await pruneBuildOnlyFiles(moduleRoot);
      await pruneForeignConptyBinaries(moduleRoot, platform, arch);
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
      config: {},
    },
    {
      // Squirrel.Windows produces the Setup.exe users expect on Windows.
      // Building it requires a Windows host (or mono/wine elsewhere).
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "docket",
        authors: MAINTAINER,
        owners: MAINTAINER,
        description: APP_DESCRIPTION,
        setupIcon: "./assets/icon.ico",
        setupExe: `Docket-${VERSION}-Setup.exe`,
      },
    },
    {
      // Requires dpkg and fakeroot on the build machine.
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "docket",
          productName: "Docket",
          genericName: "Agent team room",
          description: APP_DESCRIPTION,
          categories: ["Development"],
          maintainer: MAINTAINER,
          homepage: HOMEPAGE,
          icon: "./assets/icon.png",
          // Must match packagerConfig.executableName, or the maker looks for
          // a binary named after the npm package and fails.
          bin: "docket",
          license: "Proprietary",
        },
      },
    },
    {
      // Requires rpmbuild on the build machine.
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          name: "docket",
          productName: "Docket",
          genericName: "Agent team room",
          description: APP_DESCRIPTION,
          categories: ["Development"],
          homepage: HOMEPAGE,
          icon: "./assets/icon.png",
          bin: "docket",
          license: "Proprietary",
        },
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
      concurrent: 2,
    }),
  ],
};

// Build-time inputs and intermediates. Deleting by name rather than keeping an
// allowlist means an unrecognized but load-bearing file is never removed.
const BUILD_ONLY_ENTRIES = [
  "src",
  "deps",
  "scripts",
  "node-addon-api",
  "binding.gyp",
  "bin", // @electron/rebuild's binary cache; node-pty loads from build/Release.
];
const BUILD_ONLY_ARTIFACTS = ["obj.target", "node-addon-api", ".deps", "Makefile", "binding.Makefile", "config.gypi", "gyp-mac-tool"];
const BUILD_ONLY_SUFFIXES = [".mk", ".stamp", ".pdb", ".o", ".test.js"];

async function pruneForeignPrebuilds(moduleRoot: string, keep: string): Promise<void> {
  const prebuilds = join(moduleRoot, "prebuilds");
  for (const entry of await listDirectory(prebuilds)) {
    if (entry !== keep) await rm(join(prebuilds, entry), { recursive: true, force: true });
  }
}

async function pruneBuildOnlyFiles(moduleRoot: string): Promise<void> {
  for (const entry of BUILD_ONLY_ENTRIES) {
    await rm(join(moduleRoot, entry), { recursive: true, force: true });
  }
  await pruneDirectory(join(moduleRoot, "build"));
  await pruneDirectory(join(moduleRoot, "build", "Release"));
  await pruneDirectory(join(moduleRoot, "lib"));
}

async function pruneDirectory(directory: string): Promise<void> {
  for (const entry of await listDirectory(directory)) {
    const removable =
      BUILD_ONLY_ARTIFACTS.includes(entry) ||
      BUILD_ONLY_SUFFIXES.some((suffix) => entry.endsWith(suffix));
    if (removable) await rm(join(directory, entry), { recursive: true, force: true });
  }
}

// node-pty vendors the ConPTY redistributable for both Windows architectures.
// Only Windows can use it, and only for its own architecture.
async function pruneForeignConptyBinaries(
  moduleRoot: string,
  platform: string,
  arch: string,
): Promise<void> {
  const thirdParty = join(moduleRoot, "third_party");
  if (platform !== "win32") {
    await rm(thirdParty, { recursive: true, force: true });
    return;
  }
  const conpty = join(thirdParty, "conpty");
  for (const version of await listDirectory(conpty)) {
    const versionDirectory = join(conpty, version);
    for (const entry of await listDirectory(versionDirectory)) {
      if (entry !== `win10-${arch}`) {
        await rm(join(versionDirectory, entry), { recursive: true, force: true });
      }
    }
  }
}

async function listDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when DOCKET_NOTARIZE_MAC_APP=1`);
  return value;
}

export default config;
