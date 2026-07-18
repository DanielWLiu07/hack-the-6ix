# firmware/tools — build/flash/bench tooling (owner: fw-tools)

## Scripts

| Script | What |
|---|---|
| `setup.sh` | Install + configure arduino-cli, board cores (UNO Q if published, else STM32duino for compile checks), PCA9685 library. Idempotent. |
| `flash.sh` | Compile + upload `firmware/mcu`. `--check` = compile only. Env: `PORT`, `ARDUINO_FQBN`, `SKETCH`. |
| `monitor.sh` | Serial monitor @ 115200 (BRIDGE.md §5). Env: `PORT`, `BAUD`. |
| `bench.py` | Python client for the serial bench protocol — interactive REPL + automated smoke test of every RPC. `python3 bench.py --help`. |
| `mock_mcu.py` | Mock MCU serving BRIDGE.md §5 on a pty — executable spec for fw-mcu, hardware-free integration target for fw-linux. `--selftest` runs bench.py against it (18/18 green). |

## UNO Q board setup notes

The UNO Q is **two computers**: a QRB2210 running Debian (Linux side) and an
STM32U585 (MCU side). How code gets on each:

1. **Normal path — Arduino App Lab.** App Lab runs against the board (USB-C,
   or on the board itself since the Linux side has a desktop). An App Lab
   "app" bundles the MCU sketch + the Linux Python; App Lab flashes the
   STM32 through the on-board bridge.
2. **Desktop toolchain WORKS for the MCU side** (verified 17 Jul): core
   `arduino:zephyr` 0.56.0, FQBN **`arduino:zephyr:unoq`**, plus libraries
   `Arduino_RouterBridge` (the Bridge RPC — see ../BRIDGE.md §4) and
   `Adafruit PWM Servo Driver Library`. `setup.sh` installs all of it;
   a scratch blink sketch compiles clean (63 KB / 768 KB flash).
3. **`flash.sh --check`** gives fw-mcu compile feedback with no board
   attached, against the real `unoq` FQBN. This repo keeps `mcu/` and
   `linux/` separate so both are testable off-board; bundling into an App
   Lab app is a copy job at the venue.
4. **First time on the real board** (whoever gets it, likely at the venue):
   - Power via USB-C (bench) — the 5V buck rail is only needed for servos.
   - Connect: `adb devices` should list the Linux side; App Lab discovers it.
   - Confirm the App Lab Bridge RPC API names (BRIDGE.md §4 caveat) from the
     bundled RPC example, post them in `status/fw-tools.md`.
   - The MCU's USB CDC serial shows up on the *Linux side*, not the laptop —
     run `bench.py` **on the board** (it's plain pyserial), or bench over
     App Lab's serial passthrough.
5. **Logic level is 3.3 V** on all MCU header pins — see `../PINOUT.md`
   (ultrasonic ECHO needs a divider).

## Serial bench quickstart

```
./monitor.sh          # then type: Q<enter>  →  ST 0 0 90 90 90 90 90 0 0 999
python3 bench.py      # scripted smoke test of all 7 RPCs
python3 bench.py -i   # interactive REPL with tab-completion-ish help
```
