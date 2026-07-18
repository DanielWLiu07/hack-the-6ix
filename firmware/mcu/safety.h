// safety.h — heartbeat watchdog + latched e-stop.
//
// Two distinct stop levels:
//  * WATCHDOG_STOP — no heartbeat from Linux for HEARTBEAT_TIMEOUT_MS.
//    Drive is zeroed, arm HOLDS its pose (fruit is not dropped). Auto-clears
//    when heartbeats resume.
//  * ESTOP — explicit estop() (RPC, bench, or sonar has no say here). Drive
//    zeroed, arm PWM cut. LATCHED: only clear_estop() releases it.
#pragma once

#include <Arduino.h>

namespace safety {

enum State : uint8_t {
  RUN = 0,
  WATCHDOG_STOP = 1,
  ESTOP = 2,
};

void begin();

// Feed the watchdog (called by the Bridge heartbeat RPC or bench 'h').
void heartbeat();

// Enable/disable the watchdog. Disabled by default at boot so the bench can
// exercise motors without a Linux side; the first heartbeat() arms it.
void setWatchdogEnabled(bool en);
bool watchdogEnabled();

void triggerEstop();
void clearEstop();

// Evaluate timers; returns current state. Call every loop pass.
State tick();

State state();
// True when motion commands are allowed through.
bool motionAllowed();
uint32_t msSinceHeartbeat();

}  // namespace safety
