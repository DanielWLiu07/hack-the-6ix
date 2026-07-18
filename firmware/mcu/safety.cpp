#include "safety.h"

#include "config.h"

namespace safety {

static State cur = RUN;
static bool wdEnabled = false;
static uint32_t lastBeatMs = 0;

void begin() {
  cur = RUN;
  wdEnabled = false;
  lastBeatMs = millis();
}

void heartbeat() {
  lastBeatMs = millis();
  // First heartbeat from Linux arms the watchdog automatically.
  wdEnabled = true;
}

void setWatchdogEnabled(bool en) {
  wdEnabled = en;
  if (en) lastBeatMs = millis();
}

bool watchdogEnabled() { return wdEnabled; }

void triggerEstop() { cur = ESTOP; }

void clearEstop() {
  if (cur == ESTOP) {
    cur = RUN;
    lastBeatMs = millis();  // grace period before the watchdog re-trips
  }
}

State tick() {
  if (cur == ESTOP) return cur;  // latched — timers don't matter
  bool starved = wdEnabled && (millis() - lastBeatMs > HEARTBEAT_TIMEOUT_MS);
  cur = starved ? WATCHDOG_STOP : RUN;
  return cur;
}

State state() { return cur; }
bool motionAllowed() { return cur == RUN; }
uint32_t msSinceHeartbeat() { return millis() - lastBeatMs; }

}  // namespace safety
