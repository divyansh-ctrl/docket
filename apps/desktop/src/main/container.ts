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
import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
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
