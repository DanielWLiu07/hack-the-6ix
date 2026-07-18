// sonar.h — HC-SR04 front ultrasonic, reflex obstacle stop.
// Runs entirely on the MCU: obstacle < SONAR_STOP_CM while driving forward
// cuts the motors in the same loop pass — no Linux round-trip (<10 ms).
#pragma once

#include <Arduino.h>

namespace sonar {

void begin();

// Poll at SONAR_PERIOD_MS from the main loop. Returns true on the tick the
// reflex trips (caller stops the drive and reports).
bool tick(bool gateReflex);

// Last measured distance in cm; <0 = no echo / out of range.
float lastCm();

// True while an obstacle is within the stop threshold.
bool blocked();

}  // namespace sonar
