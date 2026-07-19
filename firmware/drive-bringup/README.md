# drive-bringup - standalone BTS7960 drive-base test sketches

Runnable drive-base tests for the **BTS7960 / IBT-2** drivers on a **spare board**
- no Uno Q or App Lab needed. Used to validate the wiring, motors, and direction
before/without the real firmware. ** Confirmed working** (both 12 V motors spin).

Wiring + safety: see [`../DRIVE_BTS7960.md`](../DRIVE_BTS7960.md). **Do the
continuity checks and staged (battery-off-first) power-up there BEFORE running
these** - bad wiring here already cost two boards.

## Two kinds of sketch
- **`*-run`** - drives **both motors forward continuously** (gentle). For the
  battery-toggle test: power the board on USB, then flick the battery on and
  watch for movement. `esp32c3-run` is the one that first spun the motors.
- **`*-drivetest`** - runs a timed **jog sequence**: LEFT-alone -> RIGHT-alone ->
  both fwd -> both back -> spin, then stops. Good for checking each wheel + steering.

Both auto-run a few seconds after boot and accept serial keys (115200):
`s`=stop `f`=both fwd `b`=both back `l`=left only `r`=right only (`g`=re-run seq).

## Boards, pins, and how to flash
All use dual-PWM (2 PWM pins per motor); BTS7960 `R_EN`/`L_EN` tied HIGH to VCC in
hardware; `VCC` = the board's logic voltage.

| Sketch | Board | LEFT RPWM/LPWM | RIGHT RPWM/LPWM | VCC | FQBN |
|---|---|---|---|---|---|
| `esp32c3-run`, `esp32c3-drivetest` | ESP32-C3 Supermini (3.3 V) | GPIO4 / GPIO5 | GPIO6 / GPIO7 | 3V3 | `esp32:esp32:esp32c3:CDCOnBoot=cdc` |
| `uno-drivetest` | Arduino Uno (5 V) | D5 / D6 | D9 / D10 | 5V | `arduino:avr:uno` |
| `esp32-drivetest` | ESP32-WROOM DevKitC (3.3 V) | GPIO25 / GPIO26 | GPIO32 / GPIO33 | 3V3 | `esp32:esp32:esp32` |

```bash
# example (ESP32-C3):
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc esp32c3-run
arduino-cli upload  --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc -p /dev/ttyACM0 esp32c3-run
```

Direction: if a wheel spins backward, flip its `L_INVERT`/`R_INVERT` flag in the
sketch and reflash - don't rewire.
