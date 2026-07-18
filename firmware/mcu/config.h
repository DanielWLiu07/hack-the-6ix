// config.h — all pins, limits, and tuning in one place.
// Pins are TBD until fw-tools publishes firmware/PINOUT.md; change ONLY here.
#pragma once

#include <Arduino.h>

// ---------------------------------------------------------------- drive base
// Two DC motors via L298/TB6612-style drivers: IN1/IN2 direction + EN(PWM).
// If your driver is PHASE/ENABLE style, tie IN2 defines to -1 and set
// DRIVE_PHASE_ENABLE to 1.
#define DRIVE_PHASE_ENABLE 0

#define PIN_ML_IN1 7
#define PIN_ML_IN2 8
#define PIN_ML_PWM 9
#define PIN_MR_IN1 4
#define PIN_MR_IN2 2
#define PIN_MR_PWM 10

// Flip if a motor is mounted mirrored and drives backwards.
#define MOTOR_L_INVERT 0
#define MOTOR_R_INVERT 1

// Deadband below which we output 0 (geared motors won't move anyway).
#define DRIVE_DEADBAND 0.05f
// Slew limit: max change in normalized command per control tick, so full
// reverse->forward doesn't spike the battery rail.
#define DRIVE_SLEW_PER_TICK 0.10f

// ------------------------------------------------------------------ arm/servos
// PCA9685 on I2C (Wire). Channels: 0=base yaw, 1=shoulder, 2=elbow,
// 3=wrist, 4=gripper. base+shoulder are the 30 kg servos.
#define PCA9685_ADDR 0x40
#define NUM_JOINTS 5

#define SERVO_PWM_FREQ_HZ 50
// Pulse range mapped to 0..180 deg. Tune per servo model on the bench.
#define SERVO_MIN_US 500
#define SERVO_MAX_US 2500

// Per-joint soft limits in degrees — protect the arm from self-collision.
// Order: base, shoulder, elbow, wrist, gripper.
static const float JOINT_MIN_DEG[NUM_JOINTS] = {0, 15, 10, 0, 30};
static const float JOINT_MAX_DEG[NUM_JOINTS] = {180, 165, 170, 180, 120};
// Pose at boot / after zero_all — arm tucked, gripper open.
static const float JOINT_HOME_DEG[NUM_JOINTS] = {90, 90, 90, 90, 90};

// Servo control tick. Interpolation runs at this rate — NEVER snap poses:
// a step command browns out the 5 V rail and drops the fruit.
#define SERVO_TICK_MS 20
// Fastest allowed full move; requests shorter than this are stretched.
#define SERVO_MIN_MOVE_MS 250
// Cap on joint speed regardless of requested duration (deg per tick).
#define SERVO_MAX_DEG_PER_TICK 3.0f

// ------------------------------------------------------------------ ultrasonic
#define PIN_SONAR_TRIG 11
#define PIN_SONAR_ECHO 12
#define SONAR_PERIOD_MS 60
// Echo timeout bounds the blocking time of one ping to ~6 ms (≈1 m range),
// which keeps the reflex path well under the 10 ms budget.
#define SONAR_TIMEOUT_US 6000UL
#define SONAR_STOP_CM 15.0f
// Require N consecutive close readings before tripping (noise rejection).
#define SONAR_TRIP_COUNT 2

// -------------------------------------------------------------------- safety
// Kill motion if no heartbeat from the Linux core for this long.
#define HEARTBEAT_TIMEOUT_MS 500UL

// --------------------------------------------------------------------- misc
#define BENCH_BAUD 115200
#define PIN_STATUS_LED LED_BUILTIN
#define TELEMETRY_PERIOD_MS 200
