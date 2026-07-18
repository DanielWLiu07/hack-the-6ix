// safety.h — BRIDGE.md §2 safety state machine.
//
// One composite state, priority ESTOP > WATCHDOG > OBSTACLE > OK; the
// underlying flags stay individually tracked so get_status() can report a
// pending obstacle even while e-stopped.
//
//  0 OK        normal
//  1 OBSTACLE  ultrasonic < 15 cm; forward drive zeroed, arm unaffected.
//              Auto-clears above 25 cm (hysteresis, owned by sonar module).
//  2 WATCHDOG  no heartbeat for 500 ms; drive -> 0, servos HOLD pose.
//              Auto-clears on next heartbeat.
//  3 ESTOP     estop() received; drive -> 0, interpolation frozen. LATCHED —
//              only clear_estop() exits.
#pragma once

#include <Arduino.h>

namespace safety {

enum State : uint8_t {
  OK = 0,
  OBSTACLE = 1,
  WATCHDOG = 2,
  ESTOP = 3,
};

void begin();

// Feed the watchdog timer. Does NOT arm it — arming is transport-specific
// (BRIDGE.md §5): App Lab Bridge arms at begin(), bench arms only via 'W 1'.
void heartbeat();

void setWatchdogEnabled(bool en);
bool watchdogEnabled();

// Sonar module reports its hysteresis-filtered obstacle flag here each poll.
void setObstacle(bool blocked);

void triggerEstop();
void clearEstop();

// Recompute and return the composite state. Call every loop pass.
State tick();
State state();

// True when drive/arm motion commands are accepted (OK or OBSTACLE).
bool motionAllowed();
uint32_t msSinceHeartbeat();

}  // namespace safety
