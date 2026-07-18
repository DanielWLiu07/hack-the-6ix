// drive.h — tank drive: normalized {l,r} in [-1,1] -> PWM + direction.
#pragma once

#include <Arduino.h>

namespace drive {

void begin();

// Set the commanded speed. Values are clamped to [-1,1]. The command is
// slew-limited in tick(), so this is safe to call at any rate.
void set(float l, float r);

// Immediately zero both motors AND the pending command (reflex/e-stop path).
void stop();

// Run from the main loop; applies slew limiting and writes PWM.
void tick();

// Last commanded (pre-slew) values, for telemetry.
float commandedL();
float commandedR();

// True if the current command tries to move the base forward (used to gate
// the ultrasonic reflex — reversing away from an obstacle must stay allowed).
bool movingForward();

}  // namespace drive
