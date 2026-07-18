// drive.h - tank drive: normalized {l,r} in [-1,1] -> PWM + direction.
#pragma once

#include <Arduino.h>

namespace drive {

void begin();

// Set the commanded speed. Values are clamped to [-1,1]. Last write wins
// (BRIDGE.md §1); the output is slew-limited in tick().
void set(float l, float r);

// Immediately zero both motors AND the pending command (stop/e-stop path).
void stop();

// OBSTACLE reflex (BRIDGE.md §2): while inhibited, forward (positive)
// components are zeroed at the output; reverse stays allowed.
void setForwardInhibit(bool inhibit);

// Run from the main loop; every DRIVE_TICK_MS applies slew + inhibit and
// writes PWM.
void tick();

// Last commanded (pre-slew) values, for get_status.
float commandedL();
float commandedR();

}  // namespace drive
