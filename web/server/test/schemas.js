// Validators for the shared Socket.IO event schemas defined in root CLAUDE.md.
// Root CLAUDE.md is the single source of truth — if these disagree with it, THESE are wrong.
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
  if (!checkKeys(p, ["ts", "fruit", "ripeness", "bin", "success", "duration_ms"], errs)) return errs;
  req(p, "ts", isNum, "number (epoch ms)", errs);
  req(p, "fruit", (v) => FRUITS.includes(v), `one of ${FRUITS.join("|")}`, errs);
  req(p, "ripeness", (v) => RIPENESS.includes(v), `one of ${RIPENESS.join("|")}`, errs);
  req(p, "bin", (v) => BINS.includes(v), `one of ${BINS.join("|")}`, errs);
  req(p, "success", (v) => typeof v === "boolean", "boolean", errs);
  req(p, "duration_ms", (v) => isNum(v) && v >= 0, "non-negative number (ms)", errs);
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
  // schema: {} — empty object. Tolerate undefined (bare emit) but flag any keys.
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
};

export const ROBOT_TO_WEB_EVENTS = ["telemetry", "detection", "pick_event", "lidar_scan"];
export const WEB_TO_ROBOT_EVENTS = ["drive", "arm_pose", "pick", "estop", "nl_command"];
