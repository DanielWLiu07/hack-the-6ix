#include "safety.h"

#include "config.h"

namespace safety {

// Written by the estop RPC handler (Bridge separate-thread, plain provide) and
// read by tick() in the main loop - volatile for cross-thread visibility.
static volatile bool estopLatched = false;
static bool obstacle = false;
static bool wdEnabled = false;
static uint32_t lastBeatMs = 0;
static State cur = OK;

void begin() {
  estopLatched = false;
  obstacle = false;
  wdEnabled = false;
  lastBeatMs = millis();
  cur = OK;
}

void heartbeat() { lastBeatMs = millis(); }

void setWatchdogEnabled(bool en) {
  wdEnabled = en;
  if (en) lastBeatMs = millis();
}

bool watchdogEnabled() { return wdEnabled; }

void setObstacle(bool blocked) { obstacle = blocked; }

void triggerEstop() { estopLatched = true; cur = ESTOP; }

void clearEstop() {
  estopLatched = false;
  lastBeatMs = millis();  // grace period before the watchdog re-trips
}

State tick() {
  bool starved = wdEnabled && (millis() - lastBeatMs > HEARTBEAT_TIMEOUT_MS);
  if (estopLatched) cur = ESTOP;
  else if (starved) cur = WATCHDOG;
  else if (obstacle) cur = OBSTACLE;
  else cur = OK;
  return cur;
}

State state() { return cur; }

bool motionAllowed() { return cur == OK || cur == OBSTACLE; }

uint32_t msSinceHeartbeat() { return millis() - lastBeatMs; }

}  // namespace safety
