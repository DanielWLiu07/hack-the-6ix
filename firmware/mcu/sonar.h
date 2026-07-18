// sonar.h — HC-SR04 front ultrasonic, OBSTACLE reflex input.
// Runs entirely on the MCU: obstacle < 15 cm gates forward drive in the same
// loop pass — no Linux round-trip (<10 ms). Hysteresis per BRIDGE.md §2:
// trip below SONAR_STOP_CM, clear above SONAR_CLEAR_CM.
#pragma once

#include <Arduino.h>

namespace sonar {

void begin();

// Poll at SONAR_PERIOD_MS from the main loop. Returns true on the tick the
// obstacle flag rises (for a debug print); read blocked() for the level.
bool tick();

// Hysteresis-filtered obstacle flag.
bool blocked();

// Last distance for get_status: int cm, SONAR_NO_ECHO_CM (999) if no echo.
int statusCm();

}  // namespace sonar
