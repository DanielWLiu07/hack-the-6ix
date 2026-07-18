// Schema conformance against the LIVE hub (server-core on :3001).
// A fake browser listens for sim traffic and validates every payload;
// a fake robot + fake browser pair verifies the hub relays every event
// type in both directions without mangling payloads.
//
// If the server isn't up, the whole suite is skipped (clearly), not failed -
// so `npm test` stays meaningful before server-core lands.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  connect, connected, collect, waitFor, serverUp, sleep,
  SAMPLES, SERVER_URL,
} from "./helpers.js";
import { validators, ROBOT_TO_WEB_EVENTS, WEB_TO_ROBOT_EVENTS } from "./schemas.js";

const up = await serverUp();

test("hub reachable", { skip: !up && `server not reachable at ${SERVER_URL} - start web/server first` }, () => {
  assert.ok(up);
});

test("sim traffic conforms to schemas", { skip: !up, timeout: 60000 }, async () => {
  const browser = connect("browser");
  await connected(browser);
  try {
    // telemetry is 5 Hz; measured sim cadence: detection ~every 10s,
    // pick_event follows a full sim pick cycle (can exceed 30s) - so long
    // windows for those, and pick_event absence is a warning, not a failure.
    const results = await Promise.all([
      collect(browser, "telemetry", 10, 6000),
      collect(browser, "detection", 3, 35000),
      collect(browser, "pick_event", 2, 45000),
      collect(browser, "lidar_scan", 3, 6000),
    ]);
    const [telemetry, detection, pick_event, lidar_scan] = results;

    assert.ok(telemetry.length >= 5, `expected ≥5 telemetry in 6s (5 Hz sim), got ${telemetry.length}`);

    const failures = [];
    for (const [event, payloads] of [
      ["telemetry", telemetry], ["detection", detection],
      ["pick_event", pick_event], ["lidar_scan", lidar_scan],
    ]) {
      if (payloads.length === 0 && !["telemetry", "pick_event"].includes(event)) {
        failures.push(`${event}: sim emitted none in the window (should be periodic)`);
      }
      if (payloads.length === 0 && event === "pick_event") {
        console.warn("warning: no pick_event in 45s window (sim pick cycle may be longer) - schema unchecked this run");
      }
      for (const p of payloads) {
        const errs = validators[event](p);
        if (errs.length) failures.push(`${event}: ${errs.join("; ")} - payload ${JSON.stringify(p).slice(0, 200)}`);
      }
    }
    assert.deepEqual(failures, [], `\n${failures.join("\n")}`);
  } finally {
    browser.close();
  }
});

test("hub relays robot→web events verbatim", { skip: !up, timeout: 15000 }, async () => {
  const robot = connect("robot");
  const browser = connect("browser");
  await Promise.all([connected(robot), connected(browser)]);
  await sleep(200);
  try {
    for (const event of ROBOT_TO_WEB_EVENTS) {
      const p = waitFor(browser, event, 4000);
      robot.emit(event, SAMPLES[event]);
      let got;
      try {
        got = await p;
      } catch {
        assert.fail(`hub did not relay "${event}" from robot to browser within 4s`);
      }
      // sim traffic can interleave on telemetry-family events; only assert
      // exact match when the payload is ours (matched by our fixed ts).
      if (got.ts === SAMPLES[event].ts) {
        assert.deepEqual(got, SAMPLES[event], `"${event}" payload was mangled in relay`);
      }
      const errs = validators[event](got);
      assert.deepEqual(errs, [], `relayed "${event}" fails schema: ${errs.join("; ")}`);
    }
  } finally {
    robot.close();
    browser.close();
  }
});

test("hub relays web→robot commands verbatim", { skip: !up, timeout: 15000 }, async () => {
  const robot = connect("robot");
  const browser = connect("browser");
  await Promise.all([connected(robot), connected(browser)]);
  await sleep(200);
  try {
    // nl_command is excluded: per root CLAUDE.md it routes web → server →
    // FarmHand LLM → robot (structured), so a verbatim relay isn't required.
    for (const event of WEB_TO_ROBOT_EVENTS.filter((e) => e !== "nl_command")) {
      const p = waitFor(robot, event, 4000);
      browser.emit(event, SAMPLES[event]);
      let got;
      try {
        got = await p;
      } catch {
        assert.fail(`hub did not relay "${event}" from browser to robot within 4s`);
      }
      if (event === "estop") {
        // bare emit (undefined) or {} both count as a valid e-stop
        assert.ok(got === undefined || (typeof got === "object" && got !== null && Object.keys(got).length === 0),
          `estop relayed with unexpected payload: ${JSON.stringify(got)}`);
      } else {
        assert.deepEqual(got, SAMPLES[event], `"${event}" payload was mangled in relay`);
      }
    }
  } finally {
    robot.close();
    browser.close();
  }
});
