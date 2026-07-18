# PINOUT.md - UNO Q pin map (owner: fw-tools)

Proposed assignments for fw-mcu's `#define`s. Header is UNO-classic form
factor. **All MCU header GPIO is 3.3 V logic** (STM32U585) - anything 5 V
must be divided/shifted before it touches a pin. Power rails per
`docs/HARDWARE.md` power tree (servo rail is its own ≥5 A buck; common
ground everywhere).

## Pin table

| Pin | `#define` | Goes to | Notes |
|---|---|---|---|
| D2 | `PIN_ULTRA_TRIG` | HC-SR04 TRIG | 3.3 V trig pulse is fine for HC-SR04 |
| D3 | `PIN_ULTRA_ECHO` | HC-SR04 ECHO **via divider** | Warning: ECHO is 5 V - 1 kΩ series + 2 kΩ to GND → 3.3 V. Skip divider only if sensor is a 3.3 V RCWL-1601. |
| D4 | `PIN_M_L_IN1` | Motor driver L, IN1 | direction |
| D5 | `PIN_M_L_PWM` | Motor driver L, PWM/ENA | PWM pin |
| D6 | `PIN_M_R_PWM` | Motor driver R, PWM/ENB | PWM pin |
| D7 | `PIN_M_L_IN2` | Motor driver L, IN2 | direction |
| D8 | `PIN_M_R_IN1` | Motor driver R, IN1 | direction |
| D12 | `PIN_M_R_IN2` | Motor driver R, IN2 | direction |
| A0 | `PIN_BATT_SENSE` | Battery **via divider** | optional. 10 kΩ : 3.3 kΩ (top:bottom) → 12.6 V full-charge reads 3.13 V. If unpopulated, report `battery_mv = 0` per BRIDGE.md. |
| SDA/SCL (or Qwiic) | - | PCA9685 | I2C addr `0x40`, 50 Hz servo frequency. UNO Q's Qwiic connector is the tidy option (already 3.3 V). |
| 5V (USB/buck #3) | - | HC-SR04 VCC | sensor logic supply, NOT the servo rail |

Free for later: D0/D1 (leave free - UART), D9/D10/D11/D13 (D13 = LED), A1–A5.

## PCA9685 channels (BRIDGE.md joint order - do not reorder)

| Ch | Joint | Servo | Pulse range |
|---|---|---|---|
| 0 | base yaw | 30 kg | 500–2500 µs ≙ 0–180° |
| 1 | shoulder | 30 kg | 500–2500 µs |
| 2 | elbow | 10 kg | 500–2500 µs |
| 3 | wrist | 10 kg | 500–2500 µs |
| 4 | gripper | 10 kg | **calibrate then clamp** in fw-mcu (`GRIP_MIN_US`/`GRIP_MAX_US`) - full 180° will strip the gripper gears against a fruit |

Start every servo at 90° (`zero_all`) before horns go on (HARDWARE.md gotcha).

## PCA9685 wiring gotcha

- `VCC` (logic) ← UNO Q 3.3 V. `V+` (servo power) ← buck #1 5 V ≥5 A rail
  with the 1000 µF cap. **Never** jumper VCC to V+.
- I2C at 3.3 V is what the PCA9685 expects here - no shifter needed.

## Motor drivers

Table assumes TB6612FNG-style (PWM + IN1 + IN2 per motor; 3.3 V logic OK -
so is L298N: V_IH min ≈ 2.3 V). If we're handed drivers with a different
interface (single PWM+DIR, or RC-style), fw-mcu only needs to remap the six
`PIN_M_*` defines - BRIDGE.md semantics don't change. Driver VM ← battery
11.1 V direct; driver GND ↔ UNO Q GND (common ground, non-negotiable).

Motor polarity: define "forward" = robot moves toward the gripper side; if a
wheel spins backward on `D 0.5 0.5`, swap that motor's two leads (or its
IN1/IN2) - don't patch it in software sign-flips scattered through the code
(one `#define M_L_INVERT 0/1` max).

## Changes

This file is the single source of truth for pins. fw-mcu: consume via
`#define`s named exactly as above. Need a pin moved? Post a status entry
tagging fw-tools; don't silently diverge.
