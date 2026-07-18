#!/usr/bin/env python3
"""Uno Q MCU-bridge smoke test (App Lab Bridge RPC) - Rung 2.

Exercises every RPC the robot uses (set_drive / move_servos / heartbeat / estop /
clear_estop) and prints get_status after each, so you can confirm the MCU is
alive and each command lands BEFORE running the full robot_node.

Why this exists: on the Uno Q there is NO separate USB serial for the MCU, so the
serial bench (firmware/tools/bench.py) can't attach. Everything goes over the App
Lab Bridge (Linux <-> STM32). This is that bench's Bridge-transport equivalent,
and it reuses the SAME AppLabBridge the robot uses, so a pass here means the real
command path works.

RUN ON THE UNO Q (inside an App Lab app context, so `arduino.app_bridge` imports):
    cd firmware/linux && python3 tools/bridge_smoke.py

get_status decodes to: [state, battery_mv, j0..j4, l_pct, r_pct, ultra_cm]
  state: 0=IDLE/OK  2=WATCHDOG(no heartbeat)  3=ESTOP   ultra_cm 999 = no echo
"""
import os
import sys
import time

# make `robot_linux` importable when run as `python3 tools/bridge_smoke.py`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from robot_linux.bridge import AppLabBridge  # noqa: E402


def show(bridge, label):
    st = bridge.get_status()
    print(f"  [{label}] status={list(st)}  drive={bridge.get_drive()}  "
          f"state={bridge.mcu_state()}")
    return st


def main():
    print("== Uno Q Bridge smoke ==")
    try:
        bridge = AppLabBridge()
    except RuntimeError as e:
        print(f"FAIL: {e}\nRun this ON THE BOARD inside an App Lab app "
              "(arduino.app_bridge must be importable).")
        return 1

    ok = True
    print("[1] heartbeat + get_status (expect state 0, not 2/WATCHDOG)")
    bridge.heartbeat()
    show(bridge, "after heartbeat")

    print("[2] set_drive(0.2, 0.2) - wheels should be commanded ~+20%")
    bridge.set_drive(0.2, 0.2)
    bridge.heartbeat()
    time.sleep(0.2)
    st = show(bridge, "driving")
    # l_pct,r_pct are status[7],status[8]; expect ~20 (allow slack for slew/trim)
    if not (5 <= abs(st[7]) <= 40 and 5 <= abs(st[8]) <= 40):
        print("  WARN: l_pct/r_pct didn't reflect the drive command"); ok = False

    print("[3] set_drive(0, 0) - stop")
    bridge.set_drive(0.0, 0.0)
    bridge.heartbeat()
    time.sleep(0.2)
    show(bridge, "stopped")

    print("[4] move_servos to 90deg all, 1000ms (watch the arm move)")
    bridge.move_servos([90, 90, 90, 90, 90], 1000)
    for _ in range(6):
        bridge.heartbeat(); time.sleep(0.2)
    show(bridge, "after servo move")

    print("[5] estop - motors must latch off, state -> 3")
    bridge.estop()
    time.sleep(0.2)
    st = show(bridge, "estopped")
    if bridge.mcu_state() != 3:
        print("  WARN: MCU did not report ESTOP (state 3)"); ok = False

    print("[6] clear_estop - back to normal")
    bridge.clear_estop()
    bridge.heartbeat()
    time.sleep(0.2)
    show(bridge, "cleared")

    print("\nRESULT:", "PASS - every RPC responded" if ok
          else "CHECK WARNINGS above (RPCs responded but a value looked off)")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
