# firmware/mcu - UNO Q STM32U585 real-time core

The Arduino sketch that owns everything with a hard deadline. The QRB2210
Linux core (`firmware/linux/`) owns everything with a model and talks to this
core over the App Lab Bridge RPC defined in `../BRIDGE.md`. Keep that boundary
clean - it's a Qualcomm-track judging criterion.

## What this core does

- **Tank drive** - `set_drive(l,r)` normalized [-1,1] -> PWM + direction, with a
  slew limiter (no rail-spiking step changes) and a deadband.
- **4-servo arm** via direct GPIO PWM (`Servo` lib on D3/D9/D10/D11, no
  driver board) - `move_servos(joints[4], ms)` starts an **always-interpolated**
  (smoothstep-eased) move; poses never snap (snapping browns out the 5 V rail
  and drops fruit). Per-joint soft limits + a speed cap.
- **Watchdog** - kills motion if the Linux heartbeat goes quiet for 500 ms;
  servos **hold** (torque on), never go limp.
- **Two transports, one implementation** - App Lab Bridge RPC (`bridge_rpc.*`)
  and a serial bench console (`bench.*`) are thin bindings over the single
  `rpc_handlers.*` semantic layer, so they can't drift. Full command set +
  safety state machine spec: `../BRIDGE.md`.

## File map

| File | Role |
|---|---|
| `mcu.ino` | setup/loop; non-blocking control tick, LED status, state-transition freeze |
| `config.h` | **all** pins, limits, tuning - the only place to edit hardware constants |
| `rpc_handlers.*` | the one semantic impl of the BRIDGE.md §3 command set |
| `bridge_rpc.*` | App Lab Bridge (`Arduino_RouterBridge`) transport glue (BRIDGE.md §4) |
| `bench.*` | serial bench console (BRIDGE.md §5) - human/`tools/bench.py` typeable |
| `safety.*` | BRIDGE.md §2 state machine: OK / WATCHDOG / ESTOP |
| `drive.*` | tank-drive PWM + slew |
| `arm.*` | interpolated 4-servo pose engine (direct GPIO PWM via `Servo`) |
| `hostcheck.sh` | host-side `g++ -fsyntax-only` over every file with Arduino stubs |

## Wiring (authoritative pin map: `../PINOUT.md`)

`config.h` mirrors `../PINOUT.md` - **that doc is the source of truth for pins;
change pins there and here, not silently.** All UNO Q header GPIO is **3.3 V**
(STM32U585). Current assignment:

| `#define` | Pin | Goes to |
|---|---|---|
| `PIN_SERVO_BASE` | D3 | Arm servo — base yaw (direct GPIO PWM) |
| `PIN_SERVO_SHOULDER` | D10 | Arm servo — shoulder |
| `PIN_SERVO_ELBOW` | D9 | Arm servo — elbow |
| `PIN_SERVO_GRIPPER` | D11 | Arm servo — gripper |
| `PIN_M_L_IN1` / `PIN_M_L_IN2` | D4 / D7 | Motor driver L direction |
| `PIN_M_L_PWM` | D5 | Motor driver L enable/PWM |
| `PIN_M_R_IN1` / `PIN_M_R_IN2` | D8 / D12 | Motor driver R direction |
| `PIN_M_R_PWM` | D6 | Motor driver R enable/PWM |
| `PIN_BATT_SENSE` | A0 | Battery via 10 kΩ:3.3 kΩ divider (optional, OFF by default) |
| D13 | - | status LED |

Servo joints (do **not** reorder - BRIDGE.md joint order):
`0 base · 1 shoulder · 2 elbow · 3 gripper`. Pin→joint map is **confirmed
(nod-count bench test, 2026-07-19)**: base=D3 · shoulder=D10 · elbow=D9 ·
gripper=D11 - swap the one `#define` if a joint is ever on a different pin
(don't reorder indices).

### Hardware cautions

- **Servo power is its own ≥5 A 5 V buck + 1000 µF cap**, common ground with the
  UNO Q, into each servo's `V+`. **Never** power servos from the UNO Q rails -
  they can't source stall current. Brownout = mystery reboots + dropped fruit.
- **Servo signal is 3.3 V** straight from the GPIO - fine for typical hobby
  servos; a servo needing a 5 V pulse would want a level shifter.
- **Gripper (idx 3)** is soft-limited to 30–120° in `config.h`
  (`JOINT_MIN/MAX_DEG[3]`) so it can't strip its gears closing on a fruit;
  re-tune on the bench before trusting it on a real prop.
- Motor "backwards"? Swap that motor's two leads (preferred) or flip the single
  `M_L_INVERT`/`M_R_INVERT` knob in `config.h` - don't scatter sign flips.
- **Battery sense is OFF by default** (`BATTERY_SENSE_ENABLED 0`): an unpopulated
  divider floats A0 and would report garbage volts, so `get_status` reports
  `battery_mv = 0` ("not sensed"). To enable, wire the divider, set the flag,
  and confirm `ADC_COUNTS`/`ADC_FULLSCALE_MV` for the UNO Q core (10- vs 12-bit).

## Build & test (no board yet)

- **Instant host syntax check** (any laptop, no toolchain): `./hostcheck.sh` -
  runs `g++ -fsyntax-only` over every source with minimal Arduino/Wire stubs.
  Catches C++ errors in the transport-agnostic core. It does **not** compile the
  `Arduino_RouterBridge` path (guarded out when the header is absent), so it
  can't validate the real Bridge glue - use the next step for that.
- **Real compile** (fw-tools' toolchain): `../tools/flash.sh --check` compiles
  for FQBN `arduino:zephyr:unoq` with the actual libraries - this is what
  validates the `bridge_rpc.cpp` MsgPack/`provide_safe` code. `flash.sh`
  (no `--check`) flashes; `../tools/monitor.sh` opens serial @115200.
- **Bench without Linux**: flash, open a 115200 serial monitor, type BRIDGE.md
  §5 commands. Boots watchdog-**disarmed** so human-paced typing isn't stuck in
  WATCHDOG; `W 1` arms it to test that path. `../tools/bench.py` scripts this;
  `../tools/mock_mcu.py` is an executable spec of the exact bench behavior.

### Bench quick reference (BRIDGE.md §5)

```
D <l> <r>                       set_drive            D 0.5 -0.5
S <j0> <j1> <j2> <j3> <ms>      move_servos          S 90 45 120 30 1000
H                               heartbeat            -> OK 0
E / C                           estop / clear_estop
Q                               get_status -> ST <state> <batt_mv> <j0..j3> <l%> <r%>
Z                               zero_all (all 90°, 1500 ms)
W <0|1>                         watchdog arm/disarm (bench only)
```

State machine (returned by every command as `OK <state>`):
`0 OK · 2 WATCHDOG · 3 ESTOP`, priority ESTOP > WATCHDOG > OK (state 1
`OBSTACLE` retired with the ultrasonic). Full semantics in `../BRIDGE.md` §2.
