// Light validators for the root-CLAUDE.md event schemas. Required fields must
// be present and well-typed; extra fields are allowed. Invalid payloads are
// dropped by the hub (never relayed, never persisted).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
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

  // SLAM occupancy map (root CLAUDE.md addendum, master-approved). base64 uint8
  // grid, row-major, width*height bytes: 0=free 100=occupied 255=unknown.
  slam_map: (p) =>
    isNum(p.ts) &&
    isNum(p.resolution) && p.resolution > 0 &&
    isInt(p.width) && p.width >= 1 && p.width <= 128 &&
    isInt(p.height) && p.height >= 1 && p.height <= 128 &&
    Array.isArray(p.origin) && p.origin.length === 2 && p.origin.every(isNum) &&
    typeof p.data === 'string' && p.data.length > 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(p.data) &&
    Buffer.from(p.data, 'base64').length === p.width * p.height,

  // SLAM pose (root CLAUDE.md addendum). theta in radians.
  slam_pose: (p) =>
    isNum(p.ts) && isNum(p.x) && isNum(p.y) && isNum(p.theta),
};
