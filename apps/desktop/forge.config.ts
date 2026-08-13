import type { ForgeConfig } from "@electron-forge/shared-types";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const APP_DESCRIPTION = "A secure local desktop control plane for Codex and Claude Code.";
const HOMEPAGE = "https://github.com/aos-project/aos";
const MAINTAINER = "AOS Project";

// Packager appends the platform-correct extension (.icns on macOS, .ico on
// Windows). Linux icons are supplied per maker below.
const ICON_BASE = "./assets/icon";

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.aos.desktop",
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
    executableName: "aos",
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
    osxSign: process.env.AOS_SIGN_MAC_APP === "1" ? {} : undefined,
    osxNotarize:
      process.env.AOS_NOTARIZE_MAC_APP === "1"
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
        name: "aos",
        setupIcon: "./assets/icon.ico",
        setupExe: "AOS-Setup.exe",
      },
    },
    {
      // Requires dpkg and fakeroot on the build machine.
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "aos",
          productName: "AOS",
          genericName: "Agent Operations System",
          description: APP_DESCRIPTION,
          categories: ["Development"],
          maintainer: MAINTAINER,
          homepage: HOMEPAGE,
          icon: "./assets/icon.png",
        },
      },
    },
    {
      // Requires rpmbuild on the build machine.
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          name: "aos",
          productName: "AOS",
          genericName: "Agent Operations System",
          description: APP_DESCRIPTION,
          categories: ["Development"],
          homepage: HOMEPAGE,
          icon: "./assets/icon.png",
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
  if (!value) throw new Error(`${name} is required when AOS_NOTARIZE_MAC_APP=1`);
  return value;
}

export default config;
