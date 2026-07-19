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

Optional hub mirror (so ONE serial owner feeds both the robot AND the dashboard):
set env `HUB_URL` (e.g. http://ubentu:3001) and this also connects to the laptop
Socket.IO hub as a `robot` publisher and emits `lidar_scan` / `slam_pose` /
`slam_map` (the same events the dashboard already renders). It is strictly
best-effort and additive: if python-socketio / occupancy aren't importable or the
hub is unreachable, the TCP autonomy path above runs unchanged (never blocked).
Without `HUB_URL` the mirror is off and this stays the dependency-free TCP feed.

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

# Optional hub mirror (dashboard). Off unless HUB_URL is set.
HUB_URL = os.environ.get('HUB_URL') or os.environ.get('SERVER_URL')
SCAN_HZ = float(os.environ.get('HUB_SCAN_HZ', '5'))    # lidar_scan emit rate
POSE_HZ = float(os.environ.get('HUB_POSE_HZ', '2'))    # slam_pose emit rate
MAP_HZ  = float(os.environ.get('HUB_MAP_HZ', '0.5'))   # slam_map emit rate

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

# Optional occupancy grid for the hub slam_map (best-effort; needs numpy too).
_HAVE_GRID = False
_grid = None
if HUB_URL and _HAVE_SLAM:
    try:
        from occupancy import OccupancyGrid
        _grid = OccupancyGrid()
        _HAVE_GRID = True
    except Exception as e:                  # noqa: BLE001
        print(f'[direct_feed] slam_map disabled ({e}); mirroring scan+pose only',
              file=sys.stderr)

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


# --- optional hub mirror -----------------------------------------------------
# Best-effort Socket.IO publisher to the laptop dashboard hub. Everything here is
# wrapped so a mirror failure can never disturb the TCP autonomy feed.
_sio = None
_hub_last = {'scan': 0.0, 'pose': 0.0, 'map': 0.0}


def hub_connect_thread():
    """Connect to the hub as a `robot` publisher; reconnection is handled by the
    client. Runs in the background so it never blocks serial bring-up."""
    global _sio
    try:
        import socketio
    except Exception as e:                  # noqa: BLE001
        print(f'[direct_feed] hub mirror disabled (no socketio: {e})', file=sys.stderr)
        return
    _sio = socketio.Client(reconnection=True, reconnection_delay=1,
                           reconnection_delay_max=5, logger=False, engineio_logger=False)
    while not _stop.is_set():
        try:
            _sio.connect(HUB_URL, auth={'role': 'robot'}, wait_timeout=10)
            print(f'[direct_feed] hub mirror connected {HUB_URL} (role=robot)', file=sys.stderr)
            return
        except Exception as e:              # noqa: BLE001
            print(f'[direct_feed] hub connect failed ({e}); retry 3s', file=sys.stderr)
            _stop.wait(3.0)


def _emit(event, payload):
    if _sio is None or not _sio.connected:
        return
    try:
        _sio.emit(event, payload)
    except Exception:                       # noqa: BLE001 - never let a socket hiccup touch the feed
        pass


def mirror_to_hub(pts, pose, ts_ms):
    """Mirror one scan to the dashboard hub (throttled). No-op if not connected.

    Emits the same events the dashboard already renders:
      lidar_scan  {ts, points:[[x,y],...]}   (robot-frame meters, <=360 pts)
      slam_pose   {ts, x, y, theta}          (world m / rad)
      slam_map    occupancy grid payload      (best-effort, needs _grid)
    """
    if _sio is None or not _sio.connected:
        return
    now = time.time()
    # lidar_scan: subsample to <=360 pts (schema cap) and emit at SCAN_HZ.
    if SCAN_HZ > 0 and now - _hub_last['scan'] >= 1.0 / SCAN_HZ:
        _hub_last['scan'] = now
        step = max(1, (len(pts) + 359) // 360)
        points = [[round(x, 3), round(y, 3)] for x, y in pts[::step]][:360]
        _emit('lidar_scan', {'ts': ts_ms, 'points': points})
    if pose is None:
        return
    # slam_pose at POSE_HZ.
    if POSE_HZ > 0 and now - _hub_last['pose'] >= 1.0 / POSE_HZ:
        _hub_last['pose'] = now
        _emit('slam_pose', {'ts': ts_ms, 'x': pose['x'], 'y': pose['y'],
                            'theta': pose['theta']})
    # slam_map at MAP_HZ: integrate this scan (robot -> world) then emit the grid.
    if _HAVE_GRID and MAP_HZ > 0 and now - _hub_last['map'] >= 1.0 / MAP_HZ:
        _hub_last['map'] = now
        try:
            px, py, th = pose['x'], pose['y'], pose['theta']
            c, s = math.cos(th), math.sin(th)
            world = np.array([[px + x * c - y * s, py + x * s + y * c]
                              for x, y in pts], float)
            _grid.integrate((px, py), world)
            _emit('slam_map', _grid.slam_map_payload(ts_ms))
        except Exception as e:              # noqa: BLE001
            print(f'[direct_feed] slam_map integrate failed: {e}', file=sys.stderr)


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
                    mirror_to_hub(pts, msg['pose'], msg['ts'])
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
    if HUB_URL:
        print(f'[direct_feed] hub mirror on -> {HUB_URL} (slam_map={_HAVE_GRID})', file=sys.stderr)
        threading.Thread(target=hub_connect_thread, daemon=True).start()
    lidar_thread()


if __name__ == '__main__':
    main()
