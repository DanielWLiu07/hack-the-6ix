// arm.h — 5-joint servo sequencing with smooth interpolation.
// Poses are always reached by easing from the current pose over a duration;
// there is no code path that snaps a servo (snapping browns out the 5 V rail
// and drops the fruit). A new moveTo() preempts the active move, retargeting
// from the current interpolated pose (BRIDGE.md §1).
#pragma once

#include <Arduino.h>

#include "config.h"

namespace arm {

void begin();

// Start an eased move from the current pose to `joints` (degrees, joint
// order per config.h) taking `durationMs`. Out-of-range targets are clamped
// to the soft limits; duration is clamped to [SERVO_MIN_MOVE_MS,
// SERVO_MAX_MOVE_MS] and stretched if it would exceed the per-tick speed
// cap. Returns immediately (never blocks on motion).
void moveTo(const float joints[NUM_JOINTS], uint32_t durationMs);

// Freeze in place: cancel the active move, hold current pose with torque
// (WATCHDOG/ESTOP path — a limp arm drops the fruit and itself).
void hold();

// Call from the main loop; advances interpolation every SERVO_TICK_MS.
void tick();

bool moving();
// Current interpolated pose in degrees, for get_status.
void currentPose(float out[NUM_JOINTS]);

}  // namespace arm
