# INTEGRATION.md - first power-on hardware runbook

**Owner: fw-tools.** This is the checklist for the moment the *real* robot
arrives and gets powered for the first time. The whole software stack is
already demoable on mocks (`scripts/demo.sh`) - this runbook is about bringing
up **physical** hardware **incrementally and safely**, one subsystem at a time,
so a wiring mistake trips a fuse and not the demo.

Golden rule: **never** move to the next step until the current one passes.
Most first-power-on disasters (brownout reboots, stripped gripper gears, a
motor spinning the wrong way into a table) are caught by testing each
subsystem *in isolation, in bench mode, before* the arm has horns on it.

References this runbook leans on:
- `firmware/BRIDGE.md` - RPC + serial bench protocol, safety states (cited below)
- `firmware/PINOUT.md` - pin map + servo pins + power gotchas
- `docs/HARDWARE.md` - power tree (servo buck, caps, common ground)
- `firmware/tools/` - `setup.sh`, `flash.sh`, `monitor.sh`, `bench.py`, `mock_mcu.py`

---

## 0. Bring-up order (the whole flow at a glance)

```
POWER OFF  -> wiring audit -> rail check (multimeter, NO servos/motors yet)
   v
FLASH MCU  -> tools/flash.sh --check -> tools/flash.sh
   v
BENCH MODE (serial, watchdog disarmed) - each subsystem alone:
   status -> servos (zero FIRST, horns AFTER) -> watchdog -> estop -> drive
   v
BRIDGE UP  -> robot_node against REAL Bridge (not --sim): heartbeat + telemetry
   v
CANNED PICK -> replay a recorded pick->bin sequence on a real 3D-printed apple  (P0 demo)
   v
FULL DEMO  -> scripts/demo.sh with the real robot in place of the mock
```

If any stage past "BENCH MODE" misbehaves during judging, jump to
[§6 Rollback / panic](#6-rollback--panic) - the demo falls back to mocks in seconds.

---

## 1. Before ANY power (wiring audit)

- [ ] Wiring matches `firmware/PINOUT.md` pin-for-pin. The four servo signal
      wires go straight to **D3/D9/D10/D11** (3.3 V pulse, no driver board).
      Re-check the optional **battery sense** divider on A0. All MCU header GPIO
      is **3.3 V** - nothing 5 V touches a pin bare.
- [ ] **Common ground everywhere**: battery GND <-> motor-driver GND <-> servo-buck
      GND <-> UNO Q GND. This is non-negotiable; a floating ground is the #1 cause
      of "mystery reboots."
- [ ] Servos are on their **own 5 V ≥5 A buck** with the **1000 µF cap** across
      the rail, feeding each servo's `V+`. **Never** power servos from the UNO Q
      3.3 V/5 V rails (see PINOUT.md gotcha) - only the 3.3 V *signal* comes from
      the GPIO.
- [ ] **No servo horns installed yet.** Horns go on *after* `zero_all` in §3d,
      or the arm will slam to a hard stop on first power.
- [ ] Wheels **off the ground** (robot on a stand / box) for all of §3.
- [ ] Fruit, fingers, and cables clear of the arm's swept volume.

## 2. Power rails (multimeter, before flashing motion)

Power on with the **motor driver VM and the servo V+ still disconnected** if you
can (bring logic up first). Then measure:

- [ ] UNO Q logic rail = **3.3 V** (±0.1).
- [ ] Servo buck output = **5.0–5.2 V** under no load. Re-check it does **not**
      sag below ~4.7 V when a single servo moves (§3d) - sag = brownout = the
      board resets mid-pick.
- [ ] Motor driver VM = battery voltage (~11.1 V for 3S).
- [ ] Battery sense (if populated) on A0 reads within the 3.3 V divider range.

---

## 3. Bench-test each subsystem (serial, isolated)

Flash the sketch, then talk to it over USB serial - **no Linux side, no Bridge**.
This is the safest way to exercise motion. Bench mode uses the single-letter
protocol in **BRIDGE.md §5** (115200 baud, newline-terminated).

**Flash:**
```bash
cd firmware
tools/setup.sh              # one-time: arduino-cli + core + libs (idempotent)
tools/flash.sh --check      # compile-only sanity first
tools/flash.sh              # build + upload (auto FQBN/port)
```

**Open the bench console:** `tools/monitor.sh` (raw serial) - or drive it
programmatically with `tools/bench.py`. The command->behavior contract is
mirrored exactly by `tools/mock_mcu.py`, so if in doubt about an expected
response, `python3 tools/mock_mcu.py --selftest` shows the reference transcript.

> **Bench mode boots with the watchdog DISARMED** (BRIDGE.md §5) so human-paced
> typing doesn't sit in `WATCHDOG`. Arm it only for the watchdog test (§3c).

Safety-state cheat-sheet (BRIDGE.md §2) - every command replies `OK <state>`:
`0 OK · 2 WATCHDOG · 3 ESTOP`. Priority ESTOP > WATCHDOG > OK.

### 3a. Boot + status
- [ ] On reset the MCU prints one banner: `# uno-q-mcu bench <version>`.
- [ ] `?` lists commands. `Q` returns
      `ST <state> <battery_mv> <j0..j3> <l_pct> <r_pct>`.
- [ ] State is `0` (OK) at rest.

### 3b. Servos - zero FIRST, horns AFTER
- [ ] With **horns off**, `Z` (`zero_all`) -> all 4 servos interpolate to 90°
      over 1.5 s. Confirm each output is holding mid-travel.
- [ ] Power off, **install horns** at the neutral/centered mechanical pose, power
      back on, `Z` again to confirm alignment.
- [ ] Move ONE joint a small delta, watch the servo-rail voltage (§2) for sag:
      `S 90 100 90 90 1000` (shoulder -> 100°, 1 s). Motion must be **smooth**,
      never a snap. Repeat per joint with small deltas.
- [ ] **Gripper clamp**: creep the gripper joint (idx 3) toward closed in small
      steps and find the angle where it grips a printed apple *without stalling*.
      That angle bounds `JOINT_MIN/MAX_DEG[3]` in fw-mcu - the full range strips
      the gears. Record the safe range.

### 3c. Watchdog
- [ ] `W 1` arms the bench watchdog (and resets its timer).
- [ ] Stop sending `H` for > 500 ms -> `Q` shows state `2` (WATCHDOG): drive PWM
      0, servos **hold last pose** (must NOT go limp).
- [ ] `H` recovers to `0`. `W 0` disarms again.

### 3d. E-stop (latched)
- [ ] `E` -> state `3` (ESTOP). Confirm `D 1 1` is **ignored** (still `3`) and
      servo interpolation is frozen.
- [ ] `C` (`clear_estop`) exits ESTOP. Motion does **not** auto-resume - the
      host must re-command. Good.

### 3e. Drive motors (wheels still off the ground)
- [ ] `D 0.3 0.3` -> both wheels spin **forward** (forward = toward the gripper
      side, PINOUT.md). If a wheel runs backward, fix it in hardware (swap that
      motor's two leads) or the single `M_L_INVERT`/`M_R_INVERT` `#define` -
      **not** with scattered sign flips.
- [ ] `D 0.3 -0.3` turns in place. `D 0 0` stops.

---

## 4. Bridge integration (Linux side, real transport)

Now connect the QRB2210 Linux side to the STM32 over the App Lab Bridge
(BRIDGE.md §4, `Arduino_RouterBridge`). The RPC surface is identical to the
serial letters you just tested.

- [ ] Bring up the Linux-side RPC router; confirm `heartbeat()` round-trips
      (returns an int state) and `get_status()` returns the 10-int array.
- [ ] Run the real robot node (drop `--sim`):
      ```bash
      cd firmware/linux
      .venv/bin/python -m robot_linux.robot_node --server http://<laptop>:3001
      ```
- [ ] On the dashboard: `state` badge live, `arm[4]` tracks the real joints,
      battery reads real millivolts (not 0). Heartbeat holds at 5 Hz - if the
      node dies, the MCU trips `WATCHDOG` within 500 ms and the arm holds pose.
- [ ] Fire an `estop` from the web UI -> MCU latches `ESTOP`, motion dies
      immediately. Clear from the UI -> recovers. This is the safety path judges
      (and you) rely on; verify it works end-to-end **before** the arm carries
      anything heavy.

## 5. Canned pick (the P0 demo)

- [ ] Using fw-linux's pose recorder, jog to and save the pick approach, grasp,
      lift, carry, and each bin-drop pose (`apple_ripe`/`apple_unripe`/
      `banana_ripe`/`banana_unripe`).
- [ ] Replay the full **pick -> sort -> drop** sequence on a real 3D-printed apple.
      Watch the servo rail for sag on the lift; if it browns out, slow the
      interpolation (larger `duration_ms`) or stiffen the buck/cap.
- [ ] Confirm a `pick_event` lands on the dashboard with the right `bin` and
      `success:true`. **Film this** - it's the backup demo.

---

## 6. Rollback / panic

If hardware misbehaves at the venue, you are never stuck - the software demo is
self-sufficient. In rough order of escalation:

1. **Hardware e-stop first.** Web UI `estop`, or `E` on the serial console, or
   cut servo/motor power. The arm holds pose (it won't go limp and drop).
2. **Bad subsystem, rest OK?** Keep teleop/vision running and just don't command
   the broken joint. `WATCHDOG`/`ESTOP` both fail safe by design.
3. **Whole robot flaky mid-judging?** Fall back to the fully-mocked stack:
   ```bash
   scripts/demo.sh restart          # hub + mock robot + lidar sim + dashboard
   ```
   The mock robot auto-runs SEEK->PICK->SORT with live-looking telemetry,
   detections, pick_events, and lidar. Judges see the same dashboard.
   - `HT6_ROBOT_SIM=1 scripts/demo.sh up` swaps in server-core's built-in
     `sim.js` robot if the Python node's venv is unhappy.
   - server-core's **force-sim panic switch** (see `docs/DEPLOY.md`) can flip the
     hub to simulated telemetry live, without restarting anything, if the real
     robot drops mid-demo.
4. **Recorded footage** of the canned pick (§5) is the final fallback - always
   have it filmed and ready to play.

**To resume real hardware after a rollback:** power-cycle the MCU (clears any
latched `ESTOP`), re-run the §3 smoke subset (status -> estop -> drive), then
§4 to reconnect the node. Don't skip straight back to a live pick.

---

## Quick smoke test (go / no-go before a demo run)

| Check | Command | Pass = |
|---|---|---|
| Toolchain compiles | `firmware/tools/flash.sh --check` | `compile OK` |
| Bench logic sane | `python3 firmware/tools/mock_mcu.py --selftest` | `18/18 passed` |
| MCU alive on serial | `Q` in `tools/monitor.sh` | `ST 0 ...` banner seen |
| E-stop latches | `E` then `D 1 1` | stays state `3` |
| Software stack up | `scripts/demo.sh status` | hub/robot/lidar/web all OK |
| Full stack from cold | `scripts/demo.sh up` | dashboard live at :5173 |
