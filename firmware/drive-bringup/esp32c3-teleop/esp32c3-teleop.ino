// ESP32-C3 teleop receiver: reads "l r" (-1..1 tank) over USB serial and drives
// the BTS7960 base with dual-PWM. Smoothed with a slew ramp so uneven command
// timing doesn't make the motors stutter. Deadman watchdog stops the motors if
// no command arrives for CMD_TIMEOUT_MS.
//
// Wire colours (firmware/DRIVE_BTS7960.md):
//   L RPWM purple = GPIO4   L LPWM blue = GPIO5
//   R RPWM orange = GPIO6   R LPWM yellow = GPIO7
// enables + VCC -> 3V3, common GND, B+ = 11.1V battery.
//
// Serial (115200): one line per command, "<l> <r>\n" e.g. "0.5 0.5". "s"/"0" = stop.

const int L_RPWM = 4, L_LPWM = 5, R_RPWM = 6, R_LPWM = 7;
const int PWM_FREQ = 1000, PWM_RES = 8;
const float DEADBAND = 0.05f;
const float L_TRIM = 1.00f, R_TRIM = 0.96f;      // straight-line trim (right motor faster)

// --- direction (set to match how the body is mounted) ----------------------
// Body mounted the other way -> forward/back is reversed: INV_L = INV_R = 1.
// If turning is ALSO mirrored (full 180 deg flip), additionally set SWAP_LR = 1.
// If just one wheel spins the wrong way, invert only that side.
#define SWAP_LR 1
#define INV_L   1
#define INV_R   1

// --- smoothing / safety ----------------------------------------------------
// Watchdog is generous on purpose: releasing a key/button sends an explicit
// "0 0", so this only needs to catch a real comms loss (page/bridge died). A
// long timeout means brief command gaps (browser/network jitter) DON'T stop the
// motors, which is what caused the stutter.
const unsigned long CMD_TIMEOUT_MS = 1500;
const float SLEW = 0.08f;                   // max output change per 5 ms tick
#define DEBUG 1                             // print rx rate once/sec for tuning

float cmdL = 0, cmdR = 0;      // latest requested
float outL = 0, outR = 0;      // slew-limited, actually applied
unsigned long lastCmdMs = 0;
unsigned long rxCount = 0, lastDbgMs = 0;
String buf;

void writeMotor(int rp, int lp, float v) {
  if (v > -DEADBAND && v < DEADBAND) v = 0;
  int d = (int)(fabs(v) * 255.0f); if (d > 255) d = 255;
  if (v > 0)      { ledcWrite(rp, d); ledcWrite(lp, 0); }
  else if (v < 0) { ledcWrite(rp, 0); ledcWrite(lp, d); }
  else            { ledcWrite(rp, 0); ledcWrite(lp, 0); }
}

// apply mounting direction + per-side trim, then drive the two BTS7960s
void drive(float l, float r) {
#if SWAP_LR
  float t = l; l = r; r = t;
#endif
#if INV_L
  l = -l;
#endif
#if INV_R
  r = -r;
#endif
  writeMotor(L_RPWM, L_LPWM, l * L_TRIM);
  writeMotor(R_RPWM, R_LPWM, r * R_TRIM);
}

void handleLine(String s) {
  s.trim();
  if (s.length() == 0) return;
  if (s == "s" || s == "0") { cmdL = cmdR = 0; lastCmdMs = millis(); return; }
  int sp = s.indexOf(' ');
  if (sp < 0) sp = s.indexOf(',');
  if (sp < 0) return;
  cmdL = s.substring(0, sp).toFloat();
  cmdR = s.substring(sp + 1).toFloat();
  if (cmdL > 1) cmdL = 1; if (cmdL < -1) cmdL = -1;
  if (cmdR > 1) cmdR = 1; if (cmdR < -1) cmdR = -1;
  lastCmdMs = millis();
  rxCount++;
}

void setup() {
  Serial.begin(115200);
  ledcAttach(L_RPWM, PWM_FREQ, PWM_RES); ledcAttach(L_LPWM, PWM_FREQ, PWM_RES);
  ledcAttach(R_RPWM, PWM_FREQ, PWM_RES); ledcAttach(R_LPWM, PWM_FREQ, PWM_RES);
  drive(0, 0);
  Serial.println("# esp32c3 teleop ready (slew+watchdog). send: <l> <r>  (-1..1)");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { handleLine(buf); buf = ""; }
    else buf += c;
  }
  // target = command, or 0 if the deadman watchdog has expired
  float tl = cmdL, tr = cmdR;
  if (millis() - lastCmdMs > CMD_TIMEOUT_MS) { tl = 0; tr = 0; }
  // slew-limit toward the target so timing jitter ramps instead of jerking
  outL += constrain(tl - outL, -SLEW, SLEW);
  outR += constrain(tr - outR, -SLEW, SLEW);
  drive(outL, outR);
#if DEBUG
  if (millis() - lastDbgMs >= 1000) {
    unsigned long gap = millis() - lastCmdMs;
    Serial.printf("# rx=%lu/s cmd=%.2f,%.2f out=%.2f,%.2f gap=%lums%s\n",
                  rxCount, cmdL, cmdR, outL, outR, gap, gap > CMD_TIMEOUT_MS ? " WATCHDOG" : "");
    rxCount = 0; lastDbgMs = millis();
  }
#endif
  delay(5);
}
