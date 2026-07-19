// ESP32-C3 Supermini - BTS7960 dual-PWM drive test (standalone).
// 3.3V logic. Validates the drive base. No App Lab.
//
// Wiring:
//   LEFT  driver: RPWM=GPIO4  LPWM=GPIO5
//   RIGHT driver: RPWM=GPIO6  LPWM=GPIO7
//   Both drivers: R_EN & L_EN tied to 3V3 (always enabled)
//   Driver VCC -> 3V3, GND -> common ground, B+ -> +11.1V, B- -> supply -
//   Motor on M+/M-.  (Avoided C3 strapping pins 2/8/9 and USB 18/19.)
//
// Flash with the battery OFF first (sequence runs, nothing spins) to confirm
// it works, then power up staged.

const int L_RPWM = 4, L_LPWM = 5;   // LEFT motor
const int R_RPWM = 6, R_LPWM = 7;   // RIGHT motor

const int   PWM_FREQ = 1000;   // Hz
const int   PWM_RES  = 8;      // bits -> duty 0..255
const float DEADBAND = 0.05f;
const float SPEED    = 0.30f;  // gentle test speed

bool L_INVERT = false;
bool R_INVERT = false;

void writeMotor(int rpwm, int lpwm, float v, bool invert) {
  if (invert) v = -v;
  if (v > -DEADBAND && v < DEADBAND) v = 0;
  int duty = (int)(fabs(v) * 255.0f);
  if (duty > 255) duty = 255;
  if (v > 0)      { ledcWrite(rpwm, duty); ledcWrite(lpwm, 0); }
  else if (v < 0) { ledcWrite(rpwm, 0);    ledcWrite(lpwm, duty); }
  else            { ledcWrite(rpwm, 0);    ledcWrite(lpwm, 0); }
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
    Serial.printf(">>> %s  drive(%.2f, %.2f)\n", s.label, s.l, s.r);
    drive(s.l, s.r);
    delay(1500);
  }
  drive(0, 0);
  Serial.println("DONE - stopped. Press RST to re-run, or send: g=sequence "
                 "l/r=one wheel f/b=both s=stop");
}

void setup() {
  Serial.begin(115200);
  ledcAttach(L_RPWM, PWM_FREQ, PWM_RES);
  ledcAttach(L_LPWM, PWM_FREQ, PWM_RES);
  ledcAttach(R_RPWM, PWM_FREQ, PWM_RES);
  ledcAttach(R_LPWM, PWM_FREQ, PWM_RES);
  drive(0, 0);

  delay(600);
  Serial.println("\n=== ESP32-C3 BTS7960 drive test ===");
  Serial.println("Motors OFF. Auto-running jog sequence in 5s (send any key to hold)...");
  for (int i = 5; i > 0; i--) {
    Serial.printf("  %d...\n", i);
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
