"""Uno Q teleop drive node - self-contained (App Lab web_ui brick + MCU Bridge).

The whole teleop stack runs ON the Uno Q, no laptop hub:

    browser (Gamepad API)  ->  this app's web_ui page on :7000
        --socket.io "drive" {l,r}-->  on_drive()  (stores latest command)
        the control loop (single thread) --Bridge.call("set_drive")--> MCU

Why a single control loop instead of calling the MCU straight from the socket
handler: the App Lab Bridge is happiest driven from one thread, and a fixed-rate
loop lets us (a) heartbeat the MCU watchdog and (b) apply a server-side deadman
timeout - if the browser or controller stops sending, we zero drive well before
the MCU's own 500 ms watchdog trips.
"""
import threading
import time

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI

# --- direction knobs (no reflash: edit + `arduino-app-cli app restart`) ------
# Wire it, test forward, then flip: one wheel backward -> that side's INV;
# whole robot steers mirrored -> SWAP_LR. Start neutral.
SWAP_LR = 0
INV_L = 0
INV_R = 0

# --- tuning ------------------------------------------------------------------
CMD_TIMEOUT_S = 1.0     # stop if no fresh drive command for this long (deadman).
#                         Generous so socket.io dispatch jitter doesn't flap the
#                         command to 0 mid-drive (which caused stutter). The held
#                         R2 / on-screen release are the primary quick stops.
LOOP_HZ = 30            # control rate (must stay > 1/0.5s MCU watchdog)
STATUS_EVERY = 15       # push status to the page every Nth tick (~2 Hz) - lighter
#                         on the event loop so incoming drive events aren't delayed

ui = WebUI()            # serves /app/assets on :7000, socket.io on /socket.io

_lock = threading.Lock()
_cmd = {"l": 0.0, "r": 0.0, "ts": 0.0}
_estop = False


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


# --- socket.io handlers from the page (sid, data) ----------------------------
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
    # Leave a FRESH ZERO, not the pre-estop command: clearing must never make the
    # rover lurch back to whatever the stick was at when it was e-stopped. It stays
    # stopped until the page sends a new drive frame.
    with _lock:
        _cmd["l"] = _cmd["r"] = 0.0
        _cmd["ts"] = time.time()


ui.on_message("drive", on_drive)
ui.on_message("estop", on_estop)
ui.on_message("clear", on_clear)
ui.on_connect(lambda sid: print("page connected:", sid))
ui.on_disconnect(lambda sid: print("page disconnected:", sid))

_tick = 0


def loop():
    """Fixed-rate: heartbeat MCU, push latest (deadman-gated) command, report."""
    global _tick
    now = time.time()
    with _lock:
        l, r, ts = _cmd["l"], _cmd["r"], _cmd["ts"]

    stale = (now - ts) > CMD_TIMEOUT_S
    if stale or _estop:
        l = r = 0.0

    try:
        # set_drive also feeds the MCU watchdog, so one RPC per tick is enough.
        Bridge.call("set_drive", int(l * 1000), int(r * 1000))
    except Exception as e:
        print("bridge err:", e)

    _tick += 1
    if _tick % STATUS_EVERY == 0:
        state = "ESTOP" if _estop else ("IDLE" if (l == 0 and r == 0) else "DRIVE")
        try:
            ui.send_message("status", {"state": state, "l": round(l, 2), "r": round(r, 2)})
        except Exception:
            pass

    time.sleep(1.0 / LOOP_HZ)


App.run(user_loop=loop)
