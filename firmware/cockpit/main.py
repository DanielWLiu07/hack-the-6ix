"""Cockpit - combined DRIVE + ARM teleop node (App Lab web_ui brick + MCU Bridge).

Forked from teleop/main.py. Everything runs ON the Uno Q:

    browser (gamepad + sliders/poses) -> web_ui page :7000
        --socket.io "drive"/"estop"/"clear"/"servo"/"pose"/"park"-->  handlers
        one control loop --Bridge.call(...)--> MCU (drive + arm)

All Bridge calls stay in the single control loop thread (the Bridge is happiest
driven from one thread): socket handlers only stash intent; loop() drains it.
"""
import threading
import time

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI

# --- drive direction knobs (no reflash: edit + `app restart`) ----------------
SWAP_LR = 0
INV_L = 0
INV_R = 0

# --- tuning ------------------------------------------------------------------
CMD_TIMEOUT_S = 0.4     # no fresh drive command in this long -> stop (deadman)
LOOP_HZ = 30            # control + heartbeat rate (> 1/0.5 s watchdog)
STATUS_EVERY = 6        # push status + arm angles to the page every Nth tick

ui = WebUI()            # serves /app/assets on :7000, socket.io on /socket.io

# --- drive state ---
_lock = threading.Lock()
_cmd = {"l": 0.0, "r": 0.0, "ts": 0.0}
_estop = False

# --- arm state (coalesced servo targets + a queue of actions) ---
_arm_lock = threading.Lock()
_servo_targets = {}     # ch -> deg (latest wins)
_arm_actions = []       # list of ("pose",id) | ("park",) | ("record",slot) | ("play",slot)
_recorded = {"square": None, "circle": None}   # loop-thread owned; slot -> [angles]
_auton = False          # stub - Cross toggles it, no behavior yet


def _clamp(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(-1.0, min(1.0, v))


def _apply_dir(l, r):
    if SWAP_LR:
        l, r = r, l
    if INV_L:
        l = -l
    if INV_R:
        r = -r
    return l, r


# --- drive socket handlers ---------------------------------------------------
def on_drive(sid, data):
    if not isinstance(data, dict):
        return
    l, r = _apply_dir(_clamp(data.get("l", 0)), _clamp(data.get("r", 0)))
    with _lock:
        _cmd["l"], _cmd["r"], _cmd["ts"] = l, r, time.time()


def on_estop(sid, data=None):
    global _estop
    _estop = True
    with _lock:
        _cmd["l"] = _cmd["r"] = 0.0
    try:
        Bridge.call("estop")
    except Exception as e:
        print("estop err:", e)


def on_clear(sid, data=None):
    global _estop
    _estop = False
    try:
        Bridge.call("clear_estop")
    except Exception as e:
        print("clear err:", e)
    with _lock:
        _cmd["l"] = _cmd["r"] = 0.0
        _cmd["ts"] = time.time()


# --- arm socket handlers (stash intent; loop() drains it) --------------------
def on_servo(sid, data):
    if not isinstance(data, dict):
        return
    try:
        ch, deg = int(data["ch"]), int(data["deg"])
    except (KeyError, TypeError, ValueError):
        return
    with _arm_lock:
        _servo_targets[ch] = deg


def on_pose(sid, data):
    if not isinstance(data, dict):
        return
    try:
        pid = int(data["id"])
    except (KeyError, TypeError, ValueError):
        return
    with _arm_lock:
        _arm_actions.append(("pose", pid))


def on_park(sid, data=None):
    with _arm_lock:
        _arm_actions.append(("park",))


def _slot(data):
    s = data.get("slot") if isinstance(data, dict) else None
    return s if s in ("square", "circle") else None


def on_record(sid, data):
    s = _slot(data)
    if s:
        with _arm_lock:
            _arm_actions.append(("record", s))


def on_play(sid, data):
    s = _slot(data)
    if s:
        with _arm_lock:
            _arm_actions.append(("play", s))


def on_seq_circle(sid, data=None):
    with _arm_lock:
        _arm_actions.append(("seq_circle",))


def on_auton(sid, data):
    global _auton
    _auton = bool(data.get("on")) if isinstance(data, dict) else (not _auton)
    print("auton mode:", _auton, "(stub - not implemented)")


ui.on_message("drive", on_drive)
ui.on_message("estop", on_estop)
ui.on_message("clear", on_clear)
ui.on_message("servo", on_servo)
ui.on_message("pose", on_pose)
ui.on_message("park", on_park)
ui.on_message("record", on_record)
ui.on_message("play", on_play)
ui.on_message("seq_circle", on_seq_circle)
ui.on_message("auton", on_auton)

# --- circle sequence: Home -> (slow) Target -> open gripper -----------------
GRIP_OPEN = 150            # gripper "open" angle (bench-measured)
_seq_steps = []            # loop-owned schedule of (fire_time, kind, arg)
ui.on_connect(lambda sid: print("page connected:", sid))
ui.on_disconnect(lambda sid: print("page disconnected:", sid))

_tick = 0


def loop():
    """Fixed-rate: heartbeat, push drive (deadman-gated), drain arm, report."""
    global _tick, _seq_steps
    now = time.time()
    with _lock:
        l, r, ts = _cmd["l"], _cmd["r"], _cmd["ts"]

    stale = (now - ts) > CMD_TIMEOUT_S
    if stale or _estop:
        l = r = 0.0

    # snapshot queued arm intent
    with _arm_lock:
        targets = dict(_servo_targets)
        _servo_targets.clear()
        actions = list(_arm_actions)
        _arm_actions.clear()

    try:
        Bridge.call("heartbeat")
        Bridge.call("set_drive", int(l * 1000), int(r * 1000))
        for ch, deg in targets.items():
            Bridge.call("set_servo", ch, deg)
        for act in actions:
            if act[0] == "pose":
                Bridge.call("goto_pose", act[1])
            elif act[0] == "park":
                Bridge.call("park")
            elif act[0] == "record":
                angles = [int(x) for x in Bridge.call("get_servos")]
                _recorded[act[1]] = angles
                ui.send_message("recorded", {"slot": act[1], "angles": angles})
            elif act[0] == "play":
                angles = _recorded.get(act[1])
                if angles:
                    for ch, deg in enumerate(angles):
                        Bridge.call("set_servo", ch, int(deg))
            elif act[0] == "seq_circle":
                # Home arm (leave gripper as-is), rotate base to 0 (slow), then open gripper.
                _seq_steps.extend([
                    (now + 0.0, "servo", (0, 120)),        # 1) home: base
                    (now + 0.0, "servo", (1, 45)),         # 1) home: shoulder
                    (now + 0.0, "servo", (2, 150)),        # 1) home: elbow  (gripper untouched)
                    (now + 3.0, "servo", (0, 0)),          # 2) rotate base to 0 (base is slow)
                    (now + 6.0, "servo", (1, 90)),         # 3) shoulder -> drop value
                    (now + 6.0, "servo", (2, 135)),        # 3) elbow -> drop value
                    (now + 8.0, "servo", (3, GRIP_OPEN)),  # 4) open gripper
                ])
    except Exception as e:
        print("bridge err:", e)

    # fire any due circle-sequence steps (non-blocking)
    if _seq_steps:
        due = [s for s in _seq_steps if s[0] <= now]
        _seq_steps = [s for s in _seq_steps if s[0] > now]
        for (_, kind, arg) in due:
            try:
                if kind == "servo":
                    Bridge.call("set_servo", arg[0], arg[1])
                elif kind == "pose":
                    Bridge.call("goto_pose", arg)
            except Exception as e:
                print("seq err:", e)

    _tick += 1
    if _tick % STATUS_EVERY == 0:
        state = "ESTOP" if _estop else ("IDLE" if (l == 0 and r == 0) else "DRIVE")
        try:
            ui.send_message("status", {"state": state, "l": round(l, 2), "r": round(r, 2)})
        except Exception:
            pass
        try:
            angles = [int(x) for x in Bridge.call("get_servos")]
            ui.send_message("arm", {"angles": angles})
        except Exception:
            pass

    time.sleep(1.0 / LOOP_HZ)


App.run(user_loop=loop)
