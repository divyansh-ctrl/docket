import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  canSeeWorkspace,
  containerArgv,
  containerName,
  createVolumeArgv,
  dependenciesLoadable,
  gitUsable,
  installArgv,
  killArgv,
  mountProbeArgv,
  planDependencies,
  probeVolumeArgv,
  removeVolumeArgv,
  resolveMount,
  sealVolumeArgv,
  workspaceOnly,
  detectRuntime,
  DEFAULT_IMAGE,
} = jiti("../src/main/container.ts");

/** The common case: the workspace is the repository, so nothing is nested. */
function wholeRepo(root) {
  return { root, prefix: "", narrowed: "" };
}

/**
 * Host paths written with POSIX separators, for comparing against a literal.
 *
 * Windows answers with backslashes and a drive letter, and a path built there
 * is right to use them. Asserting on the raw string is a test bug rather than a
 * product one, so the test normalises instead of the code.
 */
const posix = (path) => path.replaceAll("\\", "/");

// These assert the argument vector rather than a running container, because a
// container runtime is not present on most development machines or in CI. The
// flags are the security property, so they are pinned by name: a future edit
// that drops --network none should fail here rather than quietly widen what a
// repository's build script can reach.
function argv(overrides = {}) {
  return containerArgv({
    runtime: "docker",
    mount: wholeRepo("/tmp/project"),
    command: ["npm", "run", "test"],
    ...overrides,
  });
}

function flagValue(list, flag) {
  const index = list.indexOf(flag);
  return index === -1 ? undefined : list[index + 1];
}

function flagValues(list, flag) {
  return list.filter((entry, index) => list[index - 1] === flag);
}

/**
 * The mounts that expose a host path, as opposed to runtime-managed storage.
 *
 * The two share a flag and are not the same kind of thing: a bind mount is a
 * door onto the machine, and a named volume holds only what Docket put in it.
 * Counting them together would let the security property this file pins be
 * widened by something that does not widen it, or hide something that does.
 */
function bindMounts(list) {
  return flagValues(list, "--volume").filter((entry) => entry.startsWith("/"));
}

test("the container has no network", () => {
  // The single most valuable flag: a check has no reason to reach the network,
  // and a compromised dependency's first move is to phone home.
  assert.equal(flagValue(argv(), "--network"), "none");
});

test("capabilities are dropped and cannot be regained", () => {
  const list = argv();
  assert.equal(flagValue(list, "--cap-drop"), "ALL");
  assert.equal(flagValue(list, "--security-opt"), "no-new-privileges");
});

test("only the repository is mounted, and it is the working directory", () => {
  const list = argv({ mount: wholeRepo("/home/dev/project") });

  assert.equal(flagValue(list, "--volume"), "/home/dev/project:/workspace");
  assert.equal(flagValue(list, "--workdir"), "/workspace");

  // Nothing else may be mounted: the home directory, the SSH keys and the
  // provider CLIs' credential files are the reason this exists.
  assert.equal(list.filter((entry) => entry === "--volume").length, 1);
});

test("a package inside a repository mounts the repository and works in the package", () => {
  // The reason this is not just the workspace: a monorepo package's own tests
  // routinely read a sibling's files, and mounting only the package makes them
  // vanish -- which reaches the reviewer as that package's tests failing.
  const list = argv({ mount: { root: "/home/dev/repo", prefix: "apps/desktop", narrowed: "" } });

  assert.equal(flagValue(list, "--volume"), "/home/dev/repo:/workspace");
  assert.equal(flagValue(list, "--workdir"), "/workspace/apps/desktop");
  // Still exactly one mount. Widening the unit must not become widening the count.
  assert.equal(list.filter((entry) => entry === "--volume").length, 1);
});

test("the host environment is not inherited", () => {
  const list = argv();
  const passed = list.filter((entry, index) => list[index - 1] === "--env");

  // Only the three flags that make a run non-interactive, uncoloured, and
  // possessed of a home directory. A blanket --env-file or a passthrough of
  // process.env would hand the script every secret the app was launched with.
  assert.deepEqual(passed.sort(), ["CI=1", "HOME=/tmp", "NO_COLOR=1"]);
});

test("the container has a writable home directory", () => {
  // Not cosmetic. --user names a uid the image has no account for, and with no
  // account HOME is unset, os.homedir() answers "/", and anything writing a
  // cache under the home directory fails on a read-only path. That reached a
  // reviewer as one of this repository's passing tests failing.
  const list = argv();
  const home = list.filter((entry, index) => list[index - 1] === "--env" && entry.startsWith("HOME="));

  assert.deepEqual(home, ["HOME=/tmp"]);
  // Inside the container's own writable layer, never in the mounted repository:
  // a cache written into the working tree would show up as a change to review.
  assert.ok(!home.some((entry) => entry.startsWith("HOME=/workspace")));
});

test("resource limits are set so a runaway script cannot take the machine", () => {
  const list = argv();
  assert.equal(flagValue(list, "--pids-limit"), "512");
  assert.equal(flagValue(list, "--memory"), "4g");
  assert.equal(flagValue(list, "--cpus"), "2");
});

test("the container is removed after the run", () => {
  assert.ok(argv().includes("--rm"));
});

test("the command is passed as separate arguments, never as a shell string", () => {
  const list = argv({ command: ["npm", "run", "test:unit"] });
  const tail = list.slice(list.indexOf(DEFAULT_IMAGE) + 1);

  assert.deepEqual(tail, ["npm", "run", "test:unit"]);
  // A joined string would be the shell injection this whole design avoids.
  assert.ok(!list.some((entry) => entry === "npm run test:unit"));
});

test("the runtime is the first element, so nothing shells out to find it", () => {
  assert.equal(argv({ runtime: "podman" })[0], "podman");
  assert.equal(argv({ runtime: "docker" })[1], "run");
});

test("the user is only set when one is supplied", () => {
  assert.equal(flagValue(argv({ user: "501:20" }), "--user"), "501:20");
  assert.ok(!argv().includes("--user"));
});

test("a named container can be killed, because killing the client is not enough", () => {
  // `docker run` is a client. Signalling it detaches the terminal and leaves
  // the container running under the daemon, so a timed-out check would keep
  // building for the rest of the session with nowhere to report -- exactly the
  // orphaned work the process-group kill was added to prevent.
  const list = argv({ name: "docket-npm-test-1" });
  assert.equal(flagValue(list, "--name"), "docket-npm-test-1");

  assert.deepEqual(killArgv("docker", "docket-npm-test-1"), [
    "docker",
    "rm",
    "--force",
    "docket-npm-test-1",
  ]);

  // Unnamed containers stay unnamed: the flag is only there when there is
  // something to kill by.
  assert.ok(!argv().includes("--name"));
});

test("a container name is legal for the runtime and traceable to its check", () => {
  const name = containerName("npm:test", "4321-7");

  // The colon in a check id is not a legal container name character, and a
  // rejected name would fail every contained run on a machine that has Docker.
  assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  assert.match(name, /test/, "a stray container should name what started it");
  // Unique per run, so two runs of the same check cannot collide on the name
  // and kill each other's container.
  assert.notEqual(containerName("npm:test", "4321-7"), containerName("npm:test", "4321-8"));
});

test("the mount probe asks a container what it can see, without a shell", () => {
  const list = mountProbeArgv("docker", wholeRepo("/home/dev/project"), "package.json");

  // The same mount and working directory as the real run, or it would be
  // proving something about a different container.
  assert.equal(flagValue(list, "--volume"), "/home/dev/project:/workspace");
  assert.equal(flagValue(list, "--workdir"), "/workspace");
  // A probe is still a container: no network, no capabilities.
  assert.equal(flagValue(list, "--network"), "none");
  assert.equal(flagValue(list, "--cap-drop"), "ALL");
  assert.ok(list.includes("--rm"));

  // `ls <file>` as two arguments. A shell test such as `test -f x` would put
  // the one thing this module refuses to build back into the safe path.
  assert.deepEqual(list.slice(-2), ["ls", "package.json"]);
  assert.ok(!list.some((entry) => entry.includes(" ")), "no argument may be a command line");
});

test("a workspace the runtime cannot reach is reported as unusable, with the remedy", async () => {
  const status = await detectRuntime(true);
  if (!status.command) return; // Nothing to probe with; covered by the argv test above.

  // A path that cannot exist. Docker does not fail on an unreachable bind
  // mount -- it mounts an empty directory -- so this is exactly the shape of
  // the real macOS failure, where the runtime's VM does not share the host
  // path and the check would run against nothing.
  const check = await canSeeWorkspace(
    status.command,
    wholeRepo("/docket-nonexistent-workspace"),
    "package.json",
  );

  assert.equal(check.ok, false);
  assert.match(check.reason, /cannot see this repository/);
  // Naming the remedy matters more here than elsewhere: the reader's checks
  // have silently stopped being contained and they need to know how to fix it.
  assert.match(check.reason, /file sharing|shares/i);
});

test("a workspace inside a repository resolves to the repository plus a prefix", async () => {
  // Run against this repository, which is a monorepo package: the whole point
  // is that the mount is the repository and the workdir is the package.
  const mount = await resolveMount(process.cwd());

  // Git reports POSIX separators on every platform, including Windows, where
  // process.cwd() answers with backslashes and a drive letter. The argv is
  // built from Git's answer alone, and checks do not execute on Windows yet.
  const here = posix(process.cwd());

  assert.equal(mount.narrowed, "");
  assert.ok(here.startsWith(posix(mount.root)), "the mount must contain the workspace");
  assert.notEqual(posix(mount.root), here, "this package is not the repository root");
  assert.equal(`${posix(mount.root)}/${mount.prefix}`, here);
  // A trailing slash would produce "/workspace/apps/desktop/" as the workdir.
  assert.doesNotMatch(mount.prefix, /\/$/);
});

test("a workspace outside any repository mounts only itself, and says so", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const outside = await mkdtemp(join(tmpdir(), "docket-norepo-"));
  try {
    const mount = await resolveMount(outside);

    assert.equal(mount.root, outside);
    assert.equal(mount.prefix, "");
    assert.match(mount.narrowed, /not in a Git repository/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("the home directory is never widened into, whatever Git says", async () => {
  // Keeping the home directory under version control is a real habit, and
  // `git rev-parse --show-toplevel` would answer with it. Mounting it would put
  // the SSH keys and the provider CLIs' credential files inside the container
  // that this whole module exists to keep them out of, so the widening stops.
  const { homedir } = await import("node:os");

  for (const tooBroad of ["/", homedir()]) {
    const narrow = workspaceOnly("/home/dev/repo/pkg", `The repository root is ${tooBroad}`);
    assert.equal(narrow.root, "/home/dev/repo/pkg");
    assert.equal(narrow.prefix, "");
    assert.ok(narrow.narrowed.length > 0, "a narrowed mount must say why");
  }

  // And the argv built from a narrowed mount really is the narrow one.
  const list = argv({ mount: workspaceOnly("/home/dev/repo/pkg", "too broad") });
  assert.equal(flagValue(list, "--volume"), "/home/dev/repo/pkg:/workspace");
  assert.equal(flagValue(list, "--workdir"), "/workspace");
});

// The header bytes a compiled module starts with. Real files, not mocks: the
// probe reads headers off disk, so a fixture that only pretends would prove
// nothing about the thing being tested.
const ELF_MACHINES = { arm64: 0xb7, x64: 0x3e };

function elfFor(arch) {
  const header = Buffer.alloc(64);
  // 0x7f "ELF", written as bytes so no control character lands in this file.
  header.set([0x7f, 0x45, 0x4c, 0x46], 0);
  header.writeUInt16LE(ELF_MACHINES[arch] ?? 0, 18);
  return header;
}

function machO() {
  const header = Buffer.alloc(64);
  header.writeUInt32BE(0xcffaedfe, 0);
  return header;
}

/** Writes a fake install tree and returns its root. */
async function installed(files) {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");

  const root = await mkdtemp(join(tmpdir(), "docket-deps-"));
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

async function discard(root) {
  const { rm } = await import("node:fs/promises");
  await rm(root, { recursive: true, force: true });
}

test("dependencies built for this machine are refused before a contained run", async () => {
  // The failure this exists for, and the one this repository actually hit: npm
  // installed node-pty on macOS, the container is Linux, the module cannot load,
  // and two test files fail for a reason that is not in the code.
  const root = await installed({
    "node_modules/node-pty/build/Release/pty.node": machO(),
    "node_modules/node-pty/package.json": "{}",
  });
  try {
    const check = await dependenciesLoadable(wholeRepo(root));

    assert.equal(check.ok, false);
    // Naming the file is the difference between a reader believing this and
    // having to take Docket's word for it. Compared with POSIX separators
    // because the reason quotes a host path, and on Windows that path is
    // written with backslashes -- correctly, for the reader who is on Windows.
    assert.match(posix(check.reason), /node_modules\/node-pty\/build\/Release\/pty\.node/);
    assert.match(check.reason, /macOS/);
    // And it says what happens next, because a blocked contained run is not an
    // error the reader has to resolve before anything can be checked.
    assert.match(check.reason, /ran on this machine instead/);
  } finally {
    await discard(root);
  }
});

test("a package shipping several platforms at once is not mistaken for a broken install", async () => {
  // prebuildify puts every platform in one tarball, so a macOS binary sitting
  // next to a Linux one is a healthy package, not a finding. Treating it as one
  // would push every such repository onto the host for no reason.
  const root = await installed({
    "node_modules/sodium/prebuilds/darwin-arm64/sodium.node": machO(),
    [`node_modules/sodium/prebuilds/linux-${process.arch}/sodium.node`]: elfFor(process.arch),
  });
  try {
    assert.equal((await dependenciesLoadable(wholeRepo(root))).ok, true);
  } finally {
    await discard(root);
  }
});

test("a repository with nothing compiled in it is left alone", async () => {
  const root = await installed({
    "node_modules/lodash/index.js": "module.exports = {}",
    "node_modules/@scope/thing/package.json": "{}",
  });
  try {
    const check = await dependenciesLoadable(wholeRepo(root));

    assert.equal(check.ok, true);
    assert.equal(check.reason, "");
  } finally {
    await discard(root);
  }
});

test("the repository's hoisted dependencies are inspected, not only the package's", async () => {
  // npm workspaces install to the repository root, so a package that looks
  // clean on its own is running against binaries it did not install.
  const root = await installed({
    "apps/desktop/package.json": "{}",
    "node_modules/node-pty/build/Release/pty.node": machO(),
  });
  try {
    const check = await dependenciesLoadable({ root, prefix: "apps/desktop", narrowed: "" });

    assert.equal(check.ok, false);
    assert.match(check.reason, /pty\.node/);
  } finally {
    await discard(root);
  }
});

test("a dependency nested inside another package is still inspected", async () => {
  const root = await installed({
    "node_modules/tool/node_modules/native-bit/build/Release/bit.node": machO(),
  });
  try {
    assert.equal((await dependenciesLoadable(wholeRepo(root))).ok, false);
  } finally {
    await discard(root);
  }
});

test("a linked worktree is refused, because its Git directory is not in the mount", async () => {
  // Found by running this repository's own suite contained from a worktree. A
  // linked worktree's .git is a file pointing into the main checkout, which is
  // somewhere else on the disk and therefore nowhere at all inside the mount.
  // Git answers "fatal: not a git repository" and a test about Git fails for a
  // reason that is not in the code.
  const root = await installed({ ".git": "gitdir: /elsewhere/repo/.git/worktrees/feature\n" });
  try {
    const check = await gitUsable(wholeRepo(root));

    assert.equal(check.ok, false);
    assert.match(check.reason, /linked Git worktree/);
    assert.match(check.reason, /\/elsewhere\/repo\/\.git/);
    assert.match(check.reason, /main checkout/);
  } finally {
    await discard(root);
  }
});

test("an ordinary checkout and a directory with no Git are both left alone", async () => {
  const ordinary = await installed({ ".git/HEAD": "ref: refs/heads/main\n" });
  const bare = await installed({ "package.json": "{}" });
  try {
    assert.equal((await gitUsable(wholeRepo(ordinary))).ok, true);
    // Not a repository at all is `resolveMount`'s business, not this probe's,
    // and answering "no Git here" would block every run in a plain directory.
    assert.equal((await gitUsable(wholeRepo(bare))).ok, true);
  } finally {
    await discard(ordinary);
    await discard(bare);
  }
});

test("a submodule, whose Git directory is inside the mount, is not refused", async () => {
  // Submodules use the same gitlink file, but they point back into the
  // repository being mounted, so Git works inside the container exactly as it
  // does outside. Refusing them would be the false positive this probe cannot
  // afford: it would push most repositories onto the host.
  const root = await installed({ ".git": "gitdir: ./.git-real/modules/thing\n" });
  try {
    assert.equal((await gitUsable(wholeRepo(root))).ok, true);
  } finally {
    await discard(root);
  }
});

// Skipped on Windows, where checks do not run at all yet, and where the CI
// daemon is in Windows-container mode: `docker info` answers healthily and then
// refuses a Linux image with "no matching manifest". Worth recording -- a
// runtime that is running is still not always a runtime that can run this --
// but it is not reachable while `resolveNpm` refuses Windows outright.
const needsLinuxImages = {
  skip: process.platform === "win32" ? "checks do not run on Windows yet" : false,
};

const DEPS = {
  volume: "docket-deps-0123456789abcdef",
  target: "/workspace/apps/desktop/node_modules",
  install: ["npm", "ci"],
  caveat: "",
};

function nested(root = "/home/dev/repo") {
  return { root, prefix: "apps/desktop", narrowed: "" };
}

test("a container-local node_modules shadows the one the mount carries", () => {
  const list = argv({ mount: nested(), dependencies: DEPS });

  assert.ok(flagValues(list, "--volume").includes(`${DEPS.volume}:${DEPS.target}`));
  // Still exactly one door onto the machine. Widening what a check can *use*
  // must not widen what it can *see*: the volume holds only what the install
  // phase put in it, and adding it is not adding a second host path.
  assert.deepEqual(bindMounts(list), ["/home/dev/repo:/workspace"]);
  // And the run itself is unchanged in every way that matters.
  assert.equal(flagValue(list, "--network"), "none");
  assert.equal(flagValue(list, "--workdir"), "/workspace/apps/desktop");
});

test("the install phase may reach the network and may not write the repository", () => {
  // The pair is the point, and it is the reason installing is a separate phase
  // rather than a flag. Install: registry yes, working tree no. Run: working
  // tree yes, registry no. Losing either half loses the reason for the split.
  const install = installArgv({
    runtime: "docker",
    mount: nested(),
    dependencies: DEPS,
    user: "501:20",
    name: "docket-install-1",
  });

  assert.ok(!install.includes("--network"), "the install phase needs the registry");
  assert.deepEqual(bindMounts(install), ["/home/dev/repo:/workspace:ro"]);
  assert.ok(flagValues(install, "--volume").includes(`${DEPS.volume}:${DEPS.target}`));

  // Everything the run phase drops is dropped here too. Installing runs the
  // packages' own scripts, which is the least trustworthy code in the whole
  // sequence, so this is the container that can least afford to be lenient.
  assert.equal(flagValue(install, "--cap-drop"), "ALL");
  assert.equal(flagValue(install, "--security-opt"), "no-new-privileges");
  assert.equal(flagValue(install, "--pids-limit"), "512");
  assert.equal(flagValue(install, "--user"), "501:20");
  assert.deepEqual(flagValues(install, "--env").sort(), ["CI=1", "HOME=/tmp", "NO_COLOR=1"]);
  // Killable, like any other container Docket starts.
  assert.equal(flagValue(install, "--name"), "docket-install-1");
  assert.deepEqual(install.slice(-2), ["npm", "ci"]);
});

test("the run phase's network denial survives having dependencies", () => {
  // Guards the mistake that would make all of this worse than not doing it:
  // an install phase that needs the network, wired so the run phase inherits
  // it. The whole two-phase split exists to keep these apart.
  const list = argv({ mount: nested(), dependencies: DEPS });
  assert.equal(flagValue(list, "--network"), "none");
});

test("the volume is created labelled, so a reader can find what Docket left behind", () => {
  const create = createVolumeArgv("docker", DEPS.volume);

  assert.deepEqual(create, [
    "docker",
    "volume",
    "create",
    "--label",
    "docket=dependencies",
    DEPS.volume,
  ]);
  assert.deepEqual(removeVolumeArgv("podman", DEPS.volume), [
    "podman",
    "volume",
    "rm",
    "--force",
    DEPS.volume,
  ]);
});

test("a finished install is distinguishable from an abandoned one", () => {
  // Without a marker, a volume that exists is taken for a volume that is
  // populated, and a Docket killed halfway through npm ci leaves a half-install
  // that every later run silently trusts.
  const seal = sealVolumeArgv("docker", DEPS.volume, "501:20");
  const probe = probeVolumeArgv("docker", DEPS.volume);

  assert.deepEqual(seal.slice(-2), ["touch", ".docket-complete"]);
  assert.deepEqual(probe.slice(-2), ["ls", ".docket-complete"]);
  // Neither needs the network, and neither is a shell command.
  for (const list of [seal, probe]) {
    assert.equal(flagValue(list, "--network"), "none");
    assert.ok(!list.some((entry) => entry.includes(" ")), "no argument may be a command line");
  }
});

test("the volume is named for the dependency set it holds", async () => {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: {} });
  const base = await installed({ "package-lock.json": lock, "package.json": "{}" });
  const same = await installed({ "package-lock.json": lock, "package.json": "{}" });
  const changed = await installed({
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { a: {} } }),
    "package.json": "{}",
  });

  try {
    const one = await planDependencies(wholeRepo(base));
    const elsewhere = await planDependencies(wholeRepo(same));
    const later = await planDependencies(wholeRepo(changed));

    assert.equal(one.ok, true);
    assert.deepEqual(one.dependencies.install, ["npm", "ci"]);
    assert.equal(one.dependencies.target, "/workspace/node_modules");
    assert.equal(one.dependencies.caveat, "");

    // Stable, or every check pays for a fresh install it did not need.
    assert.equal((await planDependencies(wholeRepo(base))).dependencies.volume, one.dependencies.volume);
    // A changed lockfile lands somewhere else rather than mutating a volume an
    // earlier run already used and may still be reading.
    assert.notEqual(later.dependencies.volume, one.dependencies.volume);
    // Two checkouts never share, even agreeing on every dependency: one
    // repository's install scripts should not write what another then runs.
    assert.notEqual(elsewhere.dependencies.volume, one.dependencies.volume);
  } finally {
    await discard(base);
    await discard(same);
    await discard(changed);
  }
});

test("a workspace inside the repository installs into its own node_modules", async () => {
  const root = await installed({
    "apps/desktop/package-lock.json": "{}",
    "apps/desktop/package.json": "{}",
  });
  try {
    const plan = await planDependencies({ root, prefix: "apps/desktop", narrowed: "" });

    assert.equal(plan.ok, true);
    assert.equal(plan.dependencies.target, "/workspace/apps/desktop/node_modules");
  } finally {
    await discard(root);
  }
});

test("an npm workspaces monorepo is refused rather than half-served", async () => {
  // One lockfile at the root populates several node_modules at once. Shadowing
  // only the one this check runs in would hand it a dependency tree that is
  // partly the container's and partly this machine's, which is a worse answer
  // than saying it cannot be done.
  const root = await installed({
    "package-lock.json": "{}",
    "package.json": '{"workspaces":["apps/*"]}',
    "apps/desktop/package.json": "{}",
  });
  try {
    const plan = await planDependencies({ root, prefix: "apps/desktop", narrowed: "" });

    assert.equal(plan.ok, false);
    assert.match(plan.reason, /npm workspaces/);
    assert.match(plan.reason, /root/);
  } finally {
    await discard(root);
  }
});

test("a repository with no lockfile is installed anyway, and says what that costs", async () => {
  const root = await installed({ "package.json": '{"name":"thing"}' });
  try {
    const plan = await planDependencies(wholeRepo(root));

    assert.equal(plan.ok, true);
    // --no-package-lock because the repository is read-only during the install,
    // and an install that writes a lockfile into the tree under review would be
    // changing the thing it is there to check.
    assert.deepEqual(plan.dependencies.install, ["npm", "install", "--no-package-lock"]);
    assert.match(plan.dependencies.caveat, /not pinned/);
  } finally {
    await discard(root);
  }
});

test("the image ships the programs a repository's checks actually run", needsLinuxImages, async () => {
  const status = await detectRuntime(true);
  if (!status.command) return; // Nothing to run it in.

  // Not a hypothetical requirement. The slim image this used to be has no Git,
  // and running this repository's own suite inside it produced fifteen failures
  // reading "spawn git ENOENT" -- none of them in the code, every one of them
  // shaped like a finding. Shelling out to Git is what a repository's checks do.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const { stdout } = await run(
    status.command,
    ["run", "--rm", "--network", "none", DEFAULT_IMAGE, "git", "--version"],
    { timeout: 5 * 60 * 1000 },
  );

  assert.match(stdout, /git version/);
});

test("detection reports why there is no runtime rather than only that there is none", async () => {
  const status = await detectRuntime(true);

  if (status.command === null) {
    // The reason reaches the packet, so it has to name the remedy.
    assert.match(status.reason, /container runtime/i);
    assert.match(status.reason, /Docker|Podman/);
  } else {
    assert.ok(["docker", "podman"].includes(status.command));
    assert.equal(status.reason, "");
  }
});
