# firmware/mcu - UNO Q STM32U585 real-time core

The Arduino sketch that owns everything with a hard deadline. The QRB2210
Linux core (`firmware/linux/`) owns everything with a model and talks to this
core over the App Lab Bridge RPC defined in `../BRIDGE.md`. Keep that boundary
clean - it's a Qualcomm-track judging criterion.

## What this core does

- **Tank drive** - `set_drive(l,r)` normalized [-1,1] -> PWM + direction, with a
  slew limiter (no rail-spiking step changes) and a deadband.
- **5-servo arm** via PCA9685 over I2C - `move_servos(joints[5], ms)` starts an
  **always-interpolated** (smoothstep-eased) move; poses never snap (snapping
  browns out the 5 V rail and drops fruit). Per-joint soft limits + a speed cap.
- **Ultrasonic OBSTACLE reflex** - polled ≥20 Hz, trips forward-drive inhibit in
  <10 ms with no Linux round-trip; hysteresis (stop <15 cm, clear >25 cm).
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
| `safety.*` | BRIDGE.md §2 state machine: OK / OBSTACLE / WATCHDOG / ESTOP |
| `drive.*` | tank-drive PWM + slew + forward-inhibit |
| `arm.*` | interpolated 5-servo pose engine |
| `sonar.*` | HC-SR04 poll + hysteresis obstacle flag |
| `pca9685.*` | minimal PCA9685 driver (no external lib dependency) |
| `hostcheck.sh` | host-side `g++ -fsyntax-only` over every file with Arduino stubs |

## Wiring (authoritative pin map: `../PINOUT.md`)

`config.h` mirrors `../PINOUT.md` - **that doc is the source of truth for pins;
change pins there and here, not silently.** All UNO Q header GPIO is **3.3 V**
(STM32U585). Current assignment:

| `#define` | Pin | Goes to |
|---|---|---|
| `PIN_ULTRA_TRIG` | D2 | HC-SR04 TRIG (3.3 V pulse OK) |
| `PIN_ULTRA_ECHO` | D3 | HC-SR04 ECHO **via 1 kΩ+2 kΩ divider** (ECHO is 5 V!) |
| `PIN_M_L_IN1` / `PIN_M_L_IN2` | D4 / D7 | Motor driver L direction |
| `PIN_M_L_PWM` | D5 | Motor driver L enable/PWM |
| `PIN_M_R_IN1` / `PIN_M_R_IN2` | D8 / D12 | Motor driver R direction |
| `PIN_M_R_PWM` | D6 | Motor driver R enable/PWM |
| `PIN_BATT_SENSE` | A0 | Battery via 10 kΩ:3.3 kΩ divider (optional, OFF by default) |
| SDA/SCL (Qwiic) | - | PCA9685 @ `0x40`, 50 Hz |
| D13 | - | status LED |

PCA9685 channels (do **not** reorder - BRIDGE.md joint order):
`0 base · 1 shoulder · 2 elbow · 3 wrist · 4 gripper`.

### Hardware cautions

- **Servo power is its own ≥5 A 5 V buck + 1000 µF cap**, common ground with the
  UNO Q. PCA9685 `VCC`(logic)<-3.3 V, `V+`(servo)<-buck; **never jumper them**.
  Brownout = mystery reboots + dropped fruit.
- **HC-SR04 ECHO must be level-divided** to 3.3 V before D3 (skip only for a
  3.3 V RCWL-1601). TRIG at 3.3 V is fine.
- **Gripper (ch 4)** is soft-limited to 30–120° in `config.h`
  (`JOINT_MIN/MAX_DEG[4]`) so it can't strip its gears closing on a fruit;
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
S <j0> <j1> <j2> <j3> <j4> <ms> move_servos          S 90 45 120 90 30 1000
H                               heartbeat            -> OK 0
E / C                           estop / clear_estop
Q                               get_status -> ST <state> <batt_mv> <j0..j4> <l%> <r%> <cm>
Z                               zero_all (all 90°, 1500 ms)
W <0|1>                         watchdog arm/disarm (bench only)
```

State machine (returned by every command as `OK <state>`):
`0 OK · 1 OBSTACLE · 2 WATCHDOG · 3 ESTOP`, priority ESTOP > WATCHDOG >
OBSTACLE > OK. Full semantics in `../BRIDGE.md` §2.
