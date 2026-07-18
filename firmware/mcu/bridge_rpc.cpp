#include "bridge_rpc.h"

#include <Arduino.h>

#include "arm.h"
#include "config.h"
#include "drive.h"
#include "safety.h"
#include "sonar.h"

// The UNO Q ships the Bridge in the Arduino_RouterBridge library (App Lab).
// Guarded so the sketch still builds bench-only on a vanilla core.
#if __has_include(<Arduino_RouterBridge.h>)
#include <Arduino_RouterBridge.h>
#define HAS_BRIDGE 1
#else
#define HAS_BRIDGE 0
#endif

namespace bridge_rpc {

#if HAS_BRIDGE

static bool rpc_set_drive(float l, float r) {
  if (!safety::motionAllowed()) return false;
  drive::set(l, r);
  return true;
}

static bool rpc_move_servos(float j0, float j1, float j2, float j3, float j4,
                            int duration_ms) {
  if (!safety::motionAllowed()) return false;
  float joints[NUM_JOINTS] = {j0, j1, j2, j3, j4};
  if (duration_ms < 0) duration_ms = 0;
  return arm::moveTo(joints, (uint32_t)duration_ms);
}

static int rpc_heartbeat() {
  safety::heartbeat();
  return (int)safety::state();
}

static bool rpc_estop() {
  safety::triggerEstop();
  drive::stop();
  arm::off();
  return true;
}

static bool rpc_clear_estop() {
  safety::clearEstop();
  arm::engage();
  return true;
}

static String rpc_get_status() {
  float pose[NUM_JOINTS];
  arm::currentPose(pose);
  String s = "state=";
  s += (int)safety::state();
  s += " drive=";
  s += drive::commandedL();
  s += ",";
  s += drive::commandedR();
  s += " arm=";
  for (uint8_t j = 0; j < NUM_JOINTS; j++) {
    s += pose[j];
    if (j < NUM_JOINTS - 1) s += ",";
  }
  s += " moving=";
  s += arm::moving() ? 1 : 0;
  s += " sonar_cm=";
  s += sonar::lastCm();
  s += " blocked=";
  s += sonar::blocked() ? 1 : 0;
  return s;
}

void begin() {
  Bridge.begin();
  Bridge.provide("set_drive", rpc_set_drive);
  Bridge.provide("move_servos", rpc_move_servos);
  Bridge.provide("heartbeat", rpc_heartbeat);
  Bridge.provide("estop", rpc_estop);
  Bridge.provide("clear_estop", rpc_clear_estop);
  Bridge.provide("get_status", rpc_get_status);
}

void tick() {
  // Arduino_RouterBridge services calls from its own context; nothing to
  // pump here today. Kept so the main loop shape survives a library change.
}

#else  // !HAS_BRIDGE — bench-only build

void begin() {}
void tick() {}

#endif

}  // namespace bridge_rpc
