// rpc_handlers.h — the ONE semantic implementation of the BRIDGE.md §3
// command set. Both transports (App Lab Bridge glue in bridge_rpc.cpp and
// the serial bench parser in bench.cpp) are thin bindings over these, so
// their behavior cannot drift apart.
//
// Every handler returns the safety state int (BRIDGE.md §2) and returns
// immediately — motion is started, never awaited.
#pragma once

#include <Arduino.h>

#include "config.h"

namespace rpc {

// Number of ints in the get_status() array (BRIDGE.md §3).
#define STATUS_LEN 10

int set_drive(float l, float r);
int move_servos(const int joints[NUM_JOINTS], int duration_ms);
int heartbeat();
int estop();
int clear_estop();
int zero_all();
// Fills out[STATUS_LEN]:
// [state, battery_mv, j0..j4, drive_l_pct, drive_r_pct, ultra_cm]
void get_status(int out[STATUS_LEN]);

}  // namespace rpc
