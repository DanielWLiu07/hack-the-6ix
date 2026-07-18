#include "sonar.h"

#include "config.h"

namespace sonar {

static uint32_t lastPingMs = 0;
static float distCm = -1;
static uint8_t closeCount = 0;
static bool isBlocked = false;

void begin() {
  pinMode(PIN_SONAR_TRIG, OUTPUT);
  pinMode(PIN_SONAR_ECHO, INPUT);
  digitalWrite(PIN_SONAR_TRIG, LOW);
}

static float ping() {
  digitalWrite(PIN_SONAR_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_SONAR_TRIG, LOW);
  // Blocking, but bounded by SONAR_TIMEOUT_US (~6 ms) — see config.h.
  uint32_t us = pulseIn(PIN_SONAR_ECHO, HIGH, SONAR_TIMEOUT_US);
  if (us == 0) return -1;
  return (float)us / 58.0f;  // µs -> cm (speed of sound round trip)
}

bool tick(bool gateReflex) {
  uint32_t now = millis();
  if (now - lastPingMs < SONAR_PERIOD_MS) return false;
  lastPingMs = now;

  distCm = ping();
  bool close = (distCm > 0 && distCm < SONAR_STOP_CM);
  if (close) {
    if (closeCount < 255) closeCount++;
  } else {
    closeCount = 0;
  }
  bool wasBlocked = isBlocked;
  isBlocked = (closeCount >= SONAR_TRIP_COUNT);
  return gateReflex && isBlocked && !wasBlocked;
}

float lastCm() { return distCm; }
bool blocked() { return isBlocked; }

}  // namespace sonar
