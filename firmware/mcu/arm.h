// arm.h — 5-joint servo sequencing with smooth interpolation.
// Poses are always reached by easing from the current pose over a duration;
// there is no code path that snaps a servo (snapping browns out the 5 V rail
// and drops the fruit).
#pragma once

#include <Arduino.h>

#include "config.h"

namespace arm {

void begin();

// Start an eased move from the current pose to `joints` (degrees, joint
// order per config.h) taking `durationMs`. Duration is stretched if it would
// exceed the per-tick speed cap. Returns false if any target was clamped to
// its soft limit (move still runs, with clamped targets).
bool moveTo(const float joints[NUM_JOINTS], uint32_t durationMs);

// Jog a single joint by `deltaDeg` over a short eased move (bench/pose-recorder).
bool jog(uint8_t joint, float deltaDeg);

// Freeze in place: cancel the active move, hold current pose (watchdog stop —
// keeps holding torque so a held fruit is not dropped).
void hold();

// Hard e-stop: cancel move AND cut PWM to all servos (arm goes limp).
void off();

// Re-energize at current pose after off() (servos resume holding).
void engage();

// Call from the main loop; advances interpolation every SERVO_TICK_MS.
void tick();

bool moving();
// Current interpolated pose in degrees, for telemetry/get_status.
void currentPose(float out[NUM_JOINTS]);

}  // namespace arm
