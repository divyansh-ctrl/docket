import { posix, win32, type PlatformPath } from "node:path";
import type { ProviderId } from "../shared/ipc-contract";

/**
 * Path rules follow the *target* platform rather than the host's. Using the
 * ambient node:path here would mean Windows layouts were compared with POSIX
 * separators whenever the logic ran anywhere but Windows, which also made the
 * Windows behaviour impossible to test from CI runners on other systems.
 */
function pathFor(context: PlatformContext): PlatformPath {
  return context.platform === "win32" ? win32 : posix;
}

export type PlatformId = "darwin" | "linux" | "win32";

export type PlatformContext = Readonly<{
  platform: PlatformId;
  home: string;
}>;

export type ProviderLayout = Readonly<{
  /** Launcher file names accepted for this provider, in preference order. */
  fileNames: readonly string[];
  /** Directories the launcher may live in. Nothing else on PATH is trusted. */
  directories: readonly string[];
  /**
   * Canonical launcher targets that are accepted outright. A symlinked
   * launcher must resolve to one of these paths, or fall inside one of the
   * containment roots below.
   */
  exactTargets: readonly string[];
  /**
   * Roots a canonical target may sit inside when the exact filename is
   * version-dependent and cannot be enumerated ahead of time.
   */
  containmentRoots: readonly string[];
  /**
   * Set when the launcher is a Node script rather than a native binary, in
   * which case a trusted `node` runtime must be found to run it.
   */
  script: Readonly<{ relativePath: string }> | null;
}>;

export const NVM_VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/;

export function isWindows(context: PlatformContext): boolean {
  return context.platform === "win32";
}

export function nvmRoot(context: PlatformContext): string {
  return pathFor(context).join(context.home, ".nvm", "versions", "node");
}

/**
 * Directories that hold globally installed CLIs on each platform. Only these
 * are searched, so a `codex` binary dropped anywhere else on PATH is ignored.
 */
export function systemBinDirectories(context: PlatformContext): readonly string[] {
  switch (context.platform) {
    case "darwin":
      return ["/opt/homebrew/bin", "/usr/local/bin"];
    case "linux":
      return ["/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"];
    case "win32":
      return [];
  }
}

export function providerLayout(provider: ProviderId, context: PlatformContext): ProviderLayout {
  return provider === "claude" ? claudeLayout(context) : codexLayout(context);
}

// Claude Code ships a native binary on every platform; it never runs under
// Node. The native installer keeps a launcher that points into a versioned
// directory, so the version component is matched by pattern.
function claudeLayout(context: PlatformContext): ProviderLayout {
  const { home } = context;
  const p = pathFor(context);
  if (context.platform === "win32") {
    const localAppData = p.join(home, "AppData", "Local");
    return {
      fileNames: ["claude.exe"],
      directories: [
        p.join(home, ".local", "bin"),
        p.join(localAppData, "Microsoft", "WinGet", "Links"),
      ],
      exactTargets: [],
      containmentRoots: [
        p.join(home, ".local", "share", "claude"),
        p.join(localAppData, "Microsoft", "WinGet", "Packages"),
      ],
      script: null,
    };
  }

  const nativeVersions = p.join(home, ".local", "share", "claude", "versions");
  const directories = [p.join(home, ".local", "bin"), ...systemBinDirectories(context)];
  if (context.platform === "darwin") {
    return {
      fileNames: ["claude"],
      directories,
      exactTargets: [],
      containmentRoots: [
        nativeVersions,
        // Homebrew publishes both a stable and a latest cask.
        "/opt/homebrew/Caskroom/claude-code",
        "/opt/homebrew/Caskroom/claude-code@latest",
        "/usr/local/Caskroom/claude-code",
        "/usr/local/Caskroom/claude-code@latest",
      ],
      script: null,
    };
  }

  return {
    fileNames: ["claude"],
    directories,
    exactTargets: [
      // apt, dnf, and apk install a real binary rather than a symlink.
      "/usr/bin/claude",
      "/usr/local/bin/claude",
    ],
    containmentRoots: [
      nativeVersions,
      "/usr/lib/claude-code",
      "/usr/share/claude-code",
      "/home/linuxbrew/.linuxbrew/Caskroom/claude-code",
    ],
    script: null,
  };
}

// Codex is distributed as an npm package whose bin entry is a Node script.
function codexLayout(context: PlatformContext): ProviderLayout {
  const { home } = context;
  const p = pathFor(context);
  const codexScript = p.join("node_modules", "@openai", "codex", "bin", "codex.js");

  if (context.platform === "win32") {
    // npm's global prefix on Windows. The .cmd shim is never executed: the
    // resolved script is handed to a trusted node.exe instead, so no shell is
    // involved.
    const npmPrefix = p.join(home, "AppData", "Roaming", "npm");
    return {
      fileNames: ["codex.cmd", "codex.exe"],
      directories: [npmPrefix],
      // The shim is a real file rather than a symlink, so it resolves to
      // itself. Trust comes from its location plus the separate check that the
      // package script exists under the same npm prefix.
      exactTargets: [p.join(npmPrefix, "codex.cmd"), p.join(npmPrefix, "codex.exe")],
      containmentRoots: [p.join(npmPrefix, "node_modules", "@openai", "codex")],
      script: { relativePath: codexScript },
    };
  }

  const prefixes = context.platform === "darwin"
    ? ["/opt/homebrew", "/usr/local", p.join(home, ".npm-global")]
    : ["/usr/local", "/usr", "/home/linuxbrew/.linuxbrew", p.join(home, ".npm-global")];

  return {
    fileNames: ["codex"],
    directories: [...systemBinDirectories(context), p.join(home, ".npm-global", "bin")],
    exactTargets: prefixes.map((prefix) =>
      p.join(prefix, "lib", "node_modules", "@openai", "codex", "bin", "codex.js"),
    ),
    containmentRoots: [],
    script: { relativePath: p.join("lib", codexScript) },
  };
}

/** Every directory the launcher may be found in, including NVM version bins. */
export function allowedDirectories(
  provider: ProviderId,
  context: PlatformContext,
  nvmVersions: readonly string[] = [],
): readonly string[] {
  const layout = providerLayout(provider, context);
  if (provider === "claude" || isWindows(context)) return layout.directories;
  return [
    ...layout.directories,
    ...nvmVersions.map((version) => pathFor(context).join(nvmRoot(context), version, "bin")),
  ];
}

export function isAllowedExecutableDirectory(
  provider: ProviderId,
  directory: string,
  context: PlatformContext,
): boolean {
  const normalized = normalizePath(directory, context);
  if (
    allowedDirectories(provider, context).some((candidate) =>
      pathsEqual(candidate, normalized, context),
    )
  ) {
    return true;
  }
  // NVM installs a separate bin directory per Node version, so those are
  // matched structurally rather than enumerated.
  return provider === "codex" && !isWindows(context) && isNvmBinDirectory(normalized, context);
}

export function isNvmBinDirectory(directory: string, context: PlatformContext): boolean {
  const difference = pathFor(context).relative(
    normalizePath(nvmRoot(context), context),
    normalizePath(directory, context),
  );
  const parts = difference.split(/[\\/]/);
  return parts.length === 2 && NVM_VERSION_PATTERN.test(parts[0] ?? "") && parts[1] === "bin";
}

/**
 * Decides whether a launcher's canonical target is a genuine provider install.
 * This is the control that stops a symlink named `codex` in a trusted
 * directory from pointing at an attacker-supplied binary elsewhere.
 */
export function isTrustedProviderLayout(
  provider: ProviderId,
  invocationPath: string,
  canonicalPath: string,
  context: PlatformContext,
): boolean {
  const layout = providerLayout(provider, context);
  const invocation = normalizePath(invocationPath, context);
  const target = normalizePath(canonicalPath, context);

  if (!layout.fileNames.some((name) => baseName(invocation).toLowerCase() === name.toLowerCase())) {
    return false;
  }
  if (!isAllowedExecutableDirectory(provider, directoryName(invocation), context)) return false;

  if (layout.exactTargets.some((candidate) => pathsEqual(candidate, target, context))) return true;

  if (provider === "codex" && !isWindows(context) && isNvmBinDirectory(directoryName(invocation), context)) {
    const versionRoot = directoryName(directoryName(invocation));
    return pathsEqual(
      pathFor(context).join(versionRoot, "lib", "node_modules", "@openai", "codex", "bin", "codex.js"),
      target,
      context,
    );
  }

  // A launcher that is a real file rather than a symlink resolves to itself.
  if (pathsEqual(invocation, target, context)) {
    return layout.containmentRoots.length === 0
      ? false
      : isWithinAnyRoot(target, layout.containmentRoots, context);
  }

  return isWithinAnyRoot(target, layout.containmentRoots, context);
}

function isWithinAnyRoot(
  target: string,
  roots: readonly string[],
  context: PlatformContext,
): boolean {
  return roots.some((root) => {
    const difference = pathFor(context).relative(normalizePath(root, context), target);
    if (!difference || difference.startsWith("..") || isAbsoluteLike(difference)) return false;
    const parts = difference.split(/[\\/]/);
    // The first path segment under a versioned root must look like a version,
    // so an unrelated sibling directory cannot be accepted.
    return SEMVER_PATTERN.test(stripExecutableSuffix(parts[0] ?? "")) || parts.length === 1;
  });
}

function stripExecutableSuffix(value: string): string {
  return value.replace(/\.exe$/i, "");
}

/**
 * Environment handed to provider processes. It is built from scratch rather
 * than inherited so a poisoned PATH or SHELL in the app's environment cannot
 * reach the CLI. Windows needs a handful of variables or process creation and
 * DLL loading fail outright.
 */
export function safeProviderEnvironment(
  context: PlatformContext,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const shared = ["LANG", "LC_ALL", "LC_CTYPE", "TERM"];
  const names = isWindows(context)
    ? [
        ...shared,
        "SystemRoot",
        "SystemDrive",
        "windir",
        "COMSPEC",
        "PATHEXT",
        "TEMP",
        "TMP",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "USERNAME",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
      ]
    : [...shared, "HOME", "TMPDIR", "USER", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"];

  return Object.fromEntries(names.flatMap((name) => (source[name] ? [[name, source[name]]] : [])));
}

export function providerEnvironment(
  executableDirectory: string,
  runtimeDirectory: string | null,
  context: PlatformContext,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = safeProviderEnvironment(context, source);
  const systemRoot = isWindows(context) ? (environment.SystemRoot ?? "C:\\Windows") : null;
  const baseDirectories = systemRoot
    ? [
        win32.join(systemRoot, "system32"),
        systemRoot,
        win32.join(systemRoot, "System32", "Wbem"),
      ]
    : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

  environment.PATH = [runtimeDirectory, executableDirectory, ...baseDirectories]
    .filter((directory, index, values): directory is string =>
      Boolean(directory) && values.indexOf(directory) === index,
    )
    .join(pathFor(context).delimiter);
  return environment;
}

export function pathsEqual(left: string, right: string, context: PlatformContext): boolean {
  const a = normalizePath(left, context);
  const b = normalizePath(right, context);
  return isWindows(context) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function isWithinCanonicalPrefix(
  root: string,
  path: string,
  context: PlatformContext,
): boolean {
  const difference = pathFor(context).relative(
    normalizePath(root, context),
    normalizePath(path, context),
  );
  return difference !== "" && !difference.startsWith("..") && !isAbsoluteLike(difference);
}

function normalizePath(value: string, context: PlatformContext): string {
  const p = pathFor(context);
  const normalized = p.normalize(value);
  return normalized.length > 1 && normalized.endsWith(p.sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function baseName(value: string): string {
  return value.split(/[\\/]/).pop() ?? "";
}

function directoryName(value: string): string {
  const parts = value.split(/[\\/]/);
  parts.pop();
  return parts.join(value.includes("\\") ? "\\" : "/") || "/";
}

function isAbsoluteLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value);
}
