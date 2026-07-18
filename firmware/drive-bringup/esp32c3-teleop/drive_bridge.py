#!/usr/bin/env python3
"""Serial bridge: hub `drive` events -> ESP32-C3 over USB serial, with
auto-reconnect.

Connects to the Socket.IO hub as role=robot and forwards each `drive {l,r}` to
the C3 as "l r\n". Echoes the drive back as telemetry so the dashboard/monitor
shows it. `estop` -> stop.

Serial is managed in a background thread: it auto-detects the port
(/dev/ttyACM* or /dev/ttyUSB*), and if the C3 is unplugged the link is dropped
cleanly (no error spam) and re-grabbed automatically on replug - even if the
port comes back under a different name. The hub connection stays up throughout.

Run:  python3 drive_bridge.py [PORT] [HUB]
      PORT optional; omit to auto-detect. e.g. python3 drive_bridge.py
Needs: pyserial + python-socketio[client]
"""
import glob
import sys
import threading
import time

import serial
import socketio

PORT_HINT = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith("/dev/") else None
HUB = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:3001")


class SerialLink:
    """Owns the serial port; reconnects on unplug/replug. Thread-safe write()."""

    def __init__(self, hint=None):
        self.hint = hint
        self.ser = None
        self.port = None
        self.connected = False
        self.lock = threading.Lock()
        threading.Thread(target=self._manage, daemon=True).start()

    def _candidates(self):
        if self.hint:
            return [self.hint]
        return sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))

    def _open(self):
        for p in self._candidates():
            try:
                s = serial.Serial(p, 115200, timeout=0.1)
                time.sleep(2.0)  # C3 reboots on port open (USB-CDC); wait it out
                with self.lock:
                    self.ser, self.port, self.connected = s, p, True
                print(f"[serial] connected {p}")
                return True
            except Exception:
                continue
        return False

    def _drop(self, why):
        with self.lock:
            if self.ser is not None:
                try:
                    self.ser.close()
                except Exception:
                    pass
            if self.connected:
                print(f"[serial] link lost ({why}); waiting for replug...")
            self.ser, self.connected = None, False

    def _manage(self):
        while True:
            if self.ser is None:
                if not self._open():
                    time.sleep(1.0)  # nothing to open yet; poll for replug
                continue
            # connected: read + echo the C3, use read errors as a drop signal
            try:
                line = self.ser.readline().decode(errors="ignore").strip()
                if line:
                    print("[esp32]", line)
            except Exception as e:
                self._drop(str(e))
            time.sleep(0.005)

    def write(self, l, r):
        with self.lock:
            if self.ser is None:
                return False
            try:
                self.ser.write(f"{l:.3f} {r:.3f}\n".encode())
                return True
            except Exception as e:
                # close now; the manage loop will reconnect on replug
                try:
                    self.ser.close()
                except Exception:
                    pass
                if self.connected:
                    print(f"[serial] write failed ({e}); waiting for replug...")
                self.ser, self.connected = None, False
                return False


link = SerialLink(PORT_HINT)
sio = socketio.Client(reconnection=True, reconnection_delay=1)
last = {"l": 0.0, "r": 0.0}


def send(l, r):
    l = max(-1.0, min(1.0, l))
    r = max(-1.0, min(1.0, r))
    last["l"], last["r"] = l, r
    link.write(l, r)


@sio.on("drive")
def on_drive(d):
    try:
        send(float(d.get("l", 0)), float(d.get("r", 0)))
    except (TypeError, ValueError):
        pass


@sio.on("estop")
def on_estop(_=None):
    send(0, 0)
    print("ESTOP -> motors stopped")


@sio.event
def connect():
    print("connected to hub as robot")


def main():
    sio.connect(HUB, auth={"role": "robot"})
    hint = PORT_HINT or "auto-detect /dev/ttyACM*"
    print(f"bridge up: hub {HUB} -> {hint}  (drive the Teleop page now)")
    try:
        while True:
            state = "SEEK" if link.connected else "IDLE"
            sio.emit("telemetry", {
                "ts": int(time.time() * 1000), "state": state,
                "battery_v": 0.0, "arm": [90] * 5,
                "drive": {"l": last["l"], "r": last["r"]},
            })
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        send(0, 0)
        time.sleep(0.1)
        try:
            sio.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    main()
