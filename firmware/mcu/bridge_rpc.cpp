#include "bridge_rpc.h"

#include <Arduino.h>

#include "config.h"
#include "rpc_handlers.h"
#include "safety.h"

#if __has_include(<Arduino_RouterBridge.h>)
#include <Arduino_RouterBridge.h>
#define HAS_BRIDGE 1
#else
#define HAS_BRIDGE 0
#endif

namespace bridge_rpc {

#if HAS_BRIDGE

static int rpc_set_drive(float l, float r) { return rpc::set_drive(l, r); }

// BRIDGE.md §4 (VERIFIED) pins move_servos to 6 flat int args
// (j0..j4, duration_ms) - flat scalars marshal trivially over MsgPack-RPC;
// conceptually still joints[5]+duration_ms. fw-linux's MockBridge packs the
// same 6 scalars.
static int rpc_move_servos(int j0, int j1, int j2, int j3, int j4,
                           int duration_ms) {
  int joints[NUM_JOINTS] = {j0, j1, j2, j3, j4};
  return rpc::move_servos(joints, duration_ms);
}

static int rpc_heartbeat() { return rpc::heartbeat(); }
static int rpc_estop() { return rpc::estop(); }
static int rpc_clear_estop() { return rpc::clear_estop(); }
static int rpc_zero_all() { return rpc::zero_all(); }

// BRIDGE.md §3/§4: get_status returns a 10-element MsgPack int array, order
// [state, battery_mv, j0..j4, l_pct, r_pct, ultra_cm].
static MsgPack::arr_t<int> rpc_get_status() {
  int st[STATUS_LEN];
  rpc::get_status(st);
  MsgPack::arr_t<int> a;
  for (uint8_t i = 0; i < STATUS_LEN; i++) a.push_back(st[i]);
  return a;
}

void begin() {
  Bridge.begin();
  // provide_safe -> handler runs in the MAIN LOOP thread, so it may touch
  // drive/servo/safety state without locks (BRIDGE.md §4). estop is the one
  // exception: plain provide (separate thread) so it fires even if the
  // control loop wedges - its handler cuts motor pins + latches the e-stop
  // directly, which is safe precisely because a wedged loop isn't also
  // writing those outputs.
  Bridge.provide_safe("set_drive", rpc_set_drive);
  Bridge.provide_safe("move_servos", rpc_move_servos);
  Bridge.provide_safe("heartbeat", rpc_heartbeat);
  Bridge.provide("estop", rpc_estop);
  Bridge.provide_safe("clear_estop", rpc_clear_estop);
  Bridge.provide_safe("get_status", rpc_get_status);
  Bridge.provide_safe("zero_all", rpc_zero_all);
  // Under the Bridge transport the watchdog is ALWAYS armed (BRIDGE.md §5);
  // only the serial bench boots disarmed.
  safety::setWatchdogEnabled(true);
}

void tick() {
  // Arduino_RouterBridge services calls from its own context; nothing to
  // pump here today. Kept so the main loop shape survives a library change.
}

#else  // !HAS_BRIDGE - bench-only build on a vanilla core

void begin() {}
void tick() {}

#endif

}  // namespace bridge_rpc
