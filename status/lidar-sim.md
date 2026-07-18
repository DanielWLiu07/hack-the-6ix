# lidar-sim status

## [22:07] DONE — Task 1: sim.py synthetic lidar source is live-ready
`robot/lidar/sim/sim.py`: fake robot patrols an 8×6 m room (crates, pillar, 1 moving obstacle), raycast 360-beam scans with noise+dropout, emits schema-exact `lidar_scan` (`ts` = epoch **ms**, ≤360 robot-frame meter points) at 2 Hz to `$SERVER_URL` (default `http://localhost:3001`). Retries every 2 s until the server exists and auto-reconnects — safe to start before server-core's hub.
Run: `cd robot/lidar/sim && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python sim.py` (or `--once`/`--stdout` for no-server schema checks; `--rate N` to change Hz).
Verified: 5/5 unit tests (`python3 test_sim.py`) + end-to-end against a throwaway local Socket.IO hub — received scans at 4 Hz, ~350 pts each, ranges evolve as robot drives.
@web-frontend: you're unblocked for the 3D view as soon as server-core's relay is up. @server-core: I'll point sim.py at :3001 the moment your status says the hub is listening — ping me there if you want a live source for relay testing.

## [22:09] DONE — Task 2: scan accumulation/decay spec published for web-frontend
`robot/lidar/sim/DECAY.md` — full reference: ring buffer of last K=8 scans, per-scan age fade (`1 - age/4s` or exp), one `<points>` per scan in r3f (JSX sketch included), lidar→three.js frame mapping (`three.z = -lidar.y` — avoids mirrored map), glow settings, and an optimized single-buffer variant if ever needed.
Key design note for @web-frontend: `lidar_scan` carries NO robot pose, so accumulation must be **robot-centered** (radar-style) — do not attempt world-frame stitching; doc explains. Handle variable point count (~340–360) per scan.
Next: Task 3 (scan-matching stretch) is gated on lidar-pi being done+idle — lidar-pi has no status file yet, so holding. Will keep sim running/polling BROADCAST.

## [22:11] DONE — sim.py now LIVE against server-core's hub on :3001
Detected the hub listening; started `sim.py` (PID 50097, log: session scratchpad `sim_live.log`) — it connected and is emitting `lidar_scan` at 2 Hz right now. @web-frontend: live data is flowing for your r3f view. @server-core: you should see a robot-side client emitting `lidar_scan`; tell me via status if you want a different rate or if my events aren't relaying.
If it dies, restart: `cd robot/lidar/sim && .venv/bin/python sim.py`. Holding on Task 3 (gated on lidar-pi); monitoring BROADCAST.
