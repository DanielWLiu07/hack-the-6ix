// servo-test.ino - UNO Q 4-servo bench tool: PARK at 90 (default) or IDENTIFY.
//
// CONFIRMED pin->joint wiring (nod-count bench test, 2026-07-19):
//   D3  -> base      (1 nod)
//   D9  -> elbow     (2 nods)
//   D10 -> shoulder  (3 nods)
//   D11 -> gripper   (4 nods)
// vs the first guess this swaps shoulder<->elbow: shoulder is on D10, elbow D9.
// Software joint order stays [base, shoulder, elbow, gripper]; only the pins
// each maps to change.
//
// RUN WITH HORNS OFF until you've confirmed 90 deg is mechanically centered.
// Power: each servo V+ from the 5-6 V >=5 A buck (NOT the UNO Q rails), common
// ground with the UNO Q. Signal is 3.3 V straight from the GPIO.

#include <Servo.h>

#define PIN_SERVO_BASE      3    // base yaw  (idx 0)
#define PIN_SERVO_SHOULDER  10   // shoulder  (idx 1)  <- D10 (confirmed)
#define PIN_SERVO_ELBOW     9    // elbow     (idx 2)  <- D9  (confirmed)
#define PIN_SERVO_GRIPPER   11   // gripper   (idx 3)

#define SERVO_MIN_US 500
#define SERVO_MAX_US 2500
#define PARK_DEG     90

// 0 = park all four at 90 deg and hold (default).
// 1 = re-run the nod identifier (idx N -> N+1 nods) to re-check wiring.
#define IDENTIFY 0

Servo base, shoulder, elbow, gripper;
Servo* joints[4]  = { &base, &shoulder, &elbow, &gripper };
const int pins[4] = { PIN_SERVO_BASE, PIN_SERVO_SHOULDER, PIN_SERVO_ELBOW, PIN_SERVO_GRIPPER };

void setup() {
  Serial.begin(115200);
  delay(200);
  for (int i = 0; i < 4; i++) {
    joints[i]->attach(pins[i], SERVO_MIN_US, SERVO_MAX_US);
    joints[i]->write(PARK_DEG);              // all to 90 deg
  }
  Serial.println("# all 4 servos parked at 90 deg");
}

#if IDENTIFY
const char* names[4] = { "base (D3)", "shoulder (D10)", "elbow (D9)", "gripper (D11)" };
void nod(Servo* s) {
  for (int a = PARK_DEG; a >= PARK_DEG - 30; a--) { s->write(a); delay(6); }
  delay(150);
  for (int a = PARK_DEG - 30; a <= PARK_DEG; a++) { s->write(a); delay(6); }
}
void loop() {
  for (int i = 0; i < 4; i++) {
    Serial.print("# now moving "); Serial.print(names[i]);
    Serial.print(" -> "); Serial.print(i + 1); Serial.println(" nod(s)");
    for (int n = 0; n <= i; n++) { nod(joints[i]); delay(350); }
    joints[i]->write(PARK_DEG);
    delay(2500);
  }
  delay(4000);
}
#else
void loop() {
  // Hold all four at 90 deg. Servos keep torque while attached; re-assert
  // periodically so a stray glitch can't leave one off-center.
  for (int i = 0; i < 4; i++) joints[i]->write(PARK_DEG);
  delay(500);
}
#endif
