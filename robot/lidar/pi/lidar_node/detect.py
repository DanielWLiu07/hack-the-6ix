"""Serial device autodetect with a clean NO_DEVICE error path."""

import glob
import os


class NoDeviceError(RuntimeError):
    """Raised when no lidar serial device can be found. Code: NO_DEVICE."""

    code = "NO_DEVICE"


# USB-serial bridge chips used by common hobby lidars:
#   CP210x (Silicon Labs) — RPLIDAR A1/A2 dev boards, many LD-series
#   CH340  (QinHeng)      — cheap clones, some LD19 adapters
KNOWN_VID_PID = {
    (0x10C4, 0xEA60),  # CP2102
    (0x1A86, 0x7523),  # CH340
    (0x0483, 0x5740),  # STM32 virtual COM (some lidar adapters)
}

# Fallback globs, Linux (Pi) first, then macOS for bench testing.
DEVICE_GLOBS = [
    "/dev/ttyUSB*",
    "/dev/ttyACM*",
    "/dev/tty.usbserial*",
    "/dev/tty.SLAB_USBtoUART*",
    "/dev/tty.wchusbserial*",
]


def list_candidates() -> "list[str]":
    """All plausible lidar serial ports, best guesses first."""
    ranked: "list[str]" = []
    # Preferred: pyserial's port list with VID/PID matching.
    try:
        from serial.tools import list_ports

        others = []
        for p in list_ports.comports():
            if p.vid is not None and (p.vid, p.pid) in KNOWN_VID_PID:
                ranked.append(p.device)
            elif p.device and ("USB" in p.device or "usb" in p.device):
                others.append(p.device)
        ranked.extend(others)
    except ImportError:
        pass
    # Fallback: raw globs (also catches ports pyserial missed).
    for pattern in DEVICE_GLOBS:
        for dev in sorted(glob.glob(pattern)):
            if dev not in ranked:
                ranked.append(dev)
    return ranked


def find_lidar_port(explicit_port: str = "") -> str:
    """Resolve the lidar serial port or raise NoDeviceError.

    An explicitly configured port (LIDAR_PORT env) is trusted but must
    exist; otherwise the best autodetect candidate is returned.
    """
    if explicit_port:
        if os.path.exists(explicit_port):
            return explicit_port
        raise NoDeviceError(
            f"NO_DEVICE: configured LIDAR_PORT={explicit_port!r} does not exist"
        )
    candidates = list_candidates()
    if not candidates:
        raise NoDeviceError(
            "NO_DEVICE: no serial device found (checked USB VID/PID and "
            + ", ".join(DEVICE_GLOBS)
            + "). Is the lidar plugged in? Set LIDAR_PORT to override."
        )
    return candidates[0]
