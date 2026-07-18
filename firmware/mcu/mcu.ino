// mcu.ino — Arduino UNO Q STM32U585 real-time core.
//
// This core owns everything with a deadline; the Linux core owns everything
// with a model (see docs/HARDWARE.md control-split table):
//   * tank-drive PWM (slew-limited)
//   * 5-servo arm sequencing via PCA9685, ALWAYS interpolated (no snapping)
//   * ultrasonic OBSTACLE reflex, <10 ms, no Linux round-trip
//   * watchdog: motion killed if the Linux heartbeat goes quiet for 500 ms
//   * BRIDGE.md command set over two transports: App Lab Bridge RPC
//     (bridge_rpc.*) and the serial bench console (bench.*), both bound to
//     the same rpc_handlers.*
//
// Main loop is non-blocking; the only bounded block is the sonar echo
// window (~6 ms worst case).

#include "arm.h"
#include "bench.h"
#include "bridge_rpc.h"
#include "config.h"
#include "drive.h"
#include "rpc_handlers.h"
#include "safety.h"
#include "sonar.h"

static safety::State prevState = safety::OK;

void setup() {
  bench::begin();
  drive::begin();
  arm::begin();
  sonar::begin();
  safety::begin();     // watchdog disarmed until Bridge begin() or bench W 1
  bridge_rpc::begin();
  pinMode(PIN_STATUS_LED, OUTPUT);
}

// Status LED: solid = OK, slow blink = OBSTACLE/WATCHDOG, fast blink = ESTOP.
static void ledTick(safety::State s) {
  uint32_t now = millis();
  bool on = true;
  if (s == safety::ESTOP) on = (now / 100) % 2;
  else if (s != safety::OK) on = (now / 400) % 2;
  digitalWrite(PIN_STATUS_LED, on ? HIGH : LOW);
}

void loop() {
  bench::tick();
  bridge_rpc::tick();

  // Reflex input: hysteresis-filtered obstacle flag gates forward drive in
  // this same pass — no Linux round-trip.
  sonar::tick();
  safety::setObstacle(sonar::blocked());
  drive::setForwardInhibit(sonar::blocked());

  safety::State s = safety::tick();
  if (s != prevState) {
    // Entering a motion-blocking state freezes everything ONCE; commands are
    // refused (state returned) until it clears. Servos hold with torque —
    // a limp arm drops the fruit and itself.
    if (s == safety::ESTOP || s == safety::WATCHDOG) {
      drive::stop();
      arm::hold();
    }
    switch (s) {  // '#' lines are ignored by bench hosts (BRIDGE.md §5)
      case safety::OK: bench::debug("state OK"); break;
      case safety::OBSTACLE: bench::debug("state OBSTACLE"); break;
      case safety::WATCHDOG: bench::debug("state WATCHDOG"); break;
      case safety::ESTOP: bench::debug("state ESTOP"); break;
    }
    prevState = s;
  }

  // Safe to tick unconditionally: in WATCHDOG/ESTOP the command paths above
  // have zeroed drive and cancelled the arm move, and new commands are
  // refused at the rpc_handlers layer.
  arm::tick();
  drive::tick();

  ledTick(s);
}
