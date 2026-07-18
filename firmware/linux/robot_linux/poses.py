"""Named-pose store: load/save poses.json, replay sequences on a bridge.

poses.json format:
{
  "poses":     {"home": [90,90,90,90,120], ...},
  "sequences": {"pick": [["approach",800],["grip_close",400],["lift",800]], ...}
}
Sequence steps are [pose_name, duration_ms].
"""

import json
import time
from pathlib import Path

from . import config

DEFAULT_POSES = {
    # [base, shoulder, elbow, wrist, gripper] degrees - placeholders until
    # real arm is jogged with the pose recorder.
    "zero": [90, 90, 90, 90, 90],
    "home": [90, 100, 60, 90, config.GRIPPER_OPEN],
    "seek": [90, 80, 70, 100, config.GRIPPER_OPEN],
    "approach": [90, 60, 95, 110, config.GRIPPER_OPEN],
    "grip_close": [90, 60, 95, 110, config.GRIPPER_CLOSED],
    "lift": [90, 95, 70, 95, config.GRIPPER_CLOSED],
    # Bin drop poses - one per class, carried with gripper closed.
    "apple_ripe": [30, 95, 70, 95, config.GRIPPER_CLOSED],
    "apple_unripe": [60, 95, 70, 95, config.GRIPPER_CLOSED],
    "banana_ripe": [120, 95, 70, 95, config.GRIPPER_CLOSED],
    "banana_unripe": [150, 95, 70, 95, config.GRIPPER_CLOSED],
}

DEFAULT_SEQUENCES = {
    "pick": [["approach", 900], ["grip_close", 500], ["lift", 900]],
    "drop": [["grip_open_here", 400]],  # special-cased: open gripper in place
    "home": [["home", 1200]],
}


class PoseStore:
    def __init__(self, path: Path = config.POSES_PATH):
        self.path = Path(path)
        self.poses = {}
        self.sequences = {}
        self.load()

    def load(self):
        if self.path.exists():
            data = json.loads(self.path.read_text())
            self.poses = {k: config.clamp_joints(v) for k, v in data.get("poses", {}).items()}
            self.sequences = data.get("sequences", {})
        # backfill any missing defaults without clobbering recorded poses
        for k, v in DEFAULT_POSES.items():
            self.poses.setdefault(k, config.clamp_joints(v))
        for k, v in DEFAULT_SEQUENCES.items():
            self.sequences.setdefault(k, v)

    def save(self):
        self.path.write_text(json.dumps(
            {"poses": self.poses, "sequences": self.sequences}, indent=2) + "\n")

    def get(self, name):
        return list(self.poses[name])

    def set(self, name, joints):
        self.poses[name] = config.clamp_joints(joints)

    def replay_pose(self, bridge, name, duration_ms=1000, wait=True):
        bridge.move_servos(self.get(name), duration_ms)
        if wait:
            time.sleep(duration_ms / 1000.0)

    def replay_sequence(self, bridge, name, wait=True, speed=1.0):
        """Run a named sequence. speed>1 is faster. Returns total ms."""
        total = 0
        for step in self.sequences[name]:
            pose_name, dur = step[0], int(step[1] / speed)
            if pose_name == "grip_open_here":
                joints = bridge.get_joints()
                joints[4] = config.GRIPPER_OPEN
                bridge.move_servos(joints, dur)
            else:
                bridge.move_servos(self.get(pose_name), dur)
            if wait:
                time.sleep(dur / 1000.0)
            total += dur
        return total
