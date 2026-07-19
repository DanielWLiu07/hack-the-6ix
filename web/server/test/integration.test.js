// Phase-2 integration tests: the NL-command (FarmHand) routing path and the
// robot-client persistence path, exercised end-to-end through the hub's hub.
//
// These run against a PRIVATE hub instance we spawn (Base44 forwarding OFF) so
// that (a) results are deterministic regardless of who's connected to the shared
// :3001 hub, and (b) the test pick_events we emit never reach the real Orchard OS
// webhook (the shared hub runs with BASE44 forwarding ON). See helpers.spawnHub.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  connectTo, connected, waitFor, sleep, spawnHub, SAMPLES,
} from "./helpers.js";
import { validators } from "./schemas.js";

const PORT = Number(process.env.TEST_HUB_PORT || 3999);
let hub; // { proc, url, close }

// Resolve true if `event` fires within `ms`, false if the window elapses first.
// Used for negative assertions ("this must NOT reach the robot").
function arrivesWithin(socket, event, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { socket.off(event, on); resolve(false); }, ms);
    const on = () => { clearTimeout(t); socket.off(event, on); resolve(true); };
    socket.on(event, on);
  });
}

before(async () => {
  hub = await spawnHub(PORT);
});

after(async () => {
  if (hub) await hub.close();
});

// NL command / FarmHand routing
test("hub routes nl_command from ui to the FarmHand agent", async () => {
  const ui = connectTo(hub.url, "ui");
  const agent = connectTo(hub.url, "agent");
  await Promise.all([connected(ui), connected(agent)]);
  await sleep(150);
  try {
    const gotByAgent = waitFor(agent, "nl_command", 3000);
    ui.emit("nl_command", SAMPLES.nl_command);

    const cmd = await gotByAgent;
    assert.deepEqual(validators.nl_command(cmd), [], "agent got a malformed nl_command");
    assert.equal(cmd.text, SAMPLES.nl_command.text);
  } finally {
    ui.close(); agent.close();
  }
});

// OBSERVED BEHAVIOR (not a failure): the hub also relays raw nl_command to
// robots, because nl_command sits in the hub's generic CONTROL_EVENTS list
// (index.js:83-92) which fan-outs to robots, in addition to the agent routing.
// Per docs/SCHEMAS.md, nl_command is meant to reach the robot only *structured*
// (via FarmHand -> nl_action). The robot ignores the raw copy, so this is
// harmless today - logged as an informational finding for the hub, not
// asserted here. This test pins the current behavior so a future change is
// visible in the diff.
test("hub currently also relays raw nl_command to robots (documents status quo)", async () => {
  const ui = connectTo(hub.url, "ui");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(ui), connected(robot)]);
  await sleep(150);
  try {
    const atRobot = arrivesWithin(robot, "nl_command", 800);
    ui.emit("nl_command", SAMPLES.nl_command);
    assert.equal(await atRobot, true, "status quo: raw nl_command reaches robots (see finding in status/server-test.md)");
  } finally {
    ui.close(); robot.close();
  }
});

test("nl_action(ok, action) is echoed to ui and forwarded to robot with mapped control", async () => {
  const ui = connectTo(hub.url, "ui");
  const agent = connectTo(hub.url, "agent");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(ui), connected(agent), connected(robot)]);
  await sleep(150);
  try {
    const uiGetsAction = waitFor(ui, "nl_action", 3000);
    const robotGetsAction = waitFor(robot, "nl_action", 3000);
    const robotGetsPick = waitFor(robot, "pick", 3000);

    agent.emit("nl_action", SAMPLES.nl_action); // {ok:true, action:{task:pick, fruit:apple,...}}

    const [echoed, forwarded, pick] = await Promise.all([uiGetsAction, robotGetsAction, robotGetsPick]);
    assert.deepEqual(validators.nl_action(echoed), [], "ui-echoed nl_action fails schema");
    assert.deepEqual(echoed, SAMPLES.nl_action, "nl_action mangled on ui echo");
    assert.deepEqual(forwarded, SAMPLES.nl_action, "nl_action mangled on robot forward");
    assert.deepEqual(validators.pick(pick), [], "mapped pick fails schema");
    assert.equal(pick.target, "apple", "pick.target should map from action.fruit");
  } finally {
    ui.close(); agent.close(); robot.close();
  }
});

test("nl_action(task:stop) maps to an estop on the robot", async () => {
  const agent = connectTo(hub.url, "agent");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(agent), connected(robot)]);
  await sleep(150);
  try {
    const robotGetsEstop = waitFor(robot, "estop", 3000);
    agent.emit("nl_action", {
      ts: 1752768000000, text: "stop", ok: true,
      action: { task: "stop", fruit: "any", filter: "any", zone: "any" },
    });
    const estop = await robotGetsEstop;
    assert.deepEqual(validators.estop(estop), [], "mapped estop fails schema");
  } finally {
    agent.close(); robot.close();
  }
});

test("nl_action(ok:false) is echoed to ui but NEVER forwarded to robot", async () => {
  const ui = connectTo(hub.url, "ui");
  const agent = connectTo(hub.url, "agent");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(ui), connected(agent), connected(robot)]);
  await sleep(150);
  try {
    const uiGets = waitFor(ui, "nl_action", 3000);
    const robotGetsAction = arrivesWithin(robot, "nl_action", 800);
    const robotGetsPick = arrivesWithin(robot, "pick", 800);

    agent.emit("nl_action", { ts: 1752768000000, text: "do a barrel roll", ok: false, error: "invalid_model_output" });

    const echoed = await uiGets;
    assert.deepEqual(validators.nl_action(echoed), [], "rejected nl_action fails schema");
    assert.equal(echoed.ok, false);
    assert.equal(await robotGetsAction, false, "ok:false nl_action must not reach robot");
    assert.equal(await robotGetsPick, false, "ok:false must not produce a robot command");
  } finally {
    ui.close(); agent.close(); robot.close();
  }
});

test("nl_action(clarification) is echoed to ui but NOT forwarded to robot", async () => {
  const ui = connectTo(hub.url, "ui");
  const agent = connectTo(hub.url, "agent");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(ui), connected(agent), connected(robot)]);
  await sleep(150);
  try {
    const uiGets = waitFor(ui, "nl_action", 3000);
    const robotGetsAction = arrivesWithin(robot, "nl_action", 800);

    agent.emit("nl_action", {
      ts: 1752768000000, text: "pick the fruit", ok: true, clarification: "Apples, bananas, or both?",
    });

    const echoed = await uiGets;
    assert.deepEqual(validators.nl_action(echoed), [], "clarification nl_action fails schema");
    assert.equal(echoed.clarification, "Apples, bananas, or both?");
    assert.equal(await robotGetsAction, false, "a clarification must not reach the robot");
  } finally {
    ui.close(); agent.close(); robot.close();
  }
});

test("nl_action from a non-agent (spoofing ui) is ignored", async () => {
  // Only role:agent may emit nl_action. A ui trying to inject one must be dropped.
  const ui = connectTo(hub.url, "ui");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(ui), connected(robot)]);
  await sleep(150);
  try {
    const robotGets = arrivesWithin(robot, "nl_action", 800);
    const robotGetsPick = arrivesWithin(robot, "pick", 800);
    ui.emit("nl_action", SAMPLES.nl_action);
    assert.equal(await robotGets, false, "ui-emitted nl_action must be ignored by hub");
    assert.equal(await robotGetsPick, false, "ui-emitted nl_action must not map to a robot command");
  } finally {
    ui.close(); robot.close();
  }
});

// robot-client persistence + control
test("robot pick_event is persisted and served by GET /api/picks", async () => {
  const robot = connectTo(hub.url, "robot");
  await connected(robot);
  await sleep(150);
  try {
    const marker = 1752768000123; // unique ts to find our exact row back
    const pick = { ...SAMPLES.pick_event, ts: marker };
    robot.emit("pick_event", pick);
    // give the async store write a beat
    let found = null;
    for (let i = 0; i < 20 && !found; i++) {
      await sleep(150);
      const res = await fetch(`${hub.url}/api/picks?limit=100`);
      assert.ok(res.ok, `/api/picks returned ${res.status}`);
      const rows = await res.json();
      assert.ok(Array.isArray(rows), "/api/picks must return an array");
      found = rows.find((r) => r.ts === marker) || null;
    }
    assert.ok(found, "emitted pick_event never showed up in /api/picks");
    for (const k of ["fruit", "ripeness", "bin", "success"]) {
      assert.equal(found[k], pick[k], `persisted pick_event.${k} mismatch`);
    }
  } finally {
    robot.close();
  }
});

test("robot detection is persisted and served by GET /api/detections", async () => {
  const robot = connectTo(hub.url, "robot");
  await connected(robot);
  await sleep(150);
  try {
    const marker = 1752768000456;
    robot.emit("detection", { ...SAMPLES.detection, ts: marker });
    let found = null;
    for (let i = 0; i < 20 && !found; i++) {
      await sleep(150);
      const res = await fetch(`${hub.url}/api/detections?limit=100`);
      assert.ok(res.ok, `/api/detections returned ${res.status}`);
      const rows = await res.json();
      assert.ok(Array.isArray(rows));
      found = rows.find((r) => r.ts === marker) || null;
    }
    assert.ok(found, "emitted detection never showed up in /api/detections");
    assert.equal(found.fruit, SAMPLES.detection.fruit);
  } finally {
    robot.close();
  }
});

test("ui control events (drive/arm_pose/pick/estop) reach the robot", async () => {
  const ui = connectTo(hub.url, "ui");
  const robot = connectTo(hub.url, "robot");
  await Promise.all([connected(ui), connected(robot)]);
  await sleep(150);
  try {
    for (const event of ["drive", "arm_pose", "pick", "estop"]) {
      const got = waitFor(robot, event, 3000);
      ui.emit(event, SAMPLES[event]);
      let payload;
      try { payload = await got; } catch { assert.fail(`hub did not relay ui "${event}" to robot`); }
      if (event === "estop") continue; // {} - nothing to compare
      const errs = validators[event](payload);
      assert.deepEqual(errs, [], `relayed ${event} fails schema: ${errs.join("; ")}`);
    }
  } finally {
    ui.close(); robot.close();
  }
});

test("robot connection reflects in GET /api/health", async () => {
  const robot = connectTo(hub.url, "robot");
  await connected(robot);
  await sleep(200);
  try {
    const res = await fetch(`${hub.url}/api/health`);
    const health = await res.json();
    assert.equal(health.ok, true);
    assert.ok(health.robot_connected, "health.robot_connected should be true with a robot online");
    assert.ok(health.clients.robot >= 1, "health.clients.robot should count our robot");
  } finally {
    robot.close();
  }
});
