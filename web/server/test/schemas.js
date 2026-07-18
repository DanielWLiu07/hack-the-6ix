// Validators for the shared Socket.IO event schemas defined in root CLAUDE.md.
// Root CLAUDE.md is the single source of truth - if these disagree with it, THESE are wrong.
//
// Each validator takes a payload and returns an array of error strings (empty = valid).
// Unknown/extra keys are errors: the assignment says payloads must match the schemas
// *exactly*, and extra keys are how schema drift starts.

const STATES = ["IDLE", "SEEK", "PICK", "SORT", "ESTOP"];
const FRUITS = ["apple", "banana"];
const RIPENESS = ["ripe", "unripe"];
// 4 canonical bins; "apple"/"banana" allowed as the documented 2-bin fallback.
const BINS = ["apple_ripe", "apple_unripe", "banana_ripe", "banana_unripe", "apple", "banana"];
const PICK_TARGETS = ["nearest", "apple", "banana"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function checkKeys(obj, allowed, errs) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    errs.push(`payload is not an object (got ${obj === null ? "null" : Array.isArray(obj) ? "array" : typeof obj})`);
    return false;
  }
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errs.push(`unexpected key "${k}"`);
  }
  return true;
}

function req(obj, key, pred, desc, errs) {
  if (!(key in obj)) {
    errs.push(`missing key "${key}"`);
    return false;
  }
  if (!pred(obj[key])) {
    errs.push(`"${key}" invalid: expected ${desc}, got ${JSON.stringify(obj[key])?.slice(0, 80)}`);
    return false;
  }
  return true;
}

export function validateTelemetry(p) {
  const errs = [];
  if (!checkKeys(p, ["ts", "battery_v", "state", "arm", "drive"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "battery_v", isNum, "number (volts)", errs);
  req(p, "state", (v) => STATES.includes(v), `one of ${STATES.join("|")}`, errs);
  req(p, "arm", (v) => Array.isArray(v) && v.length === 5 && v.every(isNum), "array of exactly 5 numbers (degrees)", errs);
  if (req(p, "drive", (v) => v !== null && typeof v === "object" && !Array.isArray(v), "object {l,r}", errs)) {
    const d = p.drive;
    for (const k of Object.keys(d)) if (!["l", "r"].includes(k)) errs.push(`drive: unexpected key "${k}"`);
    req(d, "l", isNum, "number", errs);
    req(d, "r", isNum, "number", errs);
  }
  return errs;
}

export function validateDetection(p) {
  const errs = [];
  if (!checkKeys(p, ["ts", "fruit", "ripeness", "conf", "bbox"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "fruit", (v) => FRUITS.includes(v), `one of ${FRUITS.join("|")}`, errs);
  req(p, "ripeness", (v) => RIPENESS.includes(v), `one of ${RIPENESS.join("|")}`, errs);
  req(p, "conf", (v) => isNum(v) && v >= 0 && v <= 1, "number in [0,1]", errs);
  req(p, "bbox", (v) => Array.isArray(v) && v.length === 4 && v.every(isNum), "array [x,y,w,h] of 4 numbers", errs);
  return errs;
}

export function validatePickEvent(p) {
  const errs = [];
  // image_url is an OPTIONAL, master-ratified field (photo-per-pick; root CLAUDE.md).
  if (!checkKeys(p, ["ts", "fruit", "ripeness", "bin", "success", "duration_ms", "image_url"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "fruit", (v) => FRUITS.includes(v), `one of ${FRUITS.join("|")}`, errs);
  req(p, "ripeness", (v) => RIPENESS.includes(v), `one of ${RIPENESS.join("|")}`, errs);
  req(p, "bin", (v) => BINS.includes(v), `one of ${BINS.join("|")}`, errs);
  req(p, "success", (v) => typeof v === "boolean", "boolean", errs);
  req(p, "duration_ms", (v) => isNum(v) && v >= 0, "non-negative number (ms)", errs);
  // optional: only type-checked when present.
  if ("image_url" in p) req(p, "image_url", (v) => typeof v === "string" && v.length > 0, "non-empty string (photo URL)", errs);
  // consistency: bin should match fruit (+ ripeness when using 4 bins)
  if (typeof p.fruit === "string" && typeof p.bin === "string" && !p.bin.startsWith(p.fruit)) {
    errs.push(`bin "${p.bin}" inconsistent with fruit "${p.fruit}"`);
  }
  return errs;
}

export function validateLidarScan(p) {
  const errs = [];
  if (!checkKeys(p, ["ts", "points"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  if (req(p, "points", Array.isArray, "array of [x,y] pairs", errs)) {
    if (p.points.length > 360) errs.push(`points has ${p.points.length} entries (schema caps at 360)`);
    const bad = p.points.findIndex((pt) => !Array.isArray(pt) || pt.length !== 2 || !pt.every(isNum));
    if (bad !== -1) errs.push(`points[${bad}] is not a [x,y] number pair: ${JSON.stringify(p.points[bad])?.slice(0, 40)}`);
  }
  return errs;
}

export function validateDrive(p) {
  const errs = [];
  if (!checkKeys(p, ["l", "r"], errs)) return errs;
  req(p, "l", (v) => isNum(v) && v >= -1 && v <= 1, "number in [-1,1]", errs);
  req(p, "r", (v) => isNum(v) && v >= -1 && v <= 1, "number in [-1,1]", errs);
  return errs;
}

export function validateArmPose(p) {
  const errs = [];
  if (!checkKeys(p, ["joints"], errs)) return errs;
  req(p, "joints", (v) => Array.isArray(v) && v.length === 5 && v.every(isNum), "array of exactly 5 numbers (degrees)", errs);
  return errs;
}

export function validatePick(p) {
  const errs = [];
  if (!checkKeys(p, ["target"], errs)) return errs;
  req(p, "target", (v) => PICK_TARGETS.includes(v), `one of ${PICK_TARGETS.join("|")}`, errs);
  return errs;
}

export function validateEstop(p) {
  const errs = [];
  // schema: {} - empty object. Tolerate undefined (bare emit) but flag any keys.
  if (p === undefined) return errs;
  checkKeys(p, [], errs);
  return errs;
}

export function validateNlCommand(p) {
  const errs = [];
  if (!checkKeys(p, ["text"], errs)) return errs;
  req(p, "text", (v) => typeof v === "string" && v.length > 0, "non-empty string", errs);
  return errs;
}

// nl_action - FarmHand LLM reply. NOT in root CLAUDE.md; contract owned by
// llm-client (see status/llm-client.md 22:05) and consumed by server-core's hub
// (index.js). Shape: {ts, text, ok, <one of action|clarification|error>}.
//   action:        {task, fruit, filter, zone} - every key required (llm-client 22:11)
//   clarification: string (ok:true, no action - hub echoes to ui, does NOT forward to robot)
//   error:         string (ok:false - never forwarded to robot)
const NL_TASKS = ["pick", "sort", "stop", "drive"];
const NL_FRUITS = ["apple", "banana", "any"];
const NL_FILTERS = ["ripe", "unripe", "any"];
const NL_ZONES = ["any", "left", "right", "forward", "backward", "home"];

export function validateNlAction(p) {
  const errs = [];
  if (!checkKeys(p, ["ts", "text", "ok", "action", "clarification", "error"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "text", (v) => typeof v === "string", "string (echo of original command)", errs);
  req(p, "ok", (v) => typeof v === "boolean", "boolean", errs);

  const has = (k) => k in p && p[k] !== undefined;
  const outcomes = ["action", "clarification", "error"].filter(has);
  if (outcomes.length !== 1) {
    errs.push(`nl_action must carry exactly one of action|clarification|error, got [${outcomes.join(",") || "none"}]`);
  }

  if (has("action")) {
    if (p.ok !== true) errs.push(`action present but ok is ${p.ok} (must be true)`);
    if (checkKeys(p.action, ["task", "fruit", "filter", "zone"], errs)) {
      req(p.action, "task", (v) => NL_TASKS.includes(v), `one of ${NL_TASKS.join("|")}`, errs);
      req(p.action, "fruit", (v) => NL_FRUITS.includes(v), `one of ${NL_FRUITS.join("|")}`, errs);
      req(p.action, "filter", (v) => NL_FILTERS.includes(v), `one of ${NL_FILTERS.join("|")}`, errs);
      req(p.action, "zone", (v) => NL_ZONES.includes(v), `one of ${NL_ZONES.join("|")}`, errs);
    }
  }
  if (has("clarification")) {
    if (p.ok !== true) errs.push(`clarification present but ok is ${p.ok} (must be true)`);
    if (typeof p.clarification !== "string" || !p.clarification.length) errs.push(`clarification must be a non-empty string`);
  }
  if (has("error")) {
    if (p.ok !== false) errs.push(`error present but ok is ${p.ok} (must be false)`);
    if (typeof p.error !== "string" || !p.error.length) errs.push(`error must be a non-empty string`);
  }
  return errs;
}

// SLAM map + pose (root CLAUDE.md "Schema addendum: SLAM map", master-approved).
// robot -> web, max 0.5 Hz. Occupancy grid capped at 128x128 cells; `data` is a
// base64 uint8 grid (0=free, 100=occupied, 255=unknown) of exactly width*height
// bytes. Producer: lidar SLAM node (sim + Pi). Consumer: web lidar page.
const isInt = (v) => Number.isInteger(v);

export function validateSlamMap(p) {
  const errs = [];
  if (!checkKeys(p, ["ts", "resolution", "width", "height", "origin", "data"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "resolution", (v) => isNum(v) && v > 0, "positive number (m/cell)", errs);
  const okW = req(p, "width", (v) => isInt(v) && v >= 1 && v <= 128, "integer 1..128 (cells)", errs);
  const okH = req(p, "height", (v) => isInt(v) && v >= 1 && v <= 128, "integer 1..128 (cells)", errs);
  req(p, "origin", (v) => Array.isArray(v) && v.length === 2 && v.every(isNum), "array [x,y] of 2 numbers (m)", errs);
  if (req(p, "data", (v) => typeof v === "string" && v.length > 0, "non-empty base64 string", errs)) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) {
      errs.push("data is not valid base64");
    } else if (okW && okH) {
      let bytes = -1;
      try { bytes = Buffer.from(p.data, "base64").length; } catch { /* reported below */ }
      const expected = p.width * p.height;
      if (bytes !== expected) errs.push(`data decodes to ${bytes} bytes, expected width*height=${expected}`);
    }
  }
  return errs;
}

export function validateSlamPose(p) {
  const errs = [];
  if (!checkKeys(p, ["ts", "x", "y", "theta"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "x", isNum, "number (m)", errs);
  req(p, "y", isNum, "number (m)", errs);
  req(p, "theta", isNum, "number (radians)", errs);
  return errs;
}

// event name → validator, for both directions
export const validators = {
  telemetry: validateTelemetry,
  detection: validateDetection,
  pick_event: validatePickEvent,
  lidar_scan: validateLidarScan,
  drive: validateDrive,
  arm_pose: validateArmPose,
  pick: validatePick,
  estop: validateEstop,
  nl_command: validateNlCommand,
  nl_action: validateNlAction,
  slam_map: validateSlamMap,
  slam_pose: validateSlamPose,
};

export const ROBOT_TO_WEB_EVENTS = ["telemetry", "detection", "pick_event", "lidar_scan", "slam_map", "slam_pose"];
export const WEB_TO_ROBOT_EVENTS = ["drive", "arm_pose", "pick", "estop", "nl_command"];
// SLAM map + pose are now relayed by server-core's hub (index.js ROBOT_EVENTS),
// so they live in ROBOT_TO_WEB_EVENTS above and the live-relay conformance test
// covers them. Kept as a named subset for callers that want just the SLAM pair.
export const SLAM_ROBOT_TO_WEB_EVENTS = ["slam_map", "slam_pose"];
