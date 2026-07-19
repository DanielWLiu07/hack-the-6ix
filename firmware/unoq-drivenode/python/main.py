"""Uno Q teleop drive node (App Lab).

Runs in the App Lab Python container (so `arduino.app_utils.Bridge` can reach the
MCU). Connects to the laptop hub as role=robot and forwards `drive {l,r}` to the
MCU's set_drive RPC, heartbeats the watchdog, and echoes telemetry so the website
shows it connected. Arm (move_servos) comes later; this is drive-first.
"""
import os
import threading
import time

import socketio
from arduino.app_utils import App, Bridge

HUB = os.environ.get("SERVER_URL", "http://10.186.57.15:3001")

# --- direction (tune here, no reflash) -------------------------------------
# Wire it, test forward, then flip: one wheel backward -> that side's INV;
# whole robot steers mirrored -> SWAP_LR. Start neutral.
SWAP_LR = 0
INV_L = 0
INV_R = 0

sio = socketio.Client(reconnection=True, reconnection_delay=1)
last = {"l": 0.0, "r": 0.0}


def apply_dir(l, r):
    if SWAP_LR:
        l, r = r, l
    if INV_L:
        l = -l
    if INV_R:
        r = -r
    return l, r


@sio.on("drive")
def on_drive(d):
    try:
        l = max(-1.0, min(1.0, float(d.get("l", 0))))
        r = max(-1.0, min(1.0, float(d.get("r", 0))))
    except (TypeError, ValueError):
        return
    l, r = apply_dir(l, r)
    last["l"], last["r"] = l, r
    try:
        Bridge.call("set_drive", l, r)
    except Exception as e:
        print("set_drive err:", e)


@sio.on("estop")
def on_estop(_=None):
    try:
        Bridge.call("estop")
    except Exception as e:
        print("estop err:", e)


@sio.event
def connect():
    print("connected to hub as robot")


def _connect_loop():
    while True:
        try:
            sio.connect(HUB, auth={"role": "robot"})
            return
        except Exception as e:
            print("hub connect retry:", e)
            time.sleep(2)


threading.Thread(target=_connect_loop, daemon=True).start()


def loop():
    """Called repeatedly by App.run: heartbeat the MCU + emit telemetry."""
    try:
        Bridge.call("heartbeat")
    except Exception as e:
        print("hb err:", e)
    if sio.connected:
        try:
            sio.emit("telemetry", {
                "ts": int(time.time() * 1000), "state": "SEEK",
                "battery_v": 0.0, "arm": [90] * 5, "drive": dict(last),
            })
        except Exception:
            pass
    time.sleep(0.1)


App.run(user_loop=loop)
