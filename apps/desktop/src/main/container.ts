/**
 * Running a check inside a container instead of on the machine.
 *
 * A check is the repository's own script, and npm runs it in a shell. Until
 * now that shell had everything the person who launched Docket has: their SSH
 * keys, their cloud credentials, their whole filesystem, and the network. The
 * roadmap calls a Git worktree "not a security boundary" and this is the
 * sentence that makes it true -- the worktree isolates the *changes*, not the
 * process making them.
 *
 * Three decisions shape this module.
 *
 * **The runtime is optional.** Requiring Docker Desktop is the named weakness
 * of the closest comparable product, and a gate nobody can install gates
 * nothing. When no runtime is present the check still runs, on the host, and
 * says so.
 *
 * **Saying so is the point.** An unisolated run is weaker evidence than an
 * isolated one, and the difference has to reach the packet rather than being
 * flattened into a green tick. Every result carries how it ran and why.
 *
 * **Nothing here builds a shell string.** The runtime is spawned with a fixed
 * argument vector, exactly like the host path.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5_000;

/** Runtimes that accept the Docker CLI surface this module uses. */
const CANDIDATES = ["docker", "podman"] as const;
export type RuntimeName = (typeof CANDIDATES)[number];

export type RuntimeStatus = Readonly<{
  /** Null when nothing usable was found. */
  command: RuntimeName | null;
  /** Why there is no runtime, for the reader rather than for a log. */
  reason: string;
}>;

/**
 * The image checks run in.
 *
 * Pinned by digest-less tag deliberately for now: discovery only understands
 * npm scripts, so a Node image is the only coherent default, and a repository
 * needing something else is better served by an explicit setting later than by
 * a guess now. Alpine is avoided because native modules commonly fail on musl,
 * and a check that fails for the runner's reasons is worse than no check.
 *
 * The full image rather than `-slim`, which is four times smaller and was the
 * original choice. The slim image does not ship Git. Running this repository's
 * own suite inside it produced fifteen failures reading `spawn git ENOENT` --
 * none of them in the code, all of them looking exactly like findings. Shelling
 * out to Git is one of the most ordinary things a repository's tests do, and
 * Docket's own drift detection is one of the things doing it. The slim image
 * also has no compiler, which the container-local install needs for any
 * dependency without a Linux prebuild. Both reasons point the same way.
 */
export const DEFAULT_IMAGE = "node:22-bookworm";

/** Where the mount lands. Fixed, so the argv stays constant-shaped. */
const WORKDIR = "/workspace";

/**
 * The home directory inside the container.
 *
 * Needed because `--user 501:20` names a uid the image has no account for, and
 * without an account entry `HOME` is unset, `os.homedir()` answers `/`, and
 * anything that writes a cache or a config under the home directory fails on a
 * read-only path. That reached a reviewer as a passing test failing.
 *
 * `/tmp` rather than a created home directory: it exists in every image, it is
 * writable by whatever uid the run is given, and it is on the container's own
 * writable layer rather than in the mounted repository, so a cache written here
 * cannot leak into the working tree being reviewed.
 */
const CONTAINER_HOME = "/tmp";

/**
 * What gets bind-mounted, and where inside it the check runs.
 *
 * These are two different directories more often than not. A monorepo package
 * declares the check, but the check reads across the repository -- a shared
 * fixture, a sibling package's manifest, a config file at the root. Mounting
 * only the package makes those files simply not exist, and the run fails for a
 * reason that has nothing to do with the code. That failure is indistinguishable
 * from a real one in the packet, which makes it the same class of false evidence
 * as an empty mount: worse than no result, because it looks like a finding.
 *
 * So the repository is the unit that gets mounted, and the workspace is the
 * working directory inside it.
 */
export type Mount = Readonly<{
  /** The host directory bind-mounted at `/workspace`. */
  root: string;
  /** Where the check runs, relative to `root`. Empty when they are the same. */
  prefix: string;
  /**
   * Why `root` is not the repository, when it is not. Empty when it is.
   *
   * Not an error: mounting the workspace alone is still a correct, narrower
   * run. It is recorded because a reviewer comparing two results deserves to
   * know one of them could see less than the other.
   */
  narrowed: string;
}>;

/** Mounts the workspace itself. The fallback when there is no repository to widen to. */
export function workspaceOnly(workspaceRoot: string, narrowed: string): Mount {
  return { root: workspaceRoot, prefix: "", narrowed };
}

/** The working directory inside the container, for a given mount. */
function workdirOf(mount: Mount): string {
  return mount.prefix ? `${WORKDIR}/${mount.prefix}` : WORKDIR;
}

export type ContainerOptions = Readonly<{
  runtime: RuntimeName;
  mount: Mount;
  image?: string;
  /** Passed straight through as the command; never joined into a string. */
  command: readonly string[];
  /** Host uid:gid, so files the check writes are not left owned by root. */
  user?: string;
  /**
   * A name the container can be killed by.
   *
   * Killing the `run` process is not enough: it is a client, and the container
   * keeps running under the daemon after its client is gone. A timeout that
   * leaves a build running for the rest of the session is exactly the orphaned
   * work this runner exists to prevent, so cancellation needs a handle on the
   * container itself.
   */
  name?: string;
  memory?: string;
  cpus?: string;
  /**
   * A container-local `node_modules` to run against, instead of the one the
   * mount carries. Absent when the repository is being run against whatever the
   * host installed.
   */
  dependencies?: Dependencies;
}>;

/**
 * A `node_modules` that belongs to the container rather than to the machine.
 *
 * The problem it solves: `node_modules` in the mount was installed by the host,
 * so anything in it with a compiled component holds a binary for the host's
 * operating system and cannot load under Linux. The check then fails for a
 * reason that is not in the code -- observed, on this repository, as two test
 * files failing to import a terminal library.
 *
 * A named volume rather than an anonymous one, because the alternative is
 * paying for a full install on every check. The name is derived from the
 * lockfile, so a dependency set is installed once and reused until the
 * repository changes it, and a changed lockfile lands on a different volume
 * rather than mutating the one a previous run used.
 */
export type Dependencies = Readonly<{
  /** The runtime-managed volume. Never a host path. */
  volume: string;
  /** Where it is mounted, shadowing whatever the mount has at that path. */
  target: string;
  /** How to populate it. A fixed vector, like everything else here. */
  install: readonly string[];
  /** Said aloud when the install is not reproducible. Empty when it is. */
  caveat: string;
}>;

/** Characters a container name may contain, per the Docker and Podman CLIs. */
const NAME_ALLOWED = /[^A-Za-z0-9_.-]/g;

/**
 * A container name that is unique per run and legal for both runtimes.
 *
 * The check id is included so a stray container can be traced back to what
 * started it, and sanitized because `npm:test` contains a colon the CLI
 * rejects.
 */
export function containerName(checkId: string, unique: string): string {
  const slug = checkId.replace(NAME_ALLOWED, "-").slice(0, 40);
  return `docket-${slug}-${unique.replace(NAME_ALLOWED, "")}`.slice(0, 100);
}

/** Removes a container by name, whether or not it is still running. */
export function killArgv(runtime: RuntimeName, name: string): readonly string[] {
  return [runtime, "rm", "--force", name];
}

/**
 * Builds the argument vector for one containerised check.
 *
 * Exported separately from running it so the flags can be asserted in a test
 * on a machine with no container runtime, which is most machines in CI.
 */
export function containerArgv(options: ContainerOptions): readonly string[] {
  const {
    runtime,
    mount,
    image = DEFAULT_IMAGE,
    command,
    user,
    name,
    memory = "4g",
    cpus = "2",
    dependencies,
  } = options;

  return [
    runtime,
    "run",
    "--rm",
    ...(name ? ["--name", name] : []),
    // Default-deny egress. The single most valuable flag here: a check has no
    // reason to reach the network, and a compromised dependency's first move
    // is to phone home with whatever it found.
    "--network",
    "none",
    // Drop every capability, then refuse to regain any. A build script has no
    // business changing system time or raw-socketing.
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    // A fork bomb in a postinstall script should exhaust the container, not
    // the laptop.
    "--pids-limit",
    "512",
    "--memory",
    memory,
    "--cpus",
    cpus,
    ...(user ? ["--user", user] : []),
    // Only the repository is visible. Not the home directory, not the SSH keys,
    // not the credential files the provider CLIs keep. One mount, and it is the
    // unit being reviewed -- `resolveMount` is what refuses to let that unit
    // widen into the home directory.
    "--volume",
    `${mount.root}:${WORKDIR}`,
    // Still exactly one bind mount. This one is a named volume: runtime-managed
    // storage holding only what the install phase put in it, not a second door
    // onto the machine.
    ...(dependencies ? ["--volume", `${dependencies.volume}:${dependencies.target}`] : []),
    "--workdir",
    workdirOf(mount),
    // The host environment is not inherited. These three are set for the same
    // reason as on the host path: non-interactive, uncoloured output, and a
    // home directory that exists.
    "--env",
    "CI=1",
    "--env",
    "NO_COLOR=1",
    "--env",
    `HOME=${CONTAINER_HOME}`,
    image,
    ...command,
  ];
}

let cached: RuntimeStatus | null = null;

/**
 * Finds a usable container runtime, or explains why there is none.
 *
 * The binary existing is not enough: Docker Desktop can be installed and not
 * running, which is the common case on a laptop and produces a confusing
 * failure at run time rather than a clear one here. `info` is the cheapest
 * command that actually talks to the daemon.
 */
export async function detectRuntime(refresh = false): Promise<RuntimeStatus> {
  if (!refresh && cached) return cached;

  for (const command of CANDIDATES) {
    try {
      await execFileAsync(command, ["info"], { timeout: PROBE_TIMEOUT_MS, windowsHide: true });
      cached = { command, reason: "" };
      return cached;
    } catch {
      // Not installed, or installed and not running. Either way, not usable.
    }
  }

  cached = {
    command: null,
    reason:
      "No container runtime is available, so checks run directly on this machine with the same access you have. Install Docker or Podman to contain them.",
  };
  return cached;
}

/** Test seam: forget the probe so a changed environment is seen. */
export function resetRuntimeCache(): void {
  cached = null;
  mountCache.clear();
  populated.clear();
}

/**
 * Something Docket proves about the container before trusting a run inside it.
 *
 * Both preconditions here guard the same failure: a contained run that produces
 * a red result for a reason that is not in the code. That is worse than no
 * result and worse than a host run, because it reaches the reviewer looking
 * like a finding.
 */
export type Precondition = Readonly<{
  /** True only when the property was positively observed, never assumed. */
  ok: boolean;
  /** Why it does not hold, for the reader. Empty when it does. */
  reason: string;
}>;

/** The mount precondition, named for what it proves. */
export type MountCheck = Precondition;

const mountCache = new Map<string, MountCheck>();

/**
 * The argument vector that asks a container whether it can see the workspace.
 *
 * Exported so the flags can be asserted without a runtime, like `containerArgv`.
 * `ls` rather than a shell test: the point of this module is that Docket never
 * builds a shell string, and that does not lapse for a probe.
 */
export function mountProbeArgv(
  runtime: RuntimeName,
  mount: Mount,
  sentinel: string,
  image: string = DEFAULT_IMAGE,
): readonly string[] {
  return [
    runtime,
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--volume",
    `${mount.root}:${WORKDIR}`,
    // The same working directory as the real run, or the probe proves the
    // manifest is visible from somewhere the check will never stand.
    "--workdir",
    workdirOf(mount),
    image,
    "ls",
    sentinel,
  ];
}

/**
 * Proves the workspace is actually inside the container before trusting a run.
 *
 * This is not defensive programming, it is the difference between evidence and
 * a lie. A bind mount of a path the runtime cannot reach does not fail: Docker
 * and Podman create an empty directory at that path inside the container and
 * carry on. On macOS and Windows the runtime is a virtual machine that shares
 * only some of the host's filesystem -- Colima shares the home directory but
 * not `/var/folders`, Docker Desktop shares whatever is listed in its settings
 * -- so a repository outside those paths mounts as nothing at all.
 *
 * The check then runs against an empty directory, npm finds no manifest, and
 * the run exits non-zero. Docket would report that as the repository's tests
 * failing. It is a red result that has nothing to do with the code, which is
 * the exact class of false evidence this product exists to remove, and it is
 * worse than the host fallback because it looks like a real finding.
 *
 * So: run one container first and look for a file that must be there. If it is
 * not, the mount is not real and the contained path is not used.
 *
 * Cached per runtime and workspace, since the runtime's sharing configuration
 * does not change between checks. `resetRuntimeCache` clears it, which is what
 * the isolation status probe calls when the user asks to re-detect.
 */
export async function canSeeWorkspace(
  runtime: RuntimeName,
  mount: Mount,
  sentinel: string,
): Promise<MountCheck> {
  const key = `${runtime} ${mount.root} ${mount.prefix} ${sentinel}`;
  const remembered = mountCache.get(key);
  if (remembered) return remembered;

  const [command, ...args] = mountProbeArgv(runtime, mount, sentinel);
  let result: MountCheck;
  try {
    await execFileAsync(command, args, { timeout: MOUNT_PROBE_TIMEOUT_MS, windowsHide: true });
    result = { ok: true, reason: "" };
  } catch {
    result = {
      ok: false,
      reason: `The container runtime cannot see this repository: ${mount.root} is not on a path it shares, so it would mount as an empty directory. Add the path to the runtime's file sharing (Colima shares your home directory; Docker Desktop lists its paths under Settings, Resources, File sharing), or move the repository under one it already shares.`,
    };
  }

  mountCache.set(key, result);
  return result;
}

/** Longer than the daemon probe: this one may have to pull the image. */
const MOUNT_PROBE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Decides what to mount for a workspace: the repository containing it, or the
 * workspace alone when there is no repository, or when widening would go too
 * far.
 *
 * The guard matters more than the widening. `git rev-parse --show-toplevel`
 * answers "which repository is this in", and the answer is not always something
 * that should be handed to a build script -- keeping a home directory under
 * version control is a real habit, and mounting it would put the SSH keys and
 * the provider CLIs' credential files inside the container this module exists
 * to keep them out of. So a repository root is accepted only when it is neither
 * the filesystem root nor the home directory, and otherwise the mount stays
 * narrow and says why.
 *
 * Git's own prefix is used rather than a path computed here, because the two
 * disagree whenever the workspace is reached through a symlink, and a working
 * directory that does not exist inside the mount fails the probe for a reason
 * no reader could diagnose.
 */
export async function resolveMount(workspaceRoot: string): Promise<Mount> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel", "--show-prefix"], {
      cwd: workspaceRoot,
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    }));
  } catch {
    return workspaceOnly(
      workspaceRoot,
      "This workspace is not in a Git repository, so only the workspace itself is mounted.",
    );
  }

  const [toplevel = "", rawPrefix = ""] = stdout.split("\n");
  const root = toplevel.trim();
  if (!root) return workspaceOnly(workspaceRoot, "Git did not report a repository root.");

  if (root === "/" || root === homedir()) {
    return workspaceOnly(
      workspaceRoot,
      `The repository root is ${root}, which is too broad to mount into a container, so only the workspace itself is mounted. A check that reads files outside ${workspaceRoot} will not find them.`,
    );
  }

  // Trailing slash stripped: git prints "apps/desktop/", and the workdir is
  // built by joining, so leaving it produces "/workspace/apps/desktop/".
  return { root, prefix: rawPrefix.trim().replace(/\/+$/, ""), narrowed: "" };
}

/**
 * Proves Git still works inside the mount, before a check is run that needs it.
 *
 * A linked Git worktree does not carry its own repository. Its `.git` is a file
 * holding a path to the real one, which lives inside the main checkout --
 * somewhere else on the disk, and therefore nowhere at all once the mount is the
 * only thing the container can see. Git inside the container then answers
 * `fatal: not a git repository` for a path it cannot reach.
 *
 * That is not a small loss. Shelling out to Git is among the most ordinary
 * things a repository's checks do, and Docket's own check discovery and drift
 * detection are two of the things doing it. Observed here rather than reasoned
 * about: running this repository's suite contained from a linked worktree fails
 * a test whose subject is Git, for a reason that is not in the code.
 *
 * Mounting the real Git directory as well would fix it and is not worth the
 * price -- a second mount, of a path outside the unit under review, to make one
 * checkout layout work. Falling back to the host with the reason says something
 * true instead.
 */
export async function gitUsable(mount: Mount): Promise<Precondition> {
  const link = join(mount.root, ".git");

  let contents: string;
  try {
    if ((await stat(link)).isDirectory()) return { ok: true, reason: "" };
    contents = await readFile(link, "utf8");
  } catch {
    // No `.git` at all, so there is no Git for the container to lose. Whether
    // that is a problem is `resolveMount`'s business, not this one's.
    return { ok: true, reason: "" };
  }

  const target = /^gitdir:\s*(.+)$/m.exec(contents)?.[1]?.trim();
  if (!target) return { ok: true, reason: "" };

  const absolute = isAbsolute(target) ? target : join(mount.root, target);
  const step = relative(mount.root, absolute);
  if (step !== "" && !step.startsWith("..") && !isAbsolute(step)) return { ok: true, reason: "" };

  return {
    ok: false,
    reason: `This workspace is a linked Git worktree: its .git file points at ${absolute}, which is outside the mounted repository, so Git does not work inside the container. A check that shells out to Git would fail for that reason rather than for anything in the code, so this check ran on this machine instead. Running from the main checkout is contained normally.`,
  };
}

/**
 * The first bytes of a compiled file, which name the platform it was built for.
 * Nothing here parses an object file; it reads a header and stops.
 */
const ELF_MAGIC = Object.freeze([0x7f, 0x45, 0x4c, 0x46]);

/** `e_machine`, at offset 18 of an ELF header. Enough to tell arm64 from x86-64. */
const ELF_MACHINES: Readonly<Record<string, number>> = Object.freeze({ arm64: 0xb7, x64: 0x3e });

/** Bytes read from each candidate: the magic, plus far enough to reach `e_machine`. */
const HEADER_BYTES = 20;

/**
 * Where a compiled module lands inside its package. `build/` is what node-gyp
 * produces on this machine; `prebuilds/<platform>-<arch>/` is what prebuildify
 * ships, and a package using it carries several platforms at once, which is
 * why finding a macOS binary is not on its own a problem.
 */
const BUILD_DIRECTORIES = Object.freeze(["build/Release", "build/Debug"]);

/** A ceiling on the walk, so a pathological tree cannot stall a check. */
const MAX_PACKAGES = 5_000;
/** How deep nested `node_modules` are followed. Four covers real npm trees. */
const MAX_NESTING = 4;

function describeObject(header: Buffer): string {
  if (ELF_MAGIC.every((byte, index) => header[index] === byte)) {
    return "Linux, for a different processor architecture";
  }
  // Mach-O, in both byte orders, plus the universal-binary wrapper.
  const magic = header.readUInt32BE(0);
  if (magic === 0xcffaedfe || magic === 0xfeedfacf || magic === 0xcafebabe || magic === 0xbebafeca) {
    return "macOS";
  }
  if (header[0] === 0x4d && header[1] === 0x5a) return "Windows";
  return "an unrecognised platform";
}

/** Reads the header of a compiled module. Null when it cannot be read at all. */
async function readHeader(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return bytesRead === HEADER_BYTES ? buffer : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Whether this header is an ELF object the container's processor can run. */
function loadableHere(header: Buffer): boolean {
  if (!ELF_MAGIC.every((byte, index) => header[index] === byte)) return false;
  const wanted = ELF_MACHINES[process.arch];
  // An architecture this code does not know about is not evidence of a problem.
  return wanted === undefined || header.readUInt16LE(18) === wanted;
}

async function entries(path: string): Promise<{ name: string; directory: boolean }[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/** Every compiled module a package ships, in the two places packages put them. */
async function compiledModules(packageDir: string): Promise<string[]> {
  const found: string[] = [];

  for (const directory of BUILD_DIRECTORIES) {
    const path = join(packageDir, directory);
    for (const entry of await entries(path)) {
      if (!entry.directory && entry.name.endsWith(".node")) found.push(join(path, entry.name));
    }
  }

  const prebuilds = join(packageDir, "prebuilds");
  for (const platform of await entries(prebuilds)) {
    if (!platform.directory) continue;
    const path = join(prebuilds, platform.name);
    for (const entry of await entries(path)) {
      if (!entry.directory && entry.name.endsWith(".node")) found.push(join(path, entry.name));
    }
  }

  return found;
}

/**
 * The packages inside one `node_modules`, scopes expanded and nesting followed.
 */
async function packages(nodeModules: string, depth: number, budget: { left: number }): Promise<string[]> {
  if (depth > MAX_NESTING || budget.left <= 0) return [];

  const found: string[] = [];
  for (const entry of await entries(nodeModules)) {
    if (!entry.directory || entry.name === ".bin" || entry.name === ".cache") continue;

    const roots = entry.name.startsWith("@")
      ? (await entries(join(nodeModules, entry.name)))
          .filter((scoped) => scoped.directory)
          .map((scoped) => join(nodeModules, entry.name, scoped.name))
      : [join(nodeModules, entry.name)];

    for (const root of roots) {
      if (budget.left-- <= 0) return found;
      found.push(root);
      found.push(...(await packages(join(root, "node_modules"), depth + 1, budget)));
    }
  }
  return found;
}

/**
 * Proves the installed dependencies can actually load inside the image, before
 * a check is run against them.
 *
 * The mount probe proves the repository is visible. It does not prove the run
 * will be equivalent, and on a developer machine it usually is not:
 * `node_modules` was installed by the host, so any dependency with a compiled
 * component holds a binary for the host's operating system. Loading it inside a
 * Linux container fails, the test file that imports it fails with it, and
 * Docket reports the repository's own tests as failing for a reason that is not
 * in its code. That is the same class of false evidence as an empty mount, and
 * it is the one this repository actually hit.
 *
 * What is proved is narrow and positive: for each package that ships a compiled
 * module at all, at least one of them must be an object file this container can
 * load. A package carrying a macOS binary *and* a Linux one is healthy --
 * prebuildify ships every platform in one tarball -- so the presence of a
 * foreign binary is not the finding. The absence of a usable one is.
 *
 * Deliberately not cached: `node_modules` changes whenever the user installs,
 * and a remembered "your dependencies are broken" would outlive the fix.
 */
export async function dependenciesLoadable(mount: Mount): Promise<Precondition> {
  const workspace = mount.prefix ? join(mount.root, mount.prefix) : mount.root;
  // Both, because npm workspaces hoist to the repository root while a
  // standalone package installs beside itself.
  const trees = workspace === mount.root ? [mount.root] : [workspace, mount.root];
  const budget = { left: MAX_PACKAGES };

  for (const tree of trees) {
    for (const packageDir of await packages(join(tree, "node_modules"), 0, budget)) {
      const modules = await compiledModules(packageDir);
      if (modules.length === 0) continue;

      let usable = false;
      const headers: { path: string; built: string }[] = [];
      for (const path of modules) {
        const header = await readHeader(path);
        if (!header) continue;
        if (loadableHere(header)) {
          usable = true;
          break;
        }
        headers.push({ path, built: describeObject(header) });
      }
      if (usable || headers.length === 0) continue;

      const first = headers[0] as { path: string; built: string };
      return {
        ok: false,
        reason: `The dependencies installed here were built for this machine, not for the container: ${relative(mount.root, first.path)} is a binary for ${first.built}, and this package ships none that the container could load. A contained run would report the repository's own tests as failing for a reason that is not in its code, so this check ran on this machine instead.`,
      };
    }
  }

  return { ok: true, reason: "" };
}

/**
 * The file that says an install finished rather than merely started.
 *
 * Without it, a volume that exists is taken for a volume that is populated, and
 * a Docket killed halfway through `npm ci` leaves a half-installed dependency
 * set that every later run silently reuses. That is a red result with nothing
 * to do with the code, which is the thing this whole track exists to prevent.
 */
const MARKER = ".docket-complete";

/** Where the volume is mounted when it is being prepared rather than used. */
const DEPS_DIR = "/deps";

/** An install may compile native modules from source. Minutes, not seconds. */
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

export type DependencyPlan =
  | Readonly<{ ok: true; dependencies: Dependencies }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * A volume name derived from the exact dependency set it will hold.
 *
 * The lockfile decides the contents, so it decides the name: an unchanged
 * lockfile reuses the install, and a changed one lands on a different volume
 * instead of mutating the one an earlier run already used. The repository path
 * is mixed in as well, so two checkouts never share a volume even when their
 * lockfiles agree -- cheap insurance against one repository's install scripts
 * having written something another repository then runs.
 *
 * Length-prefixed rather than separated by a delimiter, so no field can be
 * arranged to look like another one, and no control character goes anywhere
 * near the source of this file.
 */
function volumeName(parts: readonly string[]): string {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(`${part.length}:${part}`);
  return `docket-deps-${digest.digest("hex").slice(0, 16)}`;
}

async function contentsOf(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Decides what a container-local `node_modules` would be for this workspace,
 * or why there cannot be one.
 *
 * Installing where the lockfile is, which for the ordinary package is the
 * workspace itself. An npm workspaces monorepo keeps one lockfile at the
 * repository root and installs into several `node_modules` at once, and that is
 * refused here rather than half-supported: shadowing only one of them would
 * hand the check a dependency tree that is partly the container's and partly
 * the host's, which is a worse answer than saying so.
 */
export async function planDependencies(
  mount: Mount,
  image: string = DEFAULT_IMAGE,
): Promise<DependencyPlan> {
  const workspace = mount.prefix ? join(mount.root, mount.prefix) : mount.root;
  const target = `${workdirOf(mount)}/node_modules`;

  const lock = await contentsOf(join(workspace, "package-lock.json"));
  if (lock !== null) {
    return {
      ok: true,
      dependencies: {
        volume: volumeName([lock, mount.root, mount.prefix, image]),
        target,
        install: ["npm", "ci"],
        caveat: "",
      },
    };
  }

  if (mount.prefix && (await contentsOf(join(mount.root, "package-lock.json"))) !== null) {
    return {
      ok: false,
      reason:
        "The lockfile for this workspace is at the repository root, which means npm workspaces, and one install there populates several node_modules at once. Docket cannot give the container its own copy of only one of them without mixing the container's dependencies with this machine's.",
    };
  }

  const manifest = await contentsOf(join(workspace, "package.json"));
  if (manifest === null) {
    return { ok: false, reason: "This workspace has no package.json to install from." };
  }

  return {
    ok: true,
    dependencies: {
      volume: volumeName([manifest, mount.root, mount.prefix, image]),
      target,
      // `--no-package-lock` because the repository is mounted read-only during
      // the install, and an install that writes a lockfile into the tree under
      // review would be changing the thing it is meant to be checking.
      install: ["npm", "install", "--no-package-lock"],
      caveat:
        "This repository has no lockfile, so the container installed whatever the registry served at the time. The versions it ran against are not pinned and may differ from the ones on this machine.",
    },
  };
}

/** Creates the volume, labelled so a reader can find and prune Docket's. */
export function createVolumeArgv(runtime: RuntimeName, volume: string): readonly string[] {
  return [runtime, "volume", "create", "--label", "docket=dependencies", volume];
}

export function removeVolumeArgv(runtime: RuntimeName, volume: string): readonly string[] {
  return [runtime, "volume", "rm", "--force", volume];
}

/**
 * Hands the volume to the user the install will run as.
 *
 * A named volume mounted at a path the image does not have is created owned by
 * root, and the install runs as the host's uid so that anything it writes into
 * the repository is owned by the person who launched Docket. Without this the
 * install cannot write a single file. Root is used for exactly this one
 * `chown` and for nothing else -- in particular not for the install itself,
 * where package scripts run.
 */
export function chownVolumeArgv(
  runtime: RuntimeName,
  volume: string,
  user: string,
  image: string = DEFAULT_IMAGE,
): readonly string[] {
  return [
    runtime,
    "run",
    "--rm",
    "--network",
    "none",
    "--user",
    "0:0",
    "--volume",
    `${volume}:${DEPS_DIR}`,
    image,
    "chown",
    user,
    DEPS_DIR,
  ];
}

/** Writes the marker that distinguishes a finished install from an abandoned one. */
export function sealVolumeArgv(
  runtime: RuntimeName,
  volume: string,
  user: string | undefined,
  image: string = DEFAULT_IMAGE,
): readonly string[] {
  return [
    runtime,
    "run",
    "--rm",
    "--network",
    "none",
    ...(user ? ["--user", user] : []),
    "--volume",
    `${volume}:${DEPS_DIR}`,
    "--workdir",
    DEPS_DIR,
    image,
    "touch",
    MARKER,
  ];
}

/** Asks whether this volume already holds a finished install. */
export function probeVolumeArgv(
  runtime: RuntimeName,
  volume: string,
  image: string = DEFAULT_IMAGE,
): readonly string[] {
  return [
    runtime,
    "run",
    "--rm",
    "--network",
    "none",
    "--volume",
    `${volume}:${DEPS_DIR}`,
    "--workdir",
    DEPS_DIR,
    image,
    "ls",
    MARKER,
  ];
}

export type InstallOptions = Readonly<{
  runtime: RuntimeName;
  mount: Mount;
  dependencies: Dependencies;
  user?: string;
  name?: string;
  image?: string;
  memory?: string;
  cpus?: string;
}>;

/**
 * The install phase, which is the one place a Docket container reaches the
 * network.
 *
 * Two phases with opposite policies, and the pair is the point:
 *
 * - **Install** can reach the registry, and cannot write to the repository.
 * - **Run** can write to the repository, and cannot reach the network.
 *
 * So `--network none` is absent here, deliberately, and `:ro` is present.
 * Installing dependencies means running the packages' own install scripts, with
 * whatever they do; what this refuses them is the working tree under review and
 * the host's environment. Everything else the run phase drops is dropped here
 * too: capabilities, privilege escalation, process count, memory, CPU.
 */
export function installArgv(options: InstallOptions): readonly string[] {
  const {
    runtime,
    mount,
    dependencies,
    user,
    name,
    image = DEFAULT_IMAGE,
    memory = "4g",
    cpus = "2",
  } = options;

  return [
    runtime,
    "run",
    "--rm",
    ...(name ? ["--name", name] : []),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "512",
    "--memory",
    memory,
    "--cpus",
    cpus,
    ...(user ? ["--user", user] : []),
    // Read-only. An install has to read the manifest and the lockfile and has
    // no business writing anything else into the tree being reviewed.
    "--volume",
    `${mount.root}:${WORKDIR}:ro`,
    "--volume",
    `${dependencies.volume}:${dependencies.target}`,
    "--workdir",
    workdirOf(mount),
    "--env",
    "CI=1",
    "--env",
    "NO_COLOR=1",
    "--env",
    `HOME=${CONTAINER_HOME}`,
    image,
    ...dependencies.install,
  ];
}

/** Runs one step and keeps its output, streaming it on as it arrives. */
function runStep(
  argv: readonly string[],
  timeoutMs: number,
  onOutput?: (chunk: string) => void,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0] as string, argv.slice(1), {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, output: error instanceof Error ? error.message : String(error) });
      return;
    }

    let text = "";
    const collect = (data: Buffer) => {
      const chunk = data.toString("utf8");
      // Bounded: an install's output is long and nobody reads the middle of it.
      if (text.length < 64_000) text += chunk;
      onOutput?.(chunk);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const finish = (result: { ok: boolean; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (error) => finish({ ok: false, output: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, output: text }));
  });
}

/** Volumes proven complete in this process, so the probe runs once each. */
const populated = new Set<string>();

/** The last few lines, which is where an installer says what went wrong. */
function tail(output: string): string {
  return output.trim().split("\n").slice(-6).join(" ").slice(0, 400);
}

/**
 * Makes sure the volume holds a finished install, doing one if it does not.
 *
 * Cheap on the common path: a volume that already carries the marker is used as
 * it is, and the answer is remembered for the rest of the session. A failed
 * install removes the volume rather than leaving a half-populated one behind
 * for the next run to trust.
 */
export async function ensureDependencies(
  options: InstallOptions & { onOutput?: (chunk: string) => void },
): Promise<Precondition> {
  const { runtime, mount, dependencies, user, image = DEFAULT_IMAGE, onOutput } = options;
  const { volume } = dependencies;

  if (populated.has(volume)) return { ok: true, reason: "" };

  // Created before the probe rather than after it. Mounting a volume name that
  // does not exist creates it implicitly and unlabelled, and `volume create` on
  // one that already exists quietly returns it without adding anything -- so a
  // label applied later is a label never applied. The label is the only handle
  // a reader has for finding and pruning what Docket left on their disk.
  const created = await runStep(createVolumeArgv(runtime, volume), MOUNT_PROBE_TIMEOUT_MS);
  if (!created.ok) {
    return {
      ok: false,
      reason: `Docket could not prepare a container-local node_modules: ${tail(created.output)} The check ran on this machine instead.`,
    };
  }

  if ((await runStep(probeVolumeArgv(runtime, volume, image), MOUNT_PROBE_TIMEOUT_MS)).ok) {
    populated.add(volume);
    return { ok: true, reason: "" };
  }

  onOutput?.("\n[Docket] Installing this repository's dependencies inside the container.\n");

  // The mount point has to exist before the mount can land on it, and the
  // install mounts the repository read-only, so the runtime cannot create it
  // itself: on a fresh clone it fails with "make mountpoint: read-only file
  // system". Found by the equivalence test on its first run, which is the case
  // it was written for -- a checkout with no node_modules is the normal state
  // of a build machine, and the manual experiment that came before it happened
  // to be run somewhere the directory already existed.
  //
  // Creating it is not a change to the tree under review. An empty directory is
  // invisible to Git, npm would create the same one on any install, and keeping
  // the repository read-only during the one phase that can reach the network is
  // worth more than avoiding an empty directory.
  const workspace = mount.prefix ? join(mount.root, mount.prefix) : mount.root;
  try {
    await mkdir(join(workspace, "node_modules"), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason: `Docket could not create ${join(workspace, "node_modules")} for the container to install into: ${error instanceof Error ? error.message : String(error)} The check ran on this machine instead.`,
    };
  }

  if (user) {
    const owned = await runStep(chownVolumeArgv(runtime, volume, user, image), MOUNT_PROBE_TIMEOUT_MS);
    if (!owned.ok) {
      return {
        ok: false,
        reason: `Docket could not hand the container-local node_modules to the user the install runs as: ${tail(owned.output)} The check ran on this machine instead.`,
      };
    }
  }

  const install = await runStep(installArgv(options), INSTALL_TIMEOUT_MS, onOutput);
  if (!install.ok) {
    // Never leave a half-installed volume for a later run to trust.
    await runStep(removeVolumeArgv(runtime, volume), MOUNT_PROBE_TIMEOUT_MS);
    return {
      ok: false,
      reason: `Installing this repository's dependencies inside the container failed, so there is nothing trustworthy to run against and the check ran on this machine instead. The installer said: ${tail(install.output)}`,
    };
  }

  const sealed = await runStep(sealVolumeArgv(runtime, volume, user, image), MOUNT_PROBE_TIMEOUT_MS);
  if (!sealed.ok) {
    await runStep(removeVolumeArgv(runtime, volume), MOUNT_PROBE_TIMEOUT_MS);
    return {
      ok: false,
      reason: `The dependencies installed, but Docket could not record that they had, and an install it cannot recognise later is one it would silently half-reuse. The check ran on this machine instead. ${tail(sealed.output)}`,
    };
  }

  populated.add(volume);
  return { ok: true, reason: "" };
}
