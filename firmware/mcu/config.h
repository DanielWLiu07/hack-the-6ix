// config.h - all pins, limits, and tuning in one place.
// Pins are TBD until firmware/tools publishes firmware/PINOUT.md; change ONLY here.
// Protocol constants (states, rates, clamps) come from firmware/BRIDGE.md -
// do not change them without a BLOCKED status entry to master.
#pragma once

#include <Arduino.h>

#define FW_VERSION "0.5"

// ---------------------------------------------------------------- drive base
// Driver mode. The rover's actual drivers are BTS7960 / IBT-2 (dual-PWM), so
// DRIVE_BTS7960 defaults ON. See firmware/DRIVE_BTS7960.md.
//   DRIVE_BTS7960 1 -> RPWM/LPWM per motor; R_EN/L_EN tied HIGH in hardware.
//   DRIVE_BTS7960 0 -> L298/TB6612 IN1/IN2 direction + EN(PWM); set
//                      DRIVE_PHASE_ENABLE 1 for PHASE/ENABLE (IN1=PHASE) drivers.
// All pins below are hardware-PWM on the Uno Q (firmware/DRIVE_BTS7960.md).
#define DRIVE_BTS7960 1
#define DRIVE_PHASE_ENABLE 0

// BTS7960 dual-PWM pins (used when DRIVE_BTS7960 == 1).
#define PIN_M_L_RPWM 5   // LEFT  forward PWM
#define PIN_M_L_LPWM 7   // LEFT  reverse PWM
#define PIN_M_R_RPWM 6   // RIGHT forward PWM
#define PIN_M_R_LPWM 8   // RIGHT reverse PWM

// L298/TB6612 pins (used when DRIVE_BTS7960 == 0).
#define PIN_M_L_IN1 4
#define PIN_M_L_IN2 7
#define PIN_M_L_PWM 5
#define PIN_M_R_IN1 8
#define PIN_M_R_IN2 12
#define PIN_M_R_PWM 6

// Flip if a motor is mounted mirrored and drives backwards. PINOUT.md prefers
// swapping the motor leads, but keep one software knob per side as a fallback.
#define M_L_INVERT 0
#define M_R_INVERT 1

// Per-side speed trim to drive straight (open-loop, for mismatched motors with
// no encoders). Multiplies each side's output; 1.00 = no trim. Tuned on the
// drive base: the right motor runs faster, so R_TRIM < 1 slows it to match.
// (~0.96 on the bench rig; re-tune on the floor for the final robot.)
#define DRIVE_L_TRIM 1.00f
#define DRIVE_R_TRIM 0.96f

// Deadband below which we output 0 (geared motors won't move anyway).
#define DRIVE_DEADBAND 0.05f
// Drive control tick and slew limit: max change in normalized output per
// tick, so full reverse->forward doesn't spike the battery rail
// (0.10 per 20 ms = full swing in ~400 ms).
#define DRIVE_TICK_MS 20
#define DRIVE_SLEW_PER_TICK 0.10f

// ------------------------------------------------------------------ arm/servos
// PCA9685 on I2C (Wire). Channels per BRIDGE.md §1: 0=base, 1=shoulder,
// 2=elbow, 3=wrist, 4=gripper. base+shoulder are the 30 kg servos.
#define PCA9685_ADDR 0x40
#define NUM_JOINTS 5

#define SERVO_PWM_FREQ_HZ 50
// Pulse range mapped to 0..180 deg. Tune per servo model on the bench.
#define SERVO_MIN_US 500
#define SERVO_MAX_US 2500

// Per-joint soft limits in degrees - protect the arm from self-collision.
// Order: base, shoulder, elbow, wrist, gripper.
static const float JOINT_MIN_DEG[NUM_JOINTS] = {0, 15, 10, 0, 30};
static const float JOINT_MAX_DEG[NUM_JOINTS] = {180, 165, 170, 180, 120};
// zero_all() target (BRIDGE.md §3): all joints 90°.
#define ZERO_ALL_DEG 90.0f
#define ZERO_ALL_MS 1500

// Servo control tick (BRIDGE.md §6: interpolation step every 20 ms).
// Poses are ALWAYS interpolated - snapping browns out the 5 V rail.
#define SERVO_TICK_MS 20
// move_servos duration_ms clamp range (BRIDGE.md §1).
#define SERVO_MIN_MOVE_MS 100
#define SERVO_MAX_MOVE_MS 5000
// Cap on joint speed regardless of requested duration (deg per tick).
#define SERVO_MAX_DEG_PER_TICK 3.0f

// ------------------------------------------------------------------ ultrasonic
// Names/pins per PINOUT.md. ECHO (D3) is 5 V on an HC-SR04 -> level-divide to
// 3.3 V before the pin (1 kΩ series + 2 kΩ to GND); skip only for a 3.3 V
// RCWL-1601. TRIG (D2) 3.3 V out is fine.
#define PIN_ULTRA_TRIG 2
#define PIN_ULTRA_ECHO 3
// BRIDGE.md §6: poll >= 20 Hz.
#define SONAR_PERIOD_MS 50
// Echo timeout bounds the blocking time of one ping to ~6 ms (≈1 m range),
// which keeps the reflex path well under the 10 ms budget.
#define SONAR_TIMEOUT_US 6000UL
// OBSTACLE hysteresis (BRIDGE.md §2): trip below 15 cm, clear above 25 cm.
#define SONAR_STOP_CM 15.0f
#define SONAR_CLEAR_CM 25.0f
// Require N consecutive close readings before tripping (noise rejection).
#define SONAR_TRIP_COUNT 2
// get_status() ultra_cm value for "no echo" (BRIDGE.md §3).
#define SONAR_NO_ECHO_CM 999

// -------------------------------------------------------------------- safety
// Kill motion if no heartbeat from the Linux core for this long (BRIDGE.md §2).
#define HEARTBEAT_TIMEOUT_MS 500UL

// --------------------------------------------------------------------- misc
#define BENCH_BAUD 115200
#define PIN_STATUS_LED LED_BUILTIN

// Battery sense (optional, PINOUT.md A0 via 10 kΩ:3.3 kΩ divider). Left OFF by
// default: with no divider populated the pin floats and would report garbage
// volts in telemetry, so get_status reports battery_mv = 0 ("not sensed",
// BRIDGE.md §1) until someone wires + calibrates it. To enable: set
// BATTERY_SENSE_ENABLED 1 and confirm ADC_FULLSCALE_MV / ADC_COUNTS for the
// UNO Q core. Divider math: Vbat * 3.3/(10+3.3) -> 12.6 V reads ~3.13 V.
#define PIN_BATT_SENSE A0
#define BATTERY_SENSE_ENABLED 0
#define ADC_FULLSCALE_MV 3300   // ADC reference in mV (verify on board)
#define ADC_COUNTS 1024         // analogRead full-scale (verify on board: 10- vs 12-bit)
#define BATT_DIVIDER_NUM 133    // (10k+3.3k)/3.3k * 33 -> scale, see README
#define BATT_DIVIDER_DEN 33
