#!/usr/bin/env python3
"""fw-tools: serial bench-test client for the MCU (BRIDGE.md §5 protocol).

Drives fw-mcu's bench mode over USB serial. Two modes:

    python3 bench.py              # scripted smoke test of every RPC
    python3 bench.py -i           # interactive REPL (raw protocol + helpers)
    python3 bench.py --port /dev/cu.usbmodem1101 --smoke drive

Requires: pyserial  (pip install pyserial)
"""

import argparse
import glob
import sys
import time

try:
    import serial  # pyserial
except ImportError:
    sys.exit("pyserial missing — run: pip3 install pyserial")

BAUD = 115200
STATES = {0: "OK", 1: "OBSTACLE", 2: "WATCHDOG", 3: "ESTOP"}


def find_port() -> str:
    for pat in ("/dev/cu.usbmodem*", "/dev/cu.usbserial*", "/dev/ttyACM*", "/dev/ttyUSB*"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    sys.exit("no serial device found — plug the board in or pass --port")


class Mcu:
    """Thin line-oriented client. One command -> one response (BRIDGE.md §5)."""

    def __init__(self, port: str, timeout: float = 0.5, verbose: bool = True):
        self.verbose = verbose
        self.ser = serial.Serial(port, BAUD, timeout=timeout)
        time.sleep(1.5)          # some boards reset on open
        self.ser.reset_input_buffer()

    def cmd(self, line: str) -> str:
        self.ser.write((line.strip() + "\n").encode())
        while True:
            resp = self.ser.readline().decode(errors="replace").strip()
            if resp.startswith("#"):       # debug lines: ignored per protocol
                if self.verbose:
                    print(f"   {resp}")
                continue
            if self.verbose:
                print(f"→ {line:<28} ← {resp or '<timeout>'}")
            return resp

    # helpers mirroring the RPC surface
    def heartbeat(self):        return self.cmd("H")
    def estop(self):            return self.cmd("E")
    def clear_estop(self):      return self.cmd("C")
    def zero_all(self):         return self.cmd("Z")
    def drive(self, l, r):      return self.cmd(f"D {l} {r}")
    def servos(self, j, ms):    return self.cmd("S " + " ".join(str(x) for x in j) + f" {ms}")

    def status(self) -> dict | None:
        resp = self.cmd("Q")
        parts = resp.split()
        if len(parts) != 11 or parts[0] != "ST":
            return None
        v = [int(x) for x in parts[1:]]
        return {
            "state": STATES.get(v[0], f"?{v[0]}"), "battery_mv": v[1],
            "joints": v[2:7], "drive_pct": (v[7], v[8]), "ultra_cm": v[9],
        }


# ---------------------------------------------------------------- smoke test
def expect(name: str, cond: bool, results: list):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    results.append((name, cond))


def smoke(mcu: Mcu, only: str | None):
    r: list = []
    print("\n== smoke: basics ==")
    expect("heartbeat returns OK <state>", mcu.heartbeat().startswith("OK"), r)
    st = mcu.status()
    expect("get_status parses (11 fields)", st is not None, r)

    if only in (None, "drive"):
        print("\n== smoke: drive ==")
        expect("set_drive 0.5 -0.5", mcu.drive(0.5, -0.5).startswith("OK"), r)
        expect("out-of-range clamps, no error", mcu.drive(9, -9).startswith("OK"), r)
        expect("bad arg count -> ERR 1", mcu.cmd("D 0.5").startswith("ERR 1"), r)
        mcu.drive(0, 0)

    if only in (None, "servos"):
        print("\n== smoke: servos ==")
        expect("move_servos 5 joints", mcu.servos([90, 60, 120, 90, 30], 800).startswith("OK"), r)
        time.sleep(0.4)
        st = mcu.status()
        expect("interpolating (joints mid-move)", bool(st) and st["joints"] != [90, 60, 120, 90, 30], r)
        time.sleep(0.7)
        st = mcu.status()
        expect("reached target pose", bool(st) and st["joints"] == [90, 60, 120, 90, 30], r)
        expect("zero_all", mcu.zero_all().startswith("OK"), r)
        time.sleep(1.6)

    if only in (None, "estop"):
        print("\n== smoke: estop latch ==")
        expect("estop -> state 3", mcu.estop().strip() == "OK 3", r)
        expect("drive ignored in ESTOP (still 3)", mcu.drive(1, 1).strip() == "OK 3", r)
        expect("clear_estop leaves 3", not mcu.clear_estop().strip().endswith("3"), r)

    if only in (None, "watchdog"):
        print("\n== smoke: watchdog (arm, then no heartbeat 700 ms) ==")
        expect("W 1 arms watchdog", mcu.cmd("W 1").startswith("OK"), r)
        time.sleep(0.7)
        st = mcu.status()   # Q is not a heartbeat — must NOT feed the watchdog
        expect("state == WATCHDOG after silence", bool(st) and st["state"] == "WATCHDOG", r)
        expect("heartbeat recovers", mcu.heartbeat().strip() in ("OK 0", "OK 1"), r)
        expect("W 0 disarms", mcu.cmd("W 0").startswith("OK"), r)

    if only in (None, "errors"):
        print("\n== smoke: error paths ==")
        expect("unknown cmd -> ERR 3", mcu.cmd("X").startswith("ERR 3"), r)
        expect("unparseable arg -> ERR 2", mcu.cmd("D zero zero").startswith("ERR 2"), r)

    passed = sum(1 for _, ok in r if ok)
    print(f"\n{passed}/{len(r)} passed")
    return passed == len(r)


# ----------------------------------------------------------------------- repl
def repl(mcu: Mcu):
    print("raw protocol REPL — BRIDGE.md §5. helpers: st, hb-loop. ctrl-d exits.")
    while True:
        try:
            line = input("mcu> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not line:
            continue
        if line == "st":
            print(mcu.status())
        elif line == "hb-loop":
            print("heartbeating at 5 Hz, ctrl-c to stop")
            try:
                while True:
                    mcu.heartbeat()
                    time.sleep(0.2)
            except KeyboardInterrupt:
                print()
        else:
            mcu.cmd(line)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial device (default: autodetect)")
    ap.add_argument("-i", "--interactive", action="store_true", help="REPL instead of smoke test")
    ap.add_argument("--smoke", choices=["drive", "servos", "estop", "watchdog", "errors"],
                    help="run only one smoke section")
    args = ap.parse_args()

    mcu = Mcu(args.port or find_port())
    if args.interactive:
        repl(mcu)
    else:
        sys.exit(0 if smoke(mcu, args.smoke) else 1)


if __name__ == "__main__":
    main()
