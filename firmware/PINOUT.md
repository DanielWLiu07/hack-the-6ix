# PINOUT.md - UNO Q pin map (owner: fw-tools)

Proposed assignments for fw-mcu's `#define`s. Header is UNO-classic form
factor. **All MCU header GPIO is 3.3 V logic** (STM32U585) - anything 5 V
must be divided/shifted before it touches a pin. Power rails per
`docs/HARDWARE.md` power tree (servo rail is its own ≥5 A buck; common
ground everywhere).

## Pin table

| Pin | `#define` | Goes to | Notes |
|---|---|---|---|
| D3 | `PIN_SERVO_BASE` | Arm servo — base yaw (30 kg) | direct GPIO PWM (`Servo` lib), 3.3 V signal. **Pin→joint map confirmed (nod-count bench test, 2026-07-19).** |
| D9 | `PIN_SERVO_ELBOW` | Arm servo — elbow (10 kg) | direct GPIO PWM, 3.3 V signal |
| D10 | `PIN_SERVO_SHOULDER` | Arm servo — shoulder (30 kg) | direct GPIO PWM, 3.3 V signal |
| D11 | `PIN_SERVO_GRIPPER` | Arm servo — gripper (10 kg) | direct GPIO PWM; **calibrate + soft-clamp** so it can't strip gears on a fruit |
| D4 | `PIN_M_L_IN1` | Motor driver L, IN1 | direction |
| D5 | `PIN_M_L_PWM` | Motor driver L, PWM/ENA | PWM pin |
| D6 | `PIN_M_R_PWM` | Motor driver R, PWM/ENB | PWM pin |
| D7 | `PIN_M_L_IN2` | Motor driver L, IN2 | direction |
| D8 | `PIN_M_R_IN1` | Motor driver R, IN1 | direction |
| D12 | `PIN_M_R_IN2` | Motor driver R, IN2 | direction |
| A0 | `PIN_BATT_SENSE` | Battery **via divider** | optional. 10 kΩ : 3.3 kΩ (top:bottom) -> 12.6 V full-charge reads 3.13 V. If unpopulated, report `battery_mv = 0` per BRIDGE.md. |

Free for later: D0/D1 (leave free - UART), D2/D13 (D13 = LED), A1–A5.

> **Changed in the 4-servo redesign:** the arm no longer uses a PCA9685 / I2C —
> servos are driven directly from four GPIO pins (D3, D9, D10, D11). The
> HC-SR04 ultrasonic was removed, which frees **D2** (old TRIG) and **D3** (old
> ECHO, now the base servo).

## Servo pins (BRIDGE.md joint order - do not reorder the protocol)

The joint *order* (index 0–3) is fixed by BRIDGE.md; which physical pin each
joint lands on is a single `#define` you can swap after a bench check.

| Idx | Joint | `#define` (pin) | Servo | Pulse range |
|---|---|---|---|---|
| 0 | base yaw | `PIN_SERVO_BASE` (D3) | 30 kg | 500–2500 µs ≙ 0–180° |
| 1 | shoulder | `PIN_SERVO_SHOULDER` (D10) | 30 kg | 500–2500 µs |
| 2 | elbow | `PIN_SERVO_ELBOW` (D9) | 10 kg | 500–2500 µs |
| 3 | gripper | `PIN_SERVO_GRIPPER` (D11) | 10 kg | **calibrate then clamp** (`JOINT_MIN/MAX_DEG[3]`) - full range strips the gripper gears against a fruit |

The **wrist** joint was dropped in the 4-servo redesign. The pin→joint mapping
above is **confirmed (nod-count bench test, 2026-07-19)**: if a joint ever moves
on the wrong pin, swap that one `#define` - do **not** reorder the protocol
joint indices.

Start every servo at 90° (`zero_all`) before horns go on (HARDWARE.md gotcha).

## Servo power & signal gotcha

- **Signal:** each servo's control wire goes straight to its UNO Q GPIO
  (D3/D9/D10/D11). Signal is **3.3 V** - fine for typical hobby servos; a servo
  that needs a 5 V control pulse would want a level shifter.
- **Power:** servo `V+` (red) <- buck #1 **5 V ≥5 A** rail with the 1000 µF cap.
  **Never** power servos from the UNO Q's 3.3 V/5 V pins - they can't source the
  stall current and the board browns out.
- **Common ground:** servo-buck GND <-> UNO Q GND, non-negotiable.

## Motor drivers

Table assumes TB6612FNG-style (PWM + IN1 + IN2 per motor; 3.3 V logic OK -
so is L298N: V_IH min ≈ 2.3 V). If we're handed drivers with a different
interface (single PWM+DIR, or RC-style), fw-mcu only needs to remap the six
`PIN_M_*` defines - BRIDGE.md semantics don't change. Driver VM <- battery
11.1 V direct; driver GND <-> UNO Q GND (common ground, non-negotiable).

Motor polarity: define "forward" = robot moves toward the gripper side; if a
wheel spins backward on `D 0.5 0.5`, swap that motor's two leads (or its
IN1/IN2) - don't patch it in software sign-flips scattered through the code
(one `#define M_L_INVERT 0/1` max).

## Changes

This file is the single source of truth for pins. fw-mcu: consume via
`#define`s named exactly as above. Need a pin moved? Post a status entry
tagging fw-tools; don't silently diverge.
