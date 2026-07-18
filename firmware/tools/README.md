# firmware/tools — build/flash/bench tooling (owner: fw-tools)

## Scripts

| Script | What |
|---|---|
| `setup.sh` | Install + configure arduino-cli, board cores (UNO Q if published, else STM32duino for compile checks), PCA9685 library. Idempotent. |
| `flash.sh` | Compile + upload `firmware/mcu`. `--check` = compile only. Env: `PORT`, `ARDUINO_FQBN`, `SKETCH`. |
| `monitor.sh` | Serial monitor @ 115200 (BRIDGE.md §5). Env: `PORT`, `BAUD`. |
| `bench.py` | Python client for the serial bench protocol — interactive REPL + automated smoke test of every RPC. `python3 bench.py --help`. |

## UNO Q board setup notes

The UNO Q is **two computers**: a QRB2210 running Debian (Linux side) and an
STM32U585 (MCU side). How code gets on each:

1. **Normal path — Arduino App Lab.** App Lab runs against the board (USB-C,
   or on the board itself since the Linux side has a desktop). An App Lab
   "app" bundles the MCU sketch + the Linux Python; App Lab flashes the
   STM32 through the on-board bridge — desktop arduino-cli is *not* the
   primary flasher for this board.
2. **This repo's layout still keeps them separate** (`mcu/` sketch,
   `linux/` Python) so both are testable off-board; wiring them into an App
   Lab app is a copy/symlink job we do at the venue.
3. **`flash.sh --check`** exists so fw-mcu gets compile feedback on the
   laptop with no board attached (generic STM32U585 target — same Cortex-M33
   family; App-Lab-specific headers like the Bridge may need a `#ifdef`
   guard, that's fine, guard them with `#if __has_include(...)`).
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
