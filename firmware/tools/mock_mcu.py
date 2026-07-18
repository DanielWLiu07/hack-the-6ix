#!/usr/bin/env python3
"""fw-tools: mock MCU — reference implementation of BRIDGE.md §5 over a pty.

Serves the serial bench protocol exactly as the real sketch must, including
the safety state machine, 20 ms servo interpolation and the 500 ms watchdog.
Uses:
  * verify bench.py with no hardware:      python3 mock_mcu.py   (prints port)
  * fw-linux integration target pre-board: point your serial layer at the pty
  * fw-mcu: executable spec — if bench.py passes against this and fails
    against your sketch, the sketch is wrong (or this file and BRIDGE.md are,
    in which case post status).

    python3 mock_mcu.py                # run forever, prints pty path
    python3 mock_mcu.py --selftest     # spawn itself + run bench.py against it
"""

import argparse
import os
import pty
import select
import subprocess
import sys
import time
import tty

STEP_S = 0.02          # 20 ms interpolation tick
WATCHDOG_S = 0.5
OBSTACLE_NEAR_CM = 15  # enter OBSTACLE below this
OBSTACLE_FAR_CM = 25   # leave OBSTACLE above this (hysteresis)

OK, OBSTACLE, WATCHDOG, ESTOP = 0, 1, 2, 3


class MockMcu:
    def __init__(self, ultra_cm=999):
        self.joints = [90.0] * 5
        self.target = [90.0] * 5
        self.step_per_tick = [0.0] * 5
        self.drive = [0.0, 0.0]
        self.ultra_cm = ultra_cm
        self.estopped = False
        self.obstacle = ultra_cm < OBSTACLE_NEAR_CM
        self.last_heartbeat = time.monotonic()
        self.watchdog_armed = False   # bench boots disarmed (§5)

    # ---- state machine (§2) ----
    def state(self):
        if self.estopped:
            return ESTOP
        if self.watchdog_armed and time.monotonic() - self.last_heartbeat > WATCHDOG_S:
            return WATCHDOG
        if self.obstacle:
            return OBSTACLE
        return OK

    def tick(self):
        # obstacle hysteresis
        if self.ultra_cm < OBSTACLE_NEAR_CM:
            self.obstacle = True
        elif self.ultra_cm > OBSTACLE_FAR_CM:
            self.obstacle = False
        s = self.state()
        if s in (WATCHDOG, ESTOP):
            self.drive = [0.0, 0.0]
            self.target = list(self.joints)          # freeze/hold pose
            self.step_per_tick = [0.0] * 5
            return
        # servo interpolation
        for i in range(5):
            d = self.target[i] - self.joints[i]
            if abs(d) <= abs(self.step_per_tick[i]) or self.step_per_tick[i] == 0:
                self.joints[i] = self.target[i]
            else:
                self.joints[i] += self.step_per_tick[i]

    # ---- RPC handlers (§3) ----
    def set_drive(self, l, r):
        s = self.state()
        if s in (WATCHDOG, ESTOP):
            return s
        l = max(-1.0, min(1.0, l))
        r = max(-1.0, min(1.0, r))
        if s == OBSTACLE:                # zero forward components only
            l, r = min(l, 0.0), min(r, 0.0)
        self.drive = [l, r]
        return s

    def move_servos(self, j, ms):
        s = self.state()
        if s in (WATCHDOG, ESTOP):
            return s
        ms = max(100, min(5000, ms))
        ticks = max(1, ms // int(STEP_S * 1000))
        self.target = [float(max(0, min(180, x))) for x in j]
        self.step_per_tick = [(self.target[i] - self.joints[i]) / ticks for i in range(5)]
        return s

    def handle(self, line):
        p = line.split()
        if not p:
            return None
        c = p[0].upper()
        try:
            if c == "H":
                self.last_heartbeat = time.monotonic()
                return f"OK {self.state()}"
            if c == "E":
                self.estopped = True
                return "OK 3"
            if c == "C":
                self.estopped = False
                return f"OK {self.state()}"
            if c == "Z":
                return f"OK {self.move_servos([90] * 5, 1500)}"
            if c == "D":
                if len(p) != 3:
                    return "ERR 1 want: D <l> <r>"
                return f"OK {self.set_drive(float(p[1]), float(p[2]))}"
            if c == "S":
                if len(p) != 7:
                    return "ERR 1 want: S <j0..j4> <ms>"
                return f"OK {self.move_servos([int(x) for x in p[1:6]], int(p[6]))}"
            if c == "Q":
                j = " ".join(str(round(x)) for x in self.joints)
                d = f"{round(self.drive[0] * 100)} {round(self.drive[1] * 100)}"
                return f"ST {self.state()} 0 {j} {d} {self.ultra_cm}"
            if c == "W":
                if len(p) != 2 or p[1] not in ("0", "1"):
                    return "ERR 1 want: W <0|1>"
                self.watchdog_armed = p[1] == "1"
                self.last_heartbeat = time.monotonic()
                return f"OK {self.state()}"
            if c == "?":
                return "# cmds: D S H E C Q Z W"
            return "ERR 3 unknown cmd"
        except ValueError:
            return "ERR 2 bad arg"


def serve():
    master, slave = pty.openpty()
    tty.setraw(slave)   # kill echo/canonical mode, else the line discipline
    # reflects our own banner back at us as a bogus command
    print(f"mock MCU on: {os.ttyname(slave)}", flush=True)
    os.write(master, b"# uno-q-mcu bench mock-0.1\n")
    mcu = MockMcu()
    buf = b""
    last = time.monotonic()
    while True:
        timeout = max(0.0, STEP_S - (time.monotonic() - last))
        r, _, _ = select.select([master], [], [], timeout)
        if time.monotonic() - last >= STEP_S:
            mcu.tick()
            last = time.monotonic()
        if r:
            try:
                buf += os.read(master, 256)
            except OSError:
                return
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                resp = mcu.handle(line.decode(errors="replace").strip())
                if resp:
                    os.write(master, (resp + "\n").encode())


def selftest():
    here = os.path.dirname(os.path.abspath(__file__))
    proc = subprocess.Popen([sys.executable, __file__], stdout=subprocess.PIPE, text=True)
    try:
        port = proc.stdout.readline().strip().split(": ")[1]
        print(f"[selftest] mock on {port}, running bench.py smoke...")
        rc = subprocess.call([sys.executable, os.path.join(here, "bench.py"), "--port", port])
        print(f"[selftest] {'PASS' if rc == 0 else 'FAIL'}")
        return rc
    finally:
        proc.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    sys.exit(selftest() if args.selftest else serve())
