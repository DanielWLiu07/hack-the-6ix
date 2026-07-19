"""Offline tests for the outer drive-to-fruit autonomy layer.

Covers NavController (lidar roam + forward-safety gate) in isolation, and the
integrated NAV -> APPROACH -> ALIGN -> PICK -> SORT -> DROP -> NAV loop against
the sim MockCamera range model + a MockLidarFeed. No sockets, no hardware.
Run: pytest -q
"""

import pytest

from robot_linux import config
from robot_linux.bridge import MockBridge
from robot_linux.camera import MockCamera
from robot_linux.detector import Detection, MockDetector
from robot_linux.lidar_mock import MockLidarFeed
from robot_linux.nav import NavController
from robot_linux.poses import PoseStore
from robot_linux.state_machine import (PickStateMachine, NAV, SEEK, APPROACH,
                                       IDLE, ESTOP)

INSTANT = 10000.0


# --- NavController.forward_gate --------------------------------------------

def test_gate_open_field_allows_full_forward():
    allow, scale, reason = NavController().forward_gate(MockLidarFeed())
    assert allow and scale == 1.0 and reason == "clear"


def test_gate_obstacle_blocks_forward():
    allow, scale, _ = NavController().forward_gate(MockLidarFeed(forward_clearance=0.2))
    assert not allow and scale == 0.0


def test_gate_slowing_zone_tapers():
    allow, scale, reason = NavController().forward_gate(MockLidarFeed(forward_clearance=0.5))
    assert allow and 0.0 < scale < 1.0 and reason == "slowing"


def test_gate_stale_fails_safe():
    lidar = MockLidarFeed()
    lidar.set_stale(True)
    allow, scale, _ = NavController().forward_gate(lidar)
    assert not allow and scale == 0.0


def test_gate_none_feed_fails_safe():
    allow, scale, _ = NavController().forward_gate(None)
    assert not allow and scale == 0.0


# --- NavController.roam -----------------------------------------------------

def test_roam_drives_forward_when_clear():
    cmd = NavController().roam(MockLidarFeed())
    assert cmd.mode == "ROAM"
    assert cmd.l == pytest.approx(cmd.r) and cmd.l > 0


def test_roam_turns_toward_open_sector_when_blocked():
    lidar = MockLidarFeed(forward_clearance=0.2)
    lidar.set_sectors([{"c": 0.0, "min": 0.2}, {"c": 90.0, "min": None},
                       {"c": 270.0, "min": 0.5}])
    cmd = NavController().roam(lidar)
    assert cmd.mode == "BLOCKED"
    assert cmd.r > cmd.l                       # open space left (+90) -> turn left


def test_roam_stale_rotates_in_place():
    lidar = MockLidarFeed()
    lidar.set_stale(True)
    cmd = NavController().roam(lidar)
    assert cmd.mode == "STALE"
    assert cmd.l == -cmd.r and cmd.r > 0        # pure rotation


# --- integrated state machine ----------------------------------------------

def _build(seed=3, forward_clearance=None):
    bridge = MockBridge()
    cam = MockCamera(bridge, seed=seed)
    det = MockDetector(cam)
    events = []
    sm = PickStateMachine(bridge, cam, det, PoseStore(),
                          on_emit=lambda k, p: events.append((k, p)),
                          speed=INSTANT, lidar=MockLidarFeed(forward_clearance))
    return sm, bridge, cam, events


def test_navigate_defaults_true_with_lidar():
    sm, *_ = _build()
    sm.start("nearest")
    assert sm.navigate is True and sm.state == NAV


def test_stationary_mode_unchanged_without_navigate():
    sm, *_ = _build()
    sm.start("nearest", navigate=False)
    assert sm.navigate is False and sm.state == SEEK


def test_full_drive_pick_loop_soak():
    sm, bridge, _, events = _build(seed=5)
    sm.continuous = True
    sm.start("nearest")
    for _ in range(20000):
        sm.tick()
        if sm.stats["picks"] >= 5:
            break
    assert sm.stats["picks"] >= 5
    assert sm.stats["failures"] == 0
    picks = [p for k, p in events if k == "pick_event"]
    assert len(picks) >= 5
    for p in picks:
        assert p["success"] is True
        assert p["bin"] in config.BINS
    # wheels halted whenever we're not in a driving state
    assert bridge.get_drive() == {"l": 0.0, "r": 0.0}


def test_approach_reflex_halts_forward_on_obstacle():
    # In APPROACH with a real obstacle in the forward cone, the vision steer may
    # still rotate to hold the fruit centered, but forward translation is vetoed.
    sm, bridge, cam, _ = _build(seed=1)
    sm.navigate = True
    sm.lidar.set_forward_clearance(0.2)        # inside NAV_STOP_DIST_M
    sm.state = APPROACH
    sm._ticks_in_state = 0
    sm._tick_approach()
    d = bridge.get_drive()
    fwd = (d["l"] + d["r"]) / 2.0
    assert fwd == pytest.approx(0.0, abs=1e-9)  # no forward creep into the obstacle


def test_estop_during_nav_halts_wheels():
    sm, bridge, *_ = _build()
    sm.start("nearest")
    for _ in range(3):
        sm.tick()
    sm.estop()
    assert sm.state == ESTOP
    assert bridge.get_drive() == {"l": 0.0, "r": 0.0}


def test_stop_halts_wheels():
    sm, bridge, *_ = _build()
    sm.start("nearest")
    for _ in range(3):
        sm.tick()
    sm.stop()
    assert sm.state == IDLE
    assert bridge.get_drive() == {"l": 0.0, "r": 0.0}


def test_drop_returns_to_nav_when_navigating():
    sm, _, _, events = _build(seed=2)
    sm.continuous = True
    sm.start("nearest")
    # run until the first pick completes, then confirm we're roaming again
    for _ in range(8000):
        sm.tick()
        if sm.stats["picks"] >= 1 and sm.state == NAV:
            break
    assert sm.stats["picks"] >= 1
    assert sm.state == NAV
