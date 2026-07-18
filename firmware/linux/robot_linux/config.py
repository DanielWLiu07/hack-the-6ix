"""Central config. Everything overridable via env so venue setup is just exports."""

import os
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
LINUX_DIR = PKG_DIR.parent          # firmware/linux/
REPO_ROOT = LINUX_DIR.parent.parent  # repo root

SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:3001")

POSES_PATH = Path(os.environ.get("POSES_PATH", LINUX_DIR / "poses.json"))

# Model artifacts exported by ml/ripeness (vision-train worker)
MODEL_PATH = Path(os.environ.get("MODEL_PATH", REPO_ROOT / "ml/ripeness/export/model.onnx"))
CLASSES_PATH = Path(os.environ.get("CLASSES_PATH", REPO_ROOT / "ml/ripeness/export/classes.json"))

# vision-infer's HSV fallback detector lives here
HSV_DETECTOR_DIR = Path(os.environ.get("HSV_DETECTOR_DIR", REPO_ROOT / "robot/vision"))

CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "0"))
FRAME_W = int(os.environ.get("FRAME_W", "640"))
FRAME_H = int(os.environ.get("FRAME_H", "480"))

# Joints: [base_yaw, shoulder, elbow, wrist, gripper] in degrees.
NUM_JOINTS = 5
JOINT_NAMES = ["base", "shoulder", "elbow", "wrist", "gripper"]
JOINT_MIN = [0, 0, 0, 0, 0]
JOINT_MAX = [180, 180, 180, 180, 180]

# Gripper positions (degrees on joint index 4)
GRIPPER_OPEN = 120
GRIPPER_CLOSED = 45

TELEMETRY_HZ = 5.0
TICK_HZ = 20.0          # state machine tick rate
HEARTBEAT_HZ = 5.0      # MCU watchdog kills motion after 500 ms silence

# ALIGN (visual servoing)
ALIGN_TOL_FRAC = 0.06        # bbox center within ±6% of frame center = aligned
ALIGN_GAIN_DEG = 12.0        # proportional gain: full-frame error -> this many degrees
ALIGN_SETTLE_TICKS = 4       # consecutive in-tolerance ticks before ALIGN completes
ALIGN_MAX_TICKS = 200        # give up and go back to SEEK
SEEK_MAX_TICKS = 400         # one full scan sweep budget before re-centering

# APPROACH (drive-to-fruit): reactive base navigation between SEEK and ALIGN.
# Creep toward a detected fruit, steering to keep it centered, until its bbox is
# big enough to be in arm reach. Vision-only, no odometry. Tune here.
APPROACH_FWD = 0.5           # constant forward creep speed, normalized drive
APPROACH_TURN_GAIN = 0.6     # steer gain: bbox x-error [-1..1] -> tank differential
APPROACH_AREA_FRAC = 0.10    # bbox area / frame area >= this => in reach, stop
APPROACH_MAX_TICKS = 300     # ~15 s at TICK_HZ before giving up -> back to SEEK

MIN_CONF = float(os.environ.get("MIN_CONF", "0.5"))

BINS = ["apple_ripe", "apple_unripe", "banana_ripe", "banana_unripe"]


def clamp_joints(joints):
    """Clamp a 5-joint pose to limits; tolerates lists shorter than NUM_JOINTS."""
    out = []
    for i, j in enumerate(joints[:NUM_JOINTS]):
        out.append(max(JOINT_MIN[i], min(JOINT_MAX[i], float(j))))
    while len(out) < NUM_JOINTS:
        out.append(90.0)
    return out
