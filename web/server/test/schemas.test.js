// Self-test for the validators — runs with NO server. If these fail, the
// conformance results mean nothing, so keep this green first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validators } from "./schemas.js";
import { SAMPLES } from "./helpers.js";

test("every sample payload passes its own validator", () => {
  for (const [event, validate] of Object.entries(validators)) {
    const errs = validate(SAMPLES[event]);
    assert.deepEqual(errs, [], `${event}: ${errs.join("; ")}`);
  }
});

const BAD = {
  telemetry: [
    { ...SAMPLES.telemetry, state: "FLYING" },
    { ...SAMPLES.telemetry, arm: [1, 2, 3] },
    { ...SAMPLES.telemetry, drive: { l: 0 } },
    { ...SAMPLES.telemetry, extra: 1 },
    { ...SAMPLES.telemetry, battery_v: "11.1" },
  ],
  detection: [
    { ...SAMPLES.detection, fruit: "kiwi" },
    { ...SAMPLES.detection, conf: 1.5 },
    { ...SAMPLES.detection, bbox: [1, 2, 3] },
  ],
  pick_event: [
    { ...SAMPLES.pick_event, bin: "mango_ripe" },
    { ...SAMPLES.pick_event, success: "yes" },
    { ...SAMPLES.pick_event, fruit: "apple", bin: "banana_ripe" },
  ],
  lidar_scan: [
    { ...SAMPLES.lidar_scan, points: [[1]] },
    { ...SAMPLES.lidar_scan, points: Array.from({ length: 361 }, () => [0, 0]) },
  ],
  drive: [{ l: 2, r: 0 }, { l: 0 }, { l: "0", r: 0 }],
  arm_pose: [{ joints: [1, 2, 3, 4] }, { joints: "none" }],
  pick: [{ target: "grape" }, {}],
  estop: [{ reason: "x" }],
  nl_command: [{ text: "" }, { txt: "hi" }, 42],
};

test("known-bad payloads are rejected", () => {
  for (const [event, cases] of Object.entries(BAD)) {
    for (const [i, payload] of cases.entries()) {
      const errs = validators[event](payload);
      assert.ok(errs.length > 0, `${event} bad case #${i} should have failed: ${JSON.stringify(payload)}`);
    }
  }
});
