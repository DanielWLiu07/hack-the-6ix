# unoq-drivenode - Uno Q teleop drive (App Lab)

Minimal App Lab app that drives the rover from the website over the hub, running
ON the Uno Q. It bundles `firmware/mcu` as the sketch (flashes the STM32 with the
BTS7960 drive firmware) and runs a small Python node that forwards hub
`drive {l,r}` events to the MCU `set_drive` RPC. Drive-first; the arm
(`move_servos` / `arm_pose`) is a later addition to `python/main.py`.

Why an App Lab app: on the Uno Q, `arduino.app_utils.Bridge` (the MCU RPC path)
only exists inside the App Lab Python container - plain `python3` cannot import it.

## Files
- `python/main.py`   - the drive node (socketio to `Bridge.call("set_drive")`)
- `requirements.txt` - python-socketio (App Lab installs it into the container)
- `sketch.yaml`      - sketch profile + Arduino_RouterBridge library

## Deploy (on the Uno Q Linux side)
```
arduino-app-cli app new drivenode
A=~/ArduinoApps/drivenode
cp <repo>/firmware/mcu/*.cpp <repo>/firmware/mcu/*.h "$A/sketch/"
cp <repo>/firmware/mcu/mcu.ino "$A/sketch/sketch.ino"
cp <repo>/firmware/unoq-drivenode/python/main.py "$A/python/main.py"
cp <repo>/firmware/unoq-drivenode/requirements.txt "$A/requirements.txt"
cp <repo>/firmware/unoq-drivenode/sketch.yaml "$A/sketch/sketch.yaml"
arduino-app-cli app start "$A"     # compiles+flashes MCU, installs deps, runs node
arduino-app-cli app logs "$A"      # expect: connected to hub as robot
```
Set the hub address via `SERVER_URL` in `python/main.py` (or the env) to the
laptop hub, e.g. `http://<laptop-ip>:3001`. The Uno Q must reach it (same
hotspot/LAN, or Tailscale).

## Direction
Tune `SWAP_LR` / `INV_L` / `INV_R` at the top of `python/main.py` - no MCU
reflash, just restart the node. Wire it, test forward, then flip: one wheel
backward -> that side's INV; whole robot steers mirrored -> SWAP_LR.

## Verify without motors
Emit a `drive` from any ui client; the node echoes it in `telemetry.drive` and
calls `set_drive`. Battery off means no motion, but the full path is still proven.
