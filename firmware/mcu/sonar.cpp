#include "sonar.h"

#include "config.h"

namespace sonar {

static uint32_t lastPingMs = 0;
static float distCm = -1;  // <0 = no echo
static uint8_t closeCount = 0;
static bool isBlocked = false;

void begin() {
  pinMode(PIN_ULTRA_TRIG, OUTPUT);
  pinMode(PIN_ULTRA_ECHO, INPUT);
  digitalWrite(PIN_ULTRA_TRIG, LOW);
}

static float ping() {
  digitalWrite(PIN_ULTRA_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_ULTRA_TRIG, LOW);
  // Blocking, but bounded by SONAR_TIMEOUT_US (~6 ms) - see config.h.
  uint32_t us = pulseIn(PIN_ULTRA_ECHO, HIGH, SONAR_TIMEOUT_US);
  if (us == 0) return -1;
  return (float)us / 58.0f;  // µs -> cm (speed of sound round trip)
}

bool tick() {
  uint32_t now = millis();
  if (now - lastPingMs < SONAR_PERIOD_MS) return false;
  lastPingMs = now;

  distCm = ping();
  bool wasBlocked = isBlocked;
  if (!isBlocked) {
    // Trip: SONAR_TRIP_COUNT consecutive readings under the stop threshold
    // (single-sample noise must not halt the demo).
    bool close = (distCm > 0 && distCm < SONAR_STOP_CM);
    closeCount = close ? (uint8_t)(closeCount + 1) : 0;
    if (closeCount >= SONAR_TRIP_COUNT) isBlocked = true;
  } else {
    // Clear: hysteresis - needs distance above the clear threshold, or echo
    // lost entirely (obstacle left the ~1 m window).
    if (distCm < 0 || distCm > SONAR_CLEAR_CM) {
      isBlocked = false;
      closeCount = 0;
    }
  }
  return isBlocked && !wasBlocked;
}

bool blocked() { return isBlocked; }

int statusCm() {
  if (distCm < 0) return SONAR_NO_ECHO_CM;
  return (int)(distCm + 0.5f);
}

}  // namespace sonar
