#!/usr/bin/env python3
"""Direct lidar autonomy feed - Pi -> Uno Q, no hub, no internet, zero deps.

Reads the RPLIDAR C1 on the Pi GPIO UART, computes an obstacle summary (and a
SLAM pose when scan_match is importable), and streams it as newline-delimited
JSON over a plain TCP socket on the LOCAL network. This is the real-time feed the
decision stack (`robot_node` on the Uno Q) consumes for reactive obstacle
avoidance / navigation - deliberately NOT routed through the laptop hub or
Tailscale, so the control path survives with zero internet and no operator laptop
present. Plain TCP + stdlib json keeps a safety-path component dependency-free on
both boards (no websockets / socket.io to install or wedge).

One process owns the serial port (exclusive), so stop any other lidar reader
(lidar-viewer / lidar-slam / c1_slam_node) before running this.

Wire protocol: one compact JSON object per scan (~10 Hz), terminated by '\n':
    {
      "ts": 1784...,                          # epoch ms
      "pose": {"x":.., "y":.., "theta":..} | null,   # SLAM world m / rad (null if no scan_match)
      "nearest": {"range": 0.34, "bearing": 12.0},   # closest return; bearing deg, 0=fwd +ccw(left)
      "forward_clearance": 0.80,              # min range within +/-FORWARD_CONE_DEG of forward (m)
      "sectors": [{"c": 0, "min": 0.8}, ...], # N sectors, center bearing deg + min range (null if empty)
      "n": 349                                # points this scan
    }
Bearing: 0 = robot forward, +90 = left, 180 = behind, 270 = right (x fwd / y left).
"""
import os, math, json, time, threading, signal, sys, socket

import serial

PORT   = os.environ.get('LIDAR_PORT', '/dev/ttyAMA0')
BAUD   = int(os.environ.get('LIDAR_BAUD', '460800'))
PWM    = int(os.environ.get('MOTOR_PWM', '1023'))
OFFSET = float(os.environ.get('ANGLE_OFFSET_DEG', '0'))
TCP_PORT = int(os.environ.get('FEED_PORT', '8766'))
FWD_CONE = float(os.environ.get('FORWARD_CONE_DEG', '30'))
N_SECT  = int(os.environ.get('N_SECTORS', '12'))
MIN_R   = float(os.environ.get('MIN_RANGE_M', '0.10'))

# Optional SLAM pose. If scan_match isn't importable we still ship obstacles.
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, '/home/pi')
    import numpy as np
    import scan_match as sm
    _mapper = sm.ScanMapper()
    _HAVE_SLAM = True
except Exception as e:                      # noqa: BLE001
    print(f'[direct_feed] SLAM pose disabled ({e}); shipping obstacles only', file=sys.stderr)
    _HAVE_SLAM = False
    np = None

_clients = set()
_clients_lock = threading.Lock()
_stop = threading.Event()
_ser = None


def _send(s, c, payload=b''):
    pkt = bytes([0xA5, c])
    if payload:
        pkt += bytes([len(payload)]) + payload
        cs = 0
        for b in pkt:
            cs ^= b
        pkt += bytes([cs])
    s.write(pkt); s.flush()


def _stop_motor(s):
    try:
        _send(s, 0x25); time.sleep(0.05); _send(s, 0xF0, bytes([0, 0]))
    except Exception:
        pass


def summarize(pts):
    """pts: list[(x,y)] robot frame, meters -> obstacle summary dict."""
    nearest = None
    fwd = None
    sect_min = [None] * N_SECT
    sect_w = 360.0 / N_SECT
    for x, y in pts:
        r = math.hypot(x, y)
        if r < MIN_R:
            continue
        b = math.degrees(math.atan2(y, x))        # 0 fwd, +ccw(left)
        if nearest is None or r < nearest[0]:
            nearest = (r, b)
        if abs(b) <= FWD_CONE and (fwd is None or r < fwd):
            fwd = r
        idx = int(((b + 360) % 360) // sect_w)
        if sect_min[idx] is None or r < sect_min[idx]:
            sect_min[idx] = r
    sectors = [{'c': round(i * sect_w, 1),
                'min': (round(sect_min[i], 3) if sect_min[i] is not None else None)}
               for i in range(N_SECT)]
    return {
        'nearest': ({'range': round(nearest[0], 3), 'bearing': round(nearest[1], 1)}
                    if nearest else None),
        'forward_clearance': (round(fwd, 3) if fwd is not None else None),
        'sectors': sectors,
    }


def broadcast(line):
    payload = (line + '\n').encode()
    with _clients_lock:
        dead = []
        for c in _clients:
            try:
                c.sendall(payload)
            except Exception:
                dead.append(c)
        for c in dead:
            _clients.discard(c)
            try:
                c.close()
            except Exception:
                pass


def accept_thread():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('0.0.0.0', TCP_PORT))
    srv.listen(8)
    srv.settimeout(1.0)
    print(f'[direct_feed] listening tcp://0.0.0.0:{TCP_PORT}', file=sys.stderr)
    while not _stop.is_set():
        try:
            conn, addr = srv.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        with _clients_lock:
            _clients.add(conn)
        print(f'[direct_feed] client {addr} ({len(_clients)})', file=sys.stderr)
    srv.close()


def lidar_thread():
    global _ser
    while not _stop.is_set():
        try:
            _ser = serial.Serial(PORT, BAUD, timeout=0.5)
        except Exception as e:
            print(f'[direct_feed] open {PORT} failed: {e}; retry 2s', file=sys.stderr)
            time.sleep(2); continue
        s = _ser
        _send(s, 0x25); time.sleep(0.3); s.reset_input_buffer()
        _send(s, 0xF0, bytes([PWM & 0xFF, (PWM >> 8) & 0xFF])); time.sleep(2.0)
        _send(s, 0x20); s.read(7)
        print(f'[direct_feed] scanning (slam={_HAVE_SLAM})', file=sys.stderr)
        buf = bytearray(); scan = []
        while not _stop.is_set():
            try:
                chunk = s.read(2048)
            except Exception as e:
                print(f'[direct_feed] read error: {e}', file=sys.stderr); break
            if chunk:
                buf += chunk
            while len(buf) >= 5:
                b0 = buf[0]
                if ((b0 & 1) == ((b0 >> 1) & 1)) or not (buf[1] & 1):
                    buf.pop(0); continue
                node = buf[:5]; del buf[:5]
                start = node[0] & 1
                ang = (((node[2] << 7) | (node[1] >> 1)) / 64.0 + OFFSET) % 360.0
                dist = ((node[4] << 8) | node[3]) / 4.0
                if start and scan:
                    pts = [((d / 1000.0) * math.cos(math.radians(a)),
                            -(d / 1000.0) * math.sin(math.radians(a))) for a, d in scan]
                    msg = {'ts': int(time.time() * 1000), 'n': len(pts), 'pose': None}
                    if _HAVE_SLAM:
                        try:
                            _mapper.add(np.array(pts, float))
                            px, py, th = _mapper.pose
                            msg['pose'] = {'x': round(float(px), 3), 'y': round(float(py), 3),
                                           'theta': round(float(th), 4)}
                        except Exception:
                            pass
                    msg.update(summarize(pts))
                    broadcast(json.dumps(msg))
                    scan = []
                if dist > 0:
                    scan.append((ang, dist))
        _stop_motor(s)
        try:
            s.close()
        except Exception:
            pass


def _sig(*_):
    _stop.set()
    if _ser is not None:
        _stop_motor(_ser)
    time.sleep(0.2)
    sys.exit(0)


def main():
    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)
    threading.Thread(target=accept_thread, daemon=True).start()
    lidar_thread()


if __name__ == '__main__':
    main()
