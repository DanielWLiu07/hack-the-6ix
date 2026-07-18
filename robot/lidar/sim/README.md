# lidar sim — synthetic `lidar_scan` source

Fake 360° lidar: a kinematic robot patrols an 8×6 m room (crates, pillar, one
moving obstacle) and raycast scans are emitted as root-schema `lidar_scan`
Socket.IO events. Use it to develop the dashboard 3D view with zero hardware.

## Run

```sh
cd robot/lidar/sim
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
.venv/bin/python sim.py                    # emit to $SERVER_URL (default http://localhost:3001) at 2 Hz
SERVER_URL=http://192.168.x.x:3001 .venv/bin/python sim.py --rate 5
.venv/bin/python sim.py --once             # print one JSON payload (schema check, no server needed)
.venv/bin/python sim.py --stdout           # stream payloads to stdout
```

If the server isn't up yet, sim.py retries every 2 s and auto-reconnects on
drops — safe to start in any order.

## Payload

```json
{"ts": 1784340423511, "points": [[4.73, 0.0], ...]}
```

- `ts`: epoch **milliseconds** (JS `Date.now()` convention)
- `points`: cartesian meters, **robot frame** (+x = robot forward, +y = robot left,
  CCW), ≤360 points. Beams that hit nothing (>8 m) or drop out are omitted, so
  count varies per scan (~340–360).
- Realism: ~1.2 cm gaussian range noise, 2 % beam dropout, one moving obstacle.

## Tests

```sh
python3 test_sim.py   # raycast math, robot-frame rotation, schema shape, bounds
```

See `DECAY.md` for the scan-accumulation/decay algorithm the web view should
implement.
