"""All tunables in one place, overridable via environment variables."""

import os


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# Where the laptop Socket.IO hub lives (see docs/ASSIGNMENTS: port 3001)
SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:3001")

# Serial device. Empty string = autodetect.
LIDAR_PORT = os.environ.get("LIDAR_PORT", "")
LIDAR_BAUD = _env_int("LIDAR_BAUD", 115200)  # RPLIDAR A1/A2 default

# Emit rate (root CLAUDE.md: ~2 Hz)
EMIT_HZ = _env_float("EMIT_HZ", 2.0)

# Max points per lidar_scan payload (root CLAUDE.md: ≤360)
MAX_POINTS = _env_int("MAX_POINTS", 360)

# Discard returns outside this range (meters). A1 spec is 0.15–12 m.
MIN_RANGE_M = _env_float("MIN_RANGE_M", 0.10)
MAX_RANGE_M = _env_float("MAX_RANGE_M", 12.0)

# Mounting: degrees added to every lidar angle so that 0° = robot forward.
ANGLE_OFFSET_DEG = _env_float("ANGLE_OFFSET_DEG", 0.0)

# RPLIDAR reports angles clockwise when viewed from above; robot frame is
# x forward / y left (right-handed, counter-clockwise positive). Set to 1
# if your unit is mounted upside down (flips to counter-clockwise).
ANGLE_CCW = _env_int("ANGLE_CCW", 0)

# Reconnect/backoff behavior
RETRY_DELAY_S = _env_float("RETRY_DELAY_S", 3.0)

# LIDAR_MOCK=1: no hardware - synthesize sweeps (tests the full pipeline,
# and is the demo fallback if the lidar dies at the venue).
LIDAR_MOCK = _env_int("LIDAR_MOCK", 0)
