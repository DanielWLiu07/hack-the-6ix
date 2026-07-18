// Light validators for the root-CLAUDE.md event schemas. Required fields must
// be present and well-typed; extra fields are allowed. Invalid payloads are
// dropped by the hub (never relayed, never persisted).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const FRUITS = ['apple', 'banana'];
const RIPENESS = ['ripe', 'unripe'];
const STATES = ['IDLE', 'SEEK', 'PICK', 'SORT', 'ESTOP'];

export const validators = {
  telemetry: (p) =>
    isNum(p.ts) &&
    isNum(p.battery_v) &&
    STATES.includes(p.state) &&
    Array.isArray(p.arm) && p.arm.length === 5 && p.arm.every(isNum) &&
    p.drive != null && isNum(p.drive.l) && isNum(p.drive.r),

  detection: (p) =>
    isNum(p.ts) &&
    FRUITS.includes(p.fruit) &&
    RIPENESS.includes(p.ripeness) &&
    isNum(p.conf) && p.conf >= 0 && p.conf <= 1 &&
    Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every(isNum),

  pick_event: (p) =>
    isNum(p.ts) &&
    FRUITS.includes(p.fruit) &&
    RIPENESS.includes(p.ripeness) &&
    typeof p.bin === 'string' &&
    typeof p.success === 'boolean' &&
    isNum(p.duration_ms),

  lidar_scan: (p) =>
    isNum(p.ts) &&
    Array.isArray(p.points) && p.points.length <= 360 &&
    p.points.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(isNum)),
};
