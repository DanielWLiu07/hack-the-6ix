# Hardware Reference

## Parts list

### Compute
- **Arduino UNO Q** (Qualcomm sponsor table) - QRB2210 Linux MPU + STM32U585 MCU
- **Raspberry Pi** - lidar host + map streaming
- Camera module (UNO Q-compatible USB/CSI preferred so inference stays on the Q; pi-cam fallback)

### Arm (5-DOF)
- 2× 30 kg servos (base yaw, shoulder)
- 3× 10 kg servos (elbow, wrist, gripper)
- 5× aluminum servo horns, flanged couplings, bearings
- PCA9685-style servo driver
- Silicone gripper pads
- PLA prints: arm segments, gripper fingers, base turret mount

### Drive base
- 2× geared DC motors + 2× motor drivers
- 2× caster wheels
- 360° lidar
- (maybe) ultrasonic sensors → front bumper e-stop

### Power
- 11.1 V 3S LiPo
- Buck converters (see power tree)

## Power tree (do this right or lose hours to brownouts)

```
11.1V 3S LiPo ──┬── Motor drivers (VIN direct) ── 2× geared motors
                ├── Buck #1 → 5V ≥5A  ── SERVO RAIL ONLY (+1000µF cap at rail)
                ├── Buck #2 → 5V 3A   ── Raspberry Pi + lidar
                └── Buck #3 → 5V 3A   ── Arduino UNO Q + camera
COMMON GROUND across everything. Fuse on battery lead if available.
```

- 30 kg servos stall at 3–5 A **each**. Two moving together will kill a shared rail - this is why the servo rail is isolated.
- Brown-out symptom: Pi/UNO Q reboots when arm lifts. If seen → check servo rail sag with multimeter first.
- E-stop: physical battery disconnect (XT60 pull) within reach at all times. LiPo safety: never charge unattended, fireproof bag.

## Control split (Qualcomm track requirement - keep this clean)

| UNO Q Linux (intelligence) | UNO Q MCU (real-time) |
|---|---|
| Camera capture + YOLO ripeness inference (on-device, quantized) | Drive motor PWM + direction |
| IK solve → target joint angles | Servo sequencing @ fixed control rate (via I2C to PCA9685) |
| Pick-task state machine | Ultrasonic poll + reflex e-stop (<10 ms) |
| Telemetry/WebSocket to server | Hardware watchdog: stop all motion if Linux heartbeat lost >500 ms |
| FarmHand LLM command intake | |

Bridge: Arduino App Lab RPC between the two cores. **Demo this table as a slide** - it is literally the Qualcomm judging criteria.

## Raspberry Pi (lidar node)

- Lidar over USB serial → Python reader → downsample → WebSocket to server (`scan` events, polar → cartesian on client)
- No ROS unless Foxglove becomes cheap; Three.js point cloud is the deliverable

## Assembly gotchas

- Loctite/nylock on servo horn screws - vibration undoes them by hour 20
- Zero all servos BEFORE attaching horns (write a `zero_all.py`)
- Mount arm base turret over drive-base center of mass; counterweight battery at rear
- Cable-manage with zip ties early; dangling wires + spinning wheels = severed telemetry mid-demo
