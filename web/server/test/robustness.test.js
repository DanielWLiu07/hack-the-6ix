// Load/robustness probing of the hub. Findings get FILED (status/server-test.md),
// not fixed - the hub owns the code.
//
// What "pass" means here:
//  - reconnect storm: hub survives and still serves a fresh client afterwards
//  - malformed payloads: hub doesn't crash, and ideally does NOT relay garbage
//    to other clients (relaying garbage = finding, reported via test failure)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connect, connected, waitFor, serverUp, sleep, SERVER_URL,
} from "./helpers.js";
import { validators } from "./schemas.js";

const up = await serverUp();
const skip = !up && `server not reachable at ${SERVER_URL} - start web/server first`;

test("survives a connect/disconnect storm", { skip, timeout: 30000 }, async () => {
  // 3 waves of 15 clients that connect, emit a burst, and drop with no goodbye.
  for (let wave = 0; wave < 3; wave++) {
    const sockets = Array.from({ length: 15 }, (_, i) => connect(i % 2 ? "robot" : "browser"));
    await Promise.allSettled(sockets.map((s) => connected(s, 4000)));
    for (const s of sockets) {
      for (let i = 0; i < 20; i++) s.emit("drive", { l: 0.1, r: -0.1 });
    }
    // half disconnect politely, half get destroyed mid-flight
    sockets.forEach((s, i) => (i % 2 ? s.close() : s.io.engine.close()));
    await sleep(100);
  }
  await sleep(300);
  // hub must still accept and serve a fresh client
  const probe = connect("browser");
  await connected(probe, 4000).catch(() => assert.fail("hub unresponsive to new connections after storm"));
  const t = await waitFor(probe, "telemetry", 5000).catch(() => null);
  probe.close();
  assert.ok(t !== null, "no telemetry within 5s after storm (sim/relay wedged?)");
});

const GARBAGE = [
  ["telemetry", null],
  ["telemetry", "not an object"],
  ["telemetry", { ts: "yesterday", battery_v: {}, state: "EXPLODE", arm: "long", drive: [] }],
  ["detection", { fruit: "durian", conf: -3 }],
  ["pick_event", { __proto__: null, bin: 42 }],
  ["lidar_scan", { ts: 0, points: [[1, 2, 3, 4], "x"] }],
  ["drive", { l: 9999, r: -9999 }],
  ["drive", { l: NaN, r: Infinity }], // serializes to null over socket.io
  ["arm_pose", { joints: Array.from({ length: 1000 }, () => 720) }],
  ["pick", { target: "everything" }],
  ["nl_command", { text: 12345 }],
  ["nonexistent_event", { foo: "bar" }],
];

test("malformed payloads don't crash the hub", { skip, timeout: 20000 }, async () => {
  const evil = connect("robot");
  await connected(evil);
  for (const [event, payload] of GARBAGE) evil.emit(event, payload);
  await sleep(500);
  evil.close();

  const probe = connect("browser");
  await connected(probe, 4000).catch(() => assert.fail("hub down after malformed payload barrage"));
  const t = await waitFor(probe, "telemetry", 5000).catch(() => null);
  probe.close();
  assert.ok(t !== null, "hub stopped emitting telemetry after malformed payloads");
});

test("malformed payloads are not relayed to other clients", { skip, timeout: 20000 }, async () => {
  const listener = connect("browser");
  await connected(listener);
  const relayedGarbage = [];
  for (const name of Object.keys(validators)) {
    listener.on(name, (p) => {
      const errs = validators[name](p);
      // sim also emits valid traffic on these events - only invalid payloads count
      if (errs.length) relayedGarbage.push(`${name}: ${errs.join("; ")} - ${JSON.stringify(p)?.slice(0, 120)}`);
    });
  }
  await sleep(200);

  const evil = connect("robot");
  await connected(evil);
  for (const [event, payload] of GARBAGE) evil.emit(event, payload);
  await sleep(1500);
  evil.close();
  listener.close();

  assert.deepEqual(relayedGarbage, [],
    `hub relayed schema-invalid payloads to clients (should validate/drop):\n${relayedGarbage.join("\n")}`);
});

test("oversized payload doesn't wedge the hub", { skip, timeout: 25000 }, async () => {
  const evil = connect("robot");
  await connected(evil);
  // ~5 MB lidar scan (socket.io default maxHttpBufferSize is 1 MB - server
  // should drop the message or the connection, never die)
  const huge = { ts: 0, points: Array.from({ length: 300000 }, () => [1.23456789, 2.3456789]) };
  evil.emit("lidar_scan", huge);
  await sleep(1000);
  evil.close();

  const probe = connect("browser");
  await connected(probe, 4000).catch(() => assert.fail("hub down after oversized payload"));
  const t = await waitFor(probe, "telemetry", 5000).catch(() => null);
  probe.close();
  assert.ok(t !== null, "hub stopped emitting telemetry after oversized payload");
});
