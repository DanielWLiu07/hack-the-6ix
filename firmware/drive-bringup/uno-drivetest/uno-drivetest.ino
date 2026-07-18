// Arduino Uno (ATmega328P, 5V logic) — BTS7960 / IBT-2 dual-PWM drive test.
// Standalone jog test for a 2-motor drive base. No enable pins driven in code.
//
// Wiring:
//   LEFT  driver: RPWM=D5  LPWM=D6
//   RIGHT driver: RPWM=D9  LPWM=D10
//   (all four are Uno hardware-PWM pins)
//   Both drivers: R_EN & L_EN tied to +5V in hardware (always enabled, not driven by Uno)
//   Driver VCC -> +5V, GND -> common ground with Uno
//   Driver B+  -> +11.1V battery+, B- -> supply -
//   Motor -> driver M+ / M-
//
// Motors only physically move when the battery is ON. Upload with the battery
// OFF first (sequence runs, nothing spins) to confirm it works, then power up.

const int L_RPWM = 5,  L_LPWM = 6;    // LEFT motor
const int R_RPWM = 9,  R_LPWM = 10;   // RIGHT motor

const float DEADBAND = 0.05f;
const float SPEED    = 0.30f;  // gentle test speed

// Flip if a wheel spins the wrong way (no rewiring needed).
bool L_INVERT = false;
bool R_INVERT = false;

void writeMotor(int rpwm, int lpwm, float v, bool invert) {
  if (invert) v = -v;
  if (v > -DEADBAND && v < DEADBAND) v = 0;
  int duty = (int)(fabs(v) * 255.0f);
  if (duty > 255) duty = 255;
  if (v > 0)      { analogWrite(rpwm, duty); analogWrite(lpwm, 0); }
  else if (v < 0) { analogWrite(rpwm, 0);    analogWrite(lpwm, duty); }
  else            { analogWrite(rpwm, 0);    analogWrite(lpwm, 0); }
}

void drive(float l, float r) {
  writeMotor(L_RPWM, L_LPWM, l, L_INVERT);
  writeMotor(R_RPWM, R_LPWM, r, R_INVERT);
}

struct Step { const char* label; float l; float r; };
Step seq[] = {
  {"LEFT wheel FORWARD  (watch LEFT)",   SPEED,  0.0f},
  {"stop",                                0.0f,   0.0f},
  {"RIGHT wheel FORWARD (watch RIGHT)",   0.0f,   SPEED},
  {"stop",                                0.0f,   0.0f},
  {"BOTH FORWARD",                        SPEED,  SPEED},
  {"stop",                                0.0f,   0.0f},
  {"BOTH BACKWARD",                      -SPEED, -SPEED},
  {"stop",                                0.0f,   0.0f},
  {"SPIN LEFT (L back, R fwd)",          -SPEED,  SPEED},
  {"stop",                                0.0f,   0.0f},
};

void runSequence() {
  for (auto &s : seq) {
    Serial.print(">>> ");
    Serial.print(s.label);
    Serial.print("  drive(");
    Serial.print(s.l, 2);
    Serial.print(", ");
    Serial.print(s.r, 2);
    Serial.println(")");
    drive(s.l, s.r);
    delay(1500);
  }
  drive(0, 0);
  Serial.println("DONE - stopped. Send: g=sequence l/r=one wheel f/b=both s=stop");
}

void setup() {
  Serial.begin(115200);
  pinMode(L_RPWM, OUTPUT);
  pinMode(L_LPWM, OUTPUT);
  pinMode(R_RPWM, OUTPUT);
  pinMode(R_LPWM, OUTPUT);
  drive(0, 0);  // start stopped

  delay(300);
  Serial.println("\n=== Arduino Uno BTS7960 drive test ===");
  Serial.println("Motors OFF. Auto-running in 5s (send any key to hold)...");
  for (int i = 5; i > 0; i--) {
    Serial.print("  ");
    Serial.print(i);
    Serial.println("...");
    delay(1000);
    if (Serial.available()) { Serial.read(); Serial.println("held. send 'g' to run."); return; }
  }
  runSequence();
}

void loop() {
  if (!Serial.available()) return;
  switch (Serial.read()) {
    case 'g': runSequence(); break;
    case 's': drive(0, 0);            Serial.println("stop"); break;
    case 'l': drive(SPEED, 0);        Serial.println("left fwd"); break;
    case 'r': drive(0, SPEED);        Serial.println("right fwd"); break;
    case 'f': drive(SPEED, SPEED);    Serial.println("both fwd"); break;
    case 'b': drive(-SPEED, -SPEED);  Serial.println("both back"); break;
  }
}
