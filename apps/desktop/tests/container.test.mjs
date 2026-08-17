import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  canSeeWorkspace,
  containerArgv,
  containerName,
  killArgv,
  mountProbeArgv,
  resolveMount,
  workspaceOnly,
  detectRuntime,
  DEFAULT_IMAGE,
} = jiti("../src/main/container.ts");

/** The common case: the workspace is the repository, so nothing is nested. */
function wholeRepo(root) {
  return { root, prefix: "", narrowed: "" };
}

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

  // Only the two flags that make runners non-interactive. A blanket --env-file
  // or a passthrough of process.env would hand the script every secret the app
  // was launched with.
  assert.deepEqual(passed.sort(), ["CI=1", "NO_COLOR=1"]);
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

  assert.equal(mount.narrowed, "");
  assert.ok(process.cwd().startsWith(mount.root), "the mount must contain the workspace");
  assert.notEqual(mount.root, process.cwd(), "this package is not the repository root");
  assert.equal(`${mount.root}/${mount.prefix}`, process.cwd());
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
