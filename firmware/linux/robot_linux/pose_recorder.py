"""Interactive pose recorder/replayer — the P0 arm-bringup tool.

Jog joints from the keyboard, save named poses to poses.json, replay poses
and sequences. Works against MockBridge (--sim, default off-hardware) or the
real App Lab bridge.

Run:  python -m robot_linux.pose_recorder --sim

Keys:
  1-5        select joint (base/shoulder/elbow/wrist/gripper)
  a / d      jog selected joint -step / +step
  A / D      jog by 5x step
  [ / ]      halve / double step size
  o / c      gripper open / close
  s          save current joints as a named pose (prompts for name)
  g          go to a named pose (prompts)
  p          run a named sequence (prompts; e.g. pick, home)
  l          list poses & sequences
  h          go home
  z          go to zero
  w          write poses.json to disk
  q          quit (asks to save if dirty)
"""

import argparse
import sys
import termios
import tty

from . import config
from .bridge import MockBridge
from .poses import PoseStore


def _getch():
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return ch


def _prompt(msg):
    # temporary cooked mode for line input
    return input(msg).strip()


def _print_state(joints, sel, step):
    parts = []
    for i, (name, j) in enumerate(zip(config.JOINT_NAMES, joints)):
        mark = ">" if i == sel else " "
        parts.append(f"{mark}{name}:{j:6.1f}")
    print(f"\r{'  '.join(parts)}  step={step:4.1f}   ", end="", flush=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Jog joints, record named poses")
    ap.add_argument("--sim", action="store_true", help="use MockBridge (no hardware)")
    ap.add_argument("--poses", default=str(config.POSES_PATH), help="poses.json path")
    args = ap.parse_args(argv)

    if args.sim:
        bridge = MockBridge()
    else:
        try:
            from .bridge import AppLabBridge
            bridge = AppLabBridge()
        except RuntimeError as e:
            print(f"{e}\nFalling back to --sim.")
            bridge = MockBridge()

    store = PoseStore(args.poses)
    joints = config.clamp_joints(bridge.get_joints())
    sel, step, dirty = 0, 2.0, False

    print(__doc__)
    print(f"poses file: {store.path}  ({len(store.poses)} poses)")
    _print_state(joints, sel, step)

    while True:
        ch = _getch()
        if ch in "12345":
            sel = int(ch) - 1
        elif ch in ("a", "d", "A", "D"):
            mult = 5 if ch in "AD" else 1
            sign = -1 if ch in "aA" else 1
            joints[sel] += sign * step * mult
            joints = config.clamp_joints(joints)
            bridge.move_servos(joints, 80)
        elif ch == "[":
            step = max(0.5, step / 2)
        elif ch == "]":
            step = min(20.0, step * 2)
        elif ch == "o":
            joints[4] = config.GRIPPER_OPEN
            bridge.move_servos(joints, 300)
        elif ch == "c":
            joints[4] = config.GRIPPER_CLOSED
            bridge.move_servos(joints, 300)
        elif ch == "s":
            print()
            name = _prompt("save as pose name: ")
            if name:
                store.set(name, joints)
                dirty = True
                print(f"saved '{name}' = {[round(j,1) for j in joints]}")
        elif ch == "g":
            print()
            name = _prompt("go to pose: ")
            if name in store.poses:
                joints = store.get(name)
                bridge.move_servos(joints, 1000)
            else:
                print(f"no pose '{name}'")
        elif ch == "p":
            print()
            name = _prompt("run sequence: ")
            if name in store.sequences:
                store.replay_sequence(bridge, name)
                joints = config.clamp_joints(bridge.get_joints())
            else:
                print(f"no sequence '{name}'")
        elif ch == "l":
            print()
            for n, p in store.poses.items():
                print(f"  pose {n:16s} {[round(j,1) for j in p]}")
            for n, s in store.sequences.items():
                print(f"  seq  {n:16s} {s}")
        elif ch == "h":
            joints = store.get("home")
            bridge.move_servos(joints, 1200)
        elif ch == "z":
            joints = store.get("zero")
            bridge.move_servos(joints, 1200)
        elif ch == "w":
            store.save()
            dirty = False
            print(f"\nwrote {store.path}")
        elif ch in ("q", "\x03"):  # q or Ctrl-C
            if dirty:
                print()
                if _prompt("unsaved poses — save? [y/N] ").lower() == "y":
                    store.save()
                    print(f"wrote {store.path}")
            print()
            return 0
        _print_state(joints, sel, step)


if __name__ == "__main__":
    sys.exit(main())
