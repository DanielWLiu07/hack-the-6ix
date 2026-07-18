#include "rpc_handlers.h"

#include "arm.h"
#include "drive.h"
#include "safety.h"
#include "sonar.h"

namespace rpc {

int set_drive(float l, float r) {
  // Accepted in OK and OBSTACLE (forward components are zeroed at the drive
  // output while blocked); ignored in WATCHDOG/ESTOP.
  if (safety::motionAllowed()) drive::set(l, r);
  return (int)safety::state();
}

int move_servos(const int joints[NUM_JOINTS], int duration_ms) {
  if (safety::motionAllowed()) {
    float j[NUM_JOINTS];
    for (uint8_t i = 0; i < NUM_JOINTS; i++) j[i] = (float)joints[i];
    if (duration_ms < 0) duration_ms = 0;
    arm::moveTo(j, (uint32_t)duration_ms);
  }
  return (int)safety::state();
}

int heartbeat() {
  safety::heartbeat();
  return (int)safety::tick();  // recompute so WATCHDOG clears on this call
}

int estop() {
  safety::triggerEstop();
  drive::stop();
  arm::hold();  // freeze with torque - never limp (BRIDGE.md §2)
  return (int)safety::state();
}

int clear_estop() {
  safety::clearEstop();
  return (int)safety::tick();  // whatever lower state now applies
}

int zero_all() {
  if (safety::motionAllowed()) {
    float j[NUM_JOINTS];
    for (uint8_t i = 0; i < NUM_JOINTS; i++) j[i] = ZERO_ALL_DEG;
    arm::moveTo(j, ZERO_ALL_MS);
  }
  return (int)safety::state();
}

static int batteryMv() {
#if BATTERY_SENSE_ENABLED
  // A0 through the PINOUT.md 10 kΩ:3.3 kΩ divider. Reconstruct pack mV:
  //   Vadc_mv = raw / ADC_COUNTS * ADC_FULLSCALE_MV
  //   Vbat_mv = Vadc_mv * (R_top+R_bot)/R_bot   [= BATT_DIVIDER_NUM/DEN]
  long raw = analogRead(PIN_BATT_SENSE);
  long adcMv = raw * (long)ADC_FULLSCALE_MV / (long)ADC_COUNTS;
  return (int)(adcMv * (long)BATT_DIVIDER_NUM / (long)BATT_DIVIDER_DEN);
#else
  return 0;  // 0 = not sensed (BRIDGE.md §1)
#endif
}

void get_status(int out[STATUS_LEN]) {
  float pose[NUM_JOINTS];
  arm::currentPose(pose);
  out[0] = (int)safety::state();
  out[1] = batteryMv();
  for (uint8_t j = 0; j < NUM_JOINTS; j++) out[2 + j] = (int)(pose[j] + 0.5f);
  out[7] = (int)(drive::commandedL() * 100.0f);
  out[8] = (int)(drive::commandedR() * 100.0f);
  out[9] = sonar::statusCm();
}

}  // namespace rpc
