// mcu.ino — Arduino UNO Q STM32U585 real-time core.
//
// This core owns everything with a deadline; the Linux core owns everything
// with a model (see docs/HARDWARE.md control-split table):
//   * tank-drive PWM (slew-limited)
//   * 5-servo arm sequencing via PCA9685, ALWAYS interpolated (no snapping)
//   * ultrasonic reflex stop, <10 ms, no Linux round-trip
//   * watchdog: motion killed if the Linux heartbeat goes quiet for 500 ms
//   * serial bench console + Bridge RPC surface (see bridge_rpc.h / BRIDGE.md)
//
// Main loop is non-blocking; the only bounded block is the sonar echo
// window (~6 ms worst case).

#include "arm.h"
#include "bench.h"
#include "bridge_rpc.h"
#include "config.h"
#include "drive.h"
#include "safety.h"
#include "sonar.h"

static safety::State prevState = safety::RUN;

void setup() {
  bench::begin();
  drive::begin();
  arm::begin();
  sonar::begin();
  safety::begin();
  bridge_rpc::begin();
  pinMode(PIN_STATUS_LED, OUTPUT);
}

// Status LED: solid = RUN, fast blink = ESTOP, slow blink = watchdog stop.
static void ledTick(safety::State s) {
  uint32_t now = millis();
  bool on = true;
  if (s == safety::ESTOP) on = (now / 100) % 2;
  else if (s == safety::WATCHDOG_STOP) on = (now / 400) % 2;
  digitalWrite(PIN_STATUS_LED, on ? HIGH : LOW);
}

void loop() {
  bench::tick();
  bridge_rpc::tick();

  safety::State s = safety::tick();
  if (s != prevState) {
    if (s == safety::ESTOP) {
      drive::stop();
      arm::off();               // limp — operator hit the kill switch
      Serial.println(F("!! ESTOP"));
    } else if (s == safety::WATCHDOG_STOP) {
      drive::stop();
      arm::hold();              // keep torque — don't drop a held fruit
      Serial.println(F("!! WATCHDOG_STOP (heartbeat lost)"));
    } else {
      Serial.println(F("!! RUN"));
    }
    prevState = s;
  }

  // Reflex: obstacle ahead while driving forward -> cut drive right here.
  // Enforced every pass (not edge-triggered) so re-commanding forward while
  // still blocked is also refused; reversing away stays allowed.
  if (sonar::tick(drive::movingForward())) {
    Serial.println(F("!! SONAR_STOP"));
  }
  if (sonar::blocked() && drive::movingForward()) {
    drive::stop();
  }

  if (s == safety::RUN) {
    arm::tick();
    drive::tick();
  }

  ledTick(s);
}
