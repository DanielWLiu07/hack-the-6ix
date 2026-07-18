// App Lab app — MCU side (STM32U585 on the UNO Q).
// Receives PICK/REJECT/SKIP decisions from the Python/MPU brain over the Arduino
// Bridge (RPC over serial) and actuates the arm/gripper + sort bin in real time.
//
// Wire the actuation to the existing drive/arm firmware (see robot/firmware and
// docs/HARDWARE.md — BTS7960 drive, servo arm). This is the template + Bridge glue.

// #include <Bridge.h>   // App Lab Bridge — verify header/lib name in App Lab

// Called by Python via Bridge RPC: Bridge.call("actuate", command, fruit, score)
void actuate(const char* command, const char* fruit, float score) {
  if (strcmp(command, "PICK") == 0) {
    // TODO: close gripper, move arm to the "good" bin
  } else if (strcmp(command, "REJECT") == 0) {
    // TODO: move arm to the "reject/compost" bin (spoiled fruit)
  } else {
    // SKIP: hold position
  }
}

void setup() {
  // Bridge.begin();
  // Bridge.provide("actuate", actuate);   // expose actuate() to the Python side (RPC)
  // TODO: init servo/motor pins per docs/HARDWARE.md
}

void loop() {
  // Bridge.update();   // service incoming RPC calls
  // real-time arm/drive control here
}
