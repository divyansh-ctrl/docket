import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { PtyManager, consumeOutputRateBudget, createOutputRateBudget } = jiti(
  fileURLToPath(new URL("../src/main/pty-manager.ts", import.meta.url)),
);

class FakePty {
  dataListeners = [];
  exitListeners = [];
  killedWith = [];
  resizedTo = [];
  writes = [];

  onData(listener) {
    this.dataListeners.push(listener);
    return { dispose: () => undefined };
  }

  onExit(listener) {
    this.exitListeners.push(listener);
    return { dispose: () => undefined };
  }

  emitData(data) {
    this.dataListeners.forEach((listener) => listener(data));
  }

  emitExit(exitCode = 0, signal = 0) {
    this.exitListeners.forEach((listener) => listener({ exitCode, signal }));
  }

  kill(signal) {
    this.killedWith.push(signal);
  }

  resize(cols, rows) {
    this.resizedTo.push({ cols, rows });
  }

  write(data) {
    this.writes.push(data);
  }
}

test("early output and exit are delivered in order only after renderer attach", () => {
  const fakePty = new FakePty();
  const spawnCalls = [];
  const manager = new PtyManager((file, args, options) => {
    spawnCalls.push({ file, args, options });
    return fakePty;
  });
  const owner = { webContentsId: 11, frameRoutingId: 22 };
  const received = [];
  manager.on("data", (_eventOwner, event) => received.push({ type: "data", event }));
  manager.on("exit", (_eventOwner, event) => received.push({ type: "exit", event }));

  const started = manager.start({
    provider: "codex",
    purpose: "session",
    executable: "/trusted/canonical/codex.js",
    executableDirectory: "/trusted/invocation-bin",
    runtimeDirectory: "/trusted/node-bin",
    args: [],
    cwd: "/trusted/workspace",
    owner,
  });
  fakePty.emitData("early output\r\n");
  fakePty.emitExit(0, 0);
  assert.deepEqual(received, []);

  manager.resize(owner, started.terminalId, 100, 30);
  assert.equal(spawnCalls[0].file, "/trusted/canonical/codex.js");
  assert.deepEqual(received.map(({ type }) => type), ["data", "exit"]);
  assert.equal(received[0].event.data, "early output\r\n");
  assert.equal(received[1].event.exitCode, 0);
  assert.deepEqual(fakePty.resizedTo, []);
});

test("terminal output budget enforces a bounded burst and sustained refill", () => {
  const budget = createOutputRateBudget(0);
  const first = consumeOutputRateBudget(budget, "a".repeat(300 * 1024), 0);
  assert.equal(Buffer.byteLength(first.allowed), 256 * 1024);
  assert.equal(budget.droppedBytes, 44 * 1024);

  const second = consumeOutputRateBudget(budget, "b".repeat(256 * 1024), 250);
  assert.equal(Buffer.byteLength(second.allowed), 128 * 1024);
  assert.match(second.markerBefore, /45056 terminal output bytes/);
  assert.equal(budget.droppedBytes, 128 * 1024);

  const final = consumeOutputRateBudget(budget, "", 250, true);
  assert.match(final.markerBefore, /131072 terminal output bytes/);
  assert.equal(budget.droppedBytes, 0);
});
