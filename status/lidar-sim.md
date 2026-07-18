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

## [22:14] DONE — bonus: viz.py debug renderer; all assigned tasks complete
Added `robot/lidar/sim/viz.py` (`.venv/bin/pip install matplotlib`, then `.venv/bin/python viz.py out.png 8`) — renders N accumulated scans age-faded to PNG; verified output shows correct room geometry + the decay effect web-frontend will build. Good for demo backup footage of the sim.
State: sim.py running live against :3001 at 2 Hz (PID 50097). Tasks 1+2 done; Task 3 (scan-matching) still gated on lidar-pi done+idle. I'm free — master, assign me anywhere if lidar-pi stays busy.

## [restart] WIP — recovered from crash; sim.py relaunched, starting Phase 2
Crash killed my live sim.py (old PID 50097). Verified on-disk work intact: `test_sim.py` 5/5 pass; hub on :3001 is back up (server-core restarted, uptime healthy). Relaunched `sim.py` (new PID 24151, log in scratchpad `sim_live.log`) — it reconnected and shows as `robot:1` in `/api/health`, emitting `lidar_scan` at 2 Hz. lidar-pi reports its software tasks 1–3 DONE, so my Task-3 scan-matching stretch is now UNGATED. Starting Phase-2 directives: (a) scan-matching stretch, (b) scripted room-tour for demo video.

## [DONE] Phase-2 (a): Task-3 scan-matching stretch — SLAM-lite from pose-less scans
`robot/lidar/sim/scan_match.py`: point-to-point ICP + `ScanMapper` scan-to-map odometry that recovers robot pose + a global occupancy map from the `lidar_scan` stream ALONE (no wheel/IMU odometry — the schema carries no pose). Aligns each scan to the growing map with a constant-velocity prior + adaptive residual/motion gate. Runs at the lidar's native ~10 Hz (not the 2 Hz display throttle) to stay in ICP's convergence basin. Open-loop drift ~10–15% of path (no loop closure — wow-feature, not metric SLAM). Tests: `test_scan_match.py` 6/6 pass (transform round-trip, exact ICP recovery, outlier robustness, degenerate input, static-identity, full-drive drift<2m). `python3 scan_match.py` self-check: ICP 0.0 cm on structured geom, trajectory 13.8% drift over 12.7 m.
Verify: `cd robot/lidar/sim && .venv/bin/python test_scan_match.py`.

## [DONE] Phase-2 (b): scripted room-tour demo video renderer
`robot/lidar/sim/tour.py`: deterministic room tour → runs ScanMapper → renders the global map assembling in real time (accumulated map + live scan + recovered trajectory + robot pose) to mp4/gif, plus a `_map.png` hero still. Backup demo footage of "robot maps a room from lidar." `matplotlib` + system `ffmpeg` (gif via pillow); matplotlib intentionally NOT in requirements.txt (viz-only, install ad hoc). Run: `.venv/bin/python tour.py tour.mp4` (16 s default; `--seconds`/`--fps`/`.gif`). Rendered samples verified (room outline, crate, bench, pillar clearly readable; moving-obstacle trail visible as expected). README.md updated with both tools.
State: sim.py live on :3001 (PID 24151). ALL assigned tasks + both Phase-2 directives DONE + verified. Idle-ready — master, assign me anywhere. Could help lidar-pi with phone→world.glb pipeline or web-frontend if useful.
