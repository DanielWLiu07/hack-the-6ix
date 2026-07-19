"""Offline tests for the fw-linux pick/sort pipeline and robot node.

No sockets, no hardware: MockBridge + MockCamera + MockDetector run the state
machine at a large `speed` so moves are instant. Run: pytest -q
"""

import time

import pytest

from robot_linux import config
from robot_linux.bridge import MockBridge
from robot_linux.camera import MockCamera
from robot_linux.detector import Detection, MockDetector, _iou, _nms
from robot_linux.poses import PoseStore
from robot_linux.servoing import bbox_error, is_centered, servo_step
from robot_linux.state_machine import IDLE, SEEK, PickStateMachine, ESTOP


# speed high enough that every move duration (max 1400 ms) rounds to 0 ms via
# _dur() -> moves complete instantly, so the cycle is deterministic and does
# not depend on wall-clock timing between ticks.
INSTANT = 10000.0


def _run(sm, bridge, max_ticks=2000, until_idle=True):
    for i in range(max_ticks):
        sm.tick()
        bridge.heartbeat()
        if until_idle and i > 3 and sm.state == IDLE:
            return i
    return -1


def _machine(seed=1, speed=INSTANT, **kw):
    b = MockBridge()
    c = MockCamera(b, seed=seed)
    d = MockDetector(c)
    sm = PickStateMachine(b, c, d, PoseStore(), speed=speed, **kw)
    return sm, b, c


# state machine

def test_full_pick_cycle_emits_schema_events():
    events = []
    sm, b, _ = _machine()
    sm.on_emit = lambda k, v: events.append((k, v))
    sm.continuous = False
    sm.start("nearest")
    assert _run(sm, b) > 0, "never returned to IDLE"

    picks = [v for k, v in events if k == "pick_event"]
    dets = [v for k, v in events if k == "detection"]
    assert len(picks) == 1
    assert len(dets) >= 1

    pk = picks[0]
    assert set(pk) == {"ts", "fruit", "ripeness", "bin", "success", "duration_ms"}
    assert pk["fruit"] in ("apple", "banana")
    assert pk["ripeness"] in ("ripe", "unripe")
    assert pk["bin"] == f"{pk['fruit']}_{pk['ripeness']}"
    assert pk["bin"] in config.BINS
    assert pk["success"] is True
    assert pk["duration_ms"] >= 0

    dv = dets[0]
    assert set(dv) == {"ts", "fruit", "ripeness", "conf", "bbox"}
    assert len(dv["bbox"]) == 4


def test_visits_all_states_in_order():
    seen = []
    sm, b, _ = _machine()
    sm.on_emit = lambda k, v: seen.append(v) if k == "state" else None
    sm.continuous = False
    sm.start("nearest")
    _run(sm, b)
    for s in ("SEEK", "ALIGN", "PICK", "SORT", "DROP"):
        assert s in seen, f"never entered {s}: {seen}"


def test_target_filter_only_picks_matching_fruit():
    events = []
    sm, b, cam = _machine(seed=5)
    cam.spawn_fruit(fruit="banana", ripeness="ripe")
    sm.on_emit = lambda k, v: events.append((k, v))
    sm.continuous = False
    sm.start({"fruit": "banana"})
    _run(sm, b)
    picks = [v for k, v in events if k == "pick_event"]
    assert picks and picks[0]["fruit"] == "banana"


def test_estop_is_latched_and_ignores_start():
    sm, b, _ = _machine()
    sm.start("nearest")
    sm.tick()
    sm.estop()
    assert sm.state == ESTOP
    assert b.estopped
    sm.start("nearest")          # ignored while latched
    assert sm.state == ESTOP
    sm.clear_estop()
    assert sm.state == IDLE
    assert not b.estopped


# servoing

def test_bbox_error_signs():
    ex, ey = bbox_error([config.FRAME_W - 90, config.FRAME_H - 90, 90, 90])
    assert ex > 0 and ey > 0
    ex, ey = bbox_error([0, 0, 90, 90])
    assert ex < 0 and ey < 0


def test_centered_bbox_is_centered():
    cx, cy = config.FRAME_W / 2, config.FRAME_H / 2
    assert is_centered([cx - 45, cy - 45, 90, 90])


def test_servo_step_moves_toward_target_and_clamps():
    joints = [90, 90, 90, 90, 90]
    # target far right/bottom -> base and shoulder increase
    new = servo_step(joints, [config.FRAME_W - 90, config.FRAME_H - 90, 90, 90])
    assert new[0] > 90 and new[1] > 90
    assert new[2:] == joints[2:]  # elbow/wrist/gripper untouched
    # extreme error still clamps within limits
    for j in servo_step([180, 180, 90, 90, 90], [10 * config.FRAME_W, 0, 90, 90]):
        assert 0 <= j <= 180


# detector

def test_nms_dedupes_overlapping_boxes():
    a = Detection("apple", "ripe", 0.9, [0, 0, 100, 100])
    b = Detection("apple", "ripe", 0.5, [10, 10, 100, 100])   # heavy overlap
    c = Detection("banana", "ripe", 0.8, [400, 400, 50, 50])  # disjoint
    kept = _nms([a, b, c])
    assert a in kept and c in kept and b not in kept
    assert _iou([0, 0, 100, 100], [0, 0, 100, 100]) == pytest.approx(1.0)
    assert _iou([0, 0, 10, 10], [100, 100, 10, 10]) == 0.0


# robot node

def test_node_telemetry_payload_schema():
    from robot_linux.robot_node import RobotNode
    sm, b, c = _machine()
    node = RobotNode.__new__(RobotNode)  # skip socket setup
    node.bridge = b
    node.bridge_up = True
    node.sm = sm
    import threading
    node._lock = threading.RLock()
    b.heartbeat()
    t = node._telemetry()
    assert set(t) == {"ts", "battery_v", "state", "arm", "drive"}
    assert len(t["arm"]) == config.NUM_JOINTS
    assert all(isinstance(j, int) for j in t["arm"])
    assert set(t["drive"]) == {"l", "r"}
    assert 10.0 <= t["battery_v"] <= 13.0

    node.bridge_up = False           # bridge DOWN pins ESTOP
    assert node._telemetry()["state"] == "ESTOP"


def test_soak_short_run_all_success():
    from robot_linux.soak import run_soak
    s = run_soak(cycles=4, speed=40.0, tick_hz=4000.0, seed=1, verbose=False)
    assert s["completed"] == 4
    assert s["success_rate"] == 1.0
    assert s["stalls"] == 0
    assert s["tick_errors"] == 0


# demo command mode (await-command vs autonomous)

def _node(seed=1, mode="await"):
    from robot_linux.robot_node import RobotNode
    b = MockBridge()
    c = MockCamera(b, seed=seed)
    d = MockDetector(c)
    node = RobotNode(b, c, d, PoseStore(), "http://localhost:0", command_mode=mode)
    return node, b, c


def test_await_mode_idles_until_command_then_one_shot():
    from robot_linux.robot_node import AWAIT
    node, b, c = _node(mode=AWAIT)
    node._apply_mode(AWAIT)
    assert node.sm.state == IDLE and node.sm.continuous is False
    # with no command the robot must NOT move on its own
    for _ in range(80):
        node.sm.tick()
        b.heartbeat()
    assert node.sm.state == IDLE

    # a command presents the requested fruit and runs exactly one pick
    picks = []
    node.sm.on_emit = lambda k, v: picks.append(v) if k == "pick_event" else None
    node.sm.speed = INSTANT
    node._present_mock_fruit(fruit="apple")
    node.sm.continuous = False
    node.sm.start({"fruit": "apple"})
    assert node.sm.state == SEEK
    for _ in range(3000):
        node.sm.tick()
        b.heartbeat()
        if node.sm.state == IDLE and picks:
            break
    assert len(picks) == 1
    assert picks[0]["fruit"] == "apple"
    assert node.sm.state == IDLE          # await one-shot returns to idle


def test_auto_mode_runs_continuously():
    from robot_linux.robot_node import AUTO
    node, b, c = _node(mode=AUTO)
    node._apply_mode(AUTO)
    assert node.sm.state == SEEK and node.sm.continuous is True


def test_set_mode_autostart_contract():
    # server-core's contract: set_mode {autostart: bool}
    from robot_linux.robot_node import AUTO, AWAIT, _norm_mode
    node, b, c = _node(mode=AWAIT)
    node._apply_mode(AUTO if True else AWAIT)     # autostart:true
    assert node.command_mode == AUTO
    node._apply_mode(AUTO if False else AWAIT)    # autostart:false
    assert node.command_mode == AWAIT
    assert _norm_mode("garbage") == AUTO          # unknown -> autonomous


def test_present_mock_fruit_places_requested():
    node, b, c = _node()
    node._present_mock_fruit(fruit="banana", ripeness="ripe")
    assert c.fruit_class() == ("banana", "ripe")
    before = c.fruit
    node._present_mock_fruit(fruit="nearest")     # unfiltered: keep current
    assert c.fruit is before


def test_await_mode_does_not_unlatch_estop():
    from robot_linux.robot_node import AWAIT
    node, b, c = _node(mode=AWAIT)
    node.sm.estop()
    assert node.sm.state == ESTOP
    node._apply_mode(AWAIT)                        # must not stop() out of estop
    assert node.sm.state == ESTOP and b.estopped


# zones (per-section: base-yaw sector + shoulder-height band)

def test_zone_region_resolution():
    from robot_linux.state_machine import zone_region
    assert zone_region("left") == {"yaw": [95, 150]}
    assert zone_region("right") == {"yaw": [30, 85]}
    assert zone_region("high") == {"pitch": [105, 155]}
    assert zone_region("any") == {}
    assert zone_region("garbage") == {}
    assert zone_region(region={"yaw": [100, 140], "pitch": [100, 130]}) == \
        {"yaw": [100, 140], "pitch": [100, 130]}


def test_seek_restricted_to_zone_yaw():
    from robot_linux.state_machine import SEEK_SWEEP
    sm, _, _ = _machine()
    sm.start("nearest", zone="left")
    assert all(95 <= w <= 150 for w in sm._seek_waypoints())
    sm.start("nearest")                       # no zone -> full sweep
    assert sm._seek_waypoints() == SEEK_SWEEP


def _drive_zoned_pick(node, b, c, zone, present):
    node.sm.speed = INSTANT
    picks = []
    node.sm.on_emit = lambda k, v: picks.append(v) if k == "pick_event" else None
    if present == "in-zone":
        node._present_mock_fruit(zone=zone)
    else:                                     # place fruit in the opposite sector
        home = list(node.sm.poses.get("home"))
        home[0] = 57                          # right sector
        c.spawn_fruit(near_joints=home)
    node.sm.continuous = False
    node.sm.start("nearest", zone=zone)
    for _ in range(4000):
        node.sm.tick()
        b.heartbeat()
        if node.sm.state == IDLE and picks:
            break
    return picks


def test_zoned_command_picks_in_zone():
    node, b, c = _node()
    assert len(_drive_zoned_pick(node, b, c, "left", "in-zone")) == 1


def test_zoned_command_ignores_out_of_zone_fruit():
    node, b, c = _node()
    # command LEFT, fruit is in the RIGHT sector -> never reached
    picks = _drive_zoned_pick(node, b, c, "left", "out-of-zone")
    assert len(picks) == 0


def test_present_mock_fruit_in_zone():
    node, b, c = _node()
    node._present_mock_fruit(zone="left")
    assert 80 <= c.fruit[3] <= 165           # base yaw inside left sector +- spread


def test_nl_drive_pulses_then_stops():
    node, b, c = _node()
    node._nl_drive("forward")
    assert b.get_drive()["l"] > 0 and b.get_drive()["r"] > 0
    node._drive_stop()
    assert b.get_drive() == {"l": 0.0, "r": 0.0}
    node._nl_drive("home")                    # home/unknown -> no movement
    assert b.get_drive() == {"l": 0.0, "r": 0.0}


def test_mock_bridge_clamps_and_estops():
    b = MockBridge()
    b.move_servos([999, -5, 90, 90, 90], 0)
    j = b.get_joints()
    assert j[0] == 180 and j[1] == 0
    b.set_drive(5.0, -5.0)
    assert b.get_drive() == {"l": 1.0, "r": -1.0}
    b.estop()
    b.set_drive(1.0, 1.0)            # ignored while estopped
    assert b.get_drive() == {"l": 0.0, "r": 0.0}
