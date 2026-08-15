import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { containerArgv, detectRuntime, DEFAULT_IMAGE } = jiti("../src/main/container.ts");

// These assert the argument vector rather than a running container, because a
// container runtime is not present on most development machines or in CI. The
// flags are the security property, so they are pinned by name: a future edit
// that drops --network none should fail here rather than quietly widen what a
// repository's build script can reach.
function argv(overrides = {}) {
  return containerArgv({
    runtime: "docker",
    workspaceRoot: "/tmp/project",
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

test("only the workspace is mounted, and it is the working directory", () => {
  const list = argv({ workspaceRoot: "/home/dev/project" });

  assert.equal(flagValue(list, "--volume"), "/home/dev/project:/workspace");
  assert.equal(flagValue(list, "--workdir"), "/workspace");

  // Nothing else may be mounted: the home directory, the SSH keys and the
  // provider CLIs' credential files are the reason this exists.
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
