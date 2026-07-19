# teleop — Uno Q rover teleop (from scratch)

Drive the rover from a game controller with **no laptop hub** — the Uno Q is the
whole stack. It serves a web page on `:7000`; your browser reads the controller
(Gamepad API) and streams tank `{l,r}` straight to the MCU over the App Lab
Bridge. Self-contained, so there's very little to break.

```
controller ─▶ browser page (:7000, served by the Uno Q)
           ─socket.io "drive"{l,r}▶ python/main.py ─Bridge.call("set_drive")▶ MCU sketch ─▶ BTS7960 ─▶ motors
```

## Files
- `sketch/sketch.ino` — new minimal MCU firmware: BTS7960 dual-PWM drive +
  `set_drive/heartbeat/stop/estop/clear_estop/get_status` RPC + 500 ms watchdog.
  Teleop only — no arm/sonar/bench.
- `assets/index.html` — the teleop **page** (Gamepad API + on-screen touch pad +
  WASD/arrow keys, live L/R bars, e-stop). `assets/socket.io.min.js` is bundled
  so it works offline at the venue.
- `python/main.py` — the App Lab node: `web_ui` brick + a single-threaded control
  loop that heartbeats the MCU and forwards the latest command with a deadman
  timeout.
- `app.yaml` — declares the `arduino:web_ui` brick and exposes port 7000.
- `bringup.sh` — one-command deploy from the laptop.

## Bring up
From the laptop (board on tailscale as `uno-q` / `100.111.103.46`):
```bash
cd firmware/teleop
./bringup.sh
```
First run compiles + flashes the MCU (~2 min) and starts the node. Then open
**http://100.111.103.46:7000** (or the printed LAN URL) in a browser with the
controller plugged into that computer.

## Drive
- **Left stick / touch pad**: up = forward, sideways = turn (arcade mix).
- **Hold R2**: deadman — motors only move while held (toggle off in the UI).
- **○** e-stop, **✕** clear. Keyboard: **WASD**/arrows to drive, **Space** e-stop.
- **Speed cap** slider to start slow.

Turn the **battery ON** for the wheels to actually move. Bench-test with the
wheels off the ground first.

## Tune direction (no reflash)
If a wheel spins the wrong way or the robot steers mirrored, edit the flags at
the top of `python/main.py` (`INV_L` / `INV_R` / `SWAP_LR`) and re-run
`./bringup.sh` — no sketch recompile needed for python-only changes… App Lab
still reflashes on restart, but the values are what change behaviour.
Straight-line trim + stiction floor live in `sketch/sketch.ino`.

## Verify without motors
Open the page, watch the **link** dot go green and the **L/R** bars move with the
stick. `arduino-app-cli app logs ~/ArduinoApps/teleop` shows `page connected` and
any bridge errors. Battery off = full path proven, wheels still.
