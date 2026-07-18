# esp32c3-teleop - drive a BTS7960 base from the website via an ESP32-C3

Teleop bring-up rig used before the Uno Q was ready: the laptop bridges hub
`drive` events to an ESP32-C3 over USB serial, and the C3 drives the BTS7960s
(dual-PWM). Same web page + hub + controller as the real robot; only the last
hop differs (USB serial instead of the App Lab Bridge).

- `esp32c3-teleop.ino` - serial-driven receiver: reads "l r" (-1..1), dual-PWM
  drive with slew smoothing and a deadman watchdog. Direction flags
  `SWAP_LR`/`INV_L`/`INV_R` and per-side trim at the top.
- `drive_bridge.py` - laptop bridge: hub (role=robot) to USB serial. Auto-detects
  and auto-reconnects the port (survives unplug/replug). Needs pyserial + socketio.
- `flash.sh` - arduino-cli compile + upload helper.

Wiring/colours: see `../DRIVE_BTS7960.md` (LR purple=GPIO4, LL blue=GPIO5,
RR orange=GPIO6, RL yellow=GPIO7; enables+VCC=3V3, common GND, B+=battery).

## Run
```
./flash.sh /dev/ttyACM0        # flash the sketch
python3 drive_bridge.py        # laptop bridge (auto-detects the port)
```
Then drive from the web teleop page (or `web/public/lite-teleop.html`). One
driving page at a time - multiple emitters fight and cause stutter.
