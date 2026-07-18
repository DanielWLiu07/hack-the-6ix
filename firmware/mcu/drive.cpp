#include "drive.h"

#include "config.h"

namespace drive {

static float cmdL = 0, cmdR = 0;    // requested by RPC/bench
static float outL = 0, outR = 0;    // slew-limited, actually applied
static bool fwdInhibit = false;
static uint32_t lastTickMs = 0;

static float clamp1(float v) {
  if (v > 1.0f) return 1.0f;
  if (v < -1.0f) return -1.0f;
  return v;
}

#if DRIVE_BTS7960
// BTS7960 / IBT-2 dual-PWM. R_EN/L_EN tied HIGH in hardware; direction = which
// of RPWM/LPWM carries the PWM. forward -> RPWM=|v|, LPWM=0; reverse -> RPWM=0,
// LPWM=|v|; stop -> both 0. See firmware/DRIVE_BTS7960.md.
static void writeMotor(int pinRpwm, int pinLpwm, float v, bool invert) {
  if (invert) v = -v;
  if (v > -DRIVE_DEADBAND && v < DRIVE_DEADBAND) v = 0;
  int pwm = (int)(fabsf(v) * 255.0f);
  if (pwm > 255) pwm = 255;
  if (v > 0) {
    analogWrite(pinRpwm, pwm);
    analogWrite(pinLpwm, 0);
  } else if (v < 0) {
    analogWrite(pinRpwm, 0);
    analogWrite(pinLpwm, pwm);
  } else {
    analogWrite(pinRpwm, 0);
    analogWrite(pinLpwm, 0);
  }
}
#define DRIVE_L_PINS PIN_M_L_RPWM, PIN_M_L_LPWM
#define DRIVE_R_PINS PIN_M_R_RPWM, PIN_M_R_LPWM
#else
// L298/TB6612: IN1/IN2 direction + EN(PWM). PHASE/ENABLE via DRIVE_PHASE_ENABLE.
static void writeMotor(int pinIn1, int pinIn2, int pinPwm, float v, bool invert) {
  if (invert) v = -v;
  if (v > -DRIVE_DEADBAND && v < DRIVE_DEADBAND) v = 0;
  int pwm = (int)(fabsf(v) * 255.0f);
  if (pwm > 255) pwm = 255;
#if DRIVE_PHASE_ENABLE
  digitalWrite(pinIn1, v >= 0 ? HIGH : LOW);  // PHASE
  (void)pinIn2;
#else
  digitalWrite(pinIn1, v > 0 ? HIGH : LOW);
  digitalWrite(pinIn2, v < 0 ? HIGH : LOW);   // both LOW = coast at v==0
#endif
  analogWrite(pinPwm, pwm);
}
#define DRIVE_L_PINS PIN_M_L_IN1, PIN_M_L_IN2, PIN_M_L_PWM
#define DRIVE_R_PINS PIN_M_R_IN1, PIN_M_R_IN2, PIN_M_R_PWM
#endif

void begin() {
#if DRIVE_BTS7960
  pinMode(PIN_M_L_RPWM, OUTPUT);
  pinMode(PIN_M_L_LPWM, OUTPUT);
  pinMode(PIN_M_R_RPWM, OUTPUT);
  pinMode(PIN_M_R_LPWM, OUTPUT);
#else
  pinMode(PIN_M_L_IN1, OUTPUT);
  pinMode(PIN_M_R_IN1, OUTPUT);
#if !DRIVE_PHASE_ENABLE
  pinMode(PIN_M_L_IN2, OUTPUT);
  pinMode(PIN_M_R_IN2, OUTPUT);
#endif
  pinMode(PIN_M_L_PWM, OUTPUT);
  pinMode(PIN_M_R_PWM, OUTPUT);
#endif
  stop();
}

void set(float l, float r) {
  cmdL = clamp1(l);
  cmdR = clamp1(r);
}

void stop() {
  cmdL = cmdR = outL = outR = 0;
  writeMotor(DRIVE_L_PINS, 0, M_L_INVERT);
  writeMotor(DRIVE_R_PINS, 0, M_R_INVERT);
}

void setForwardInhibit(bool inhibit) { fwdInhibit = inhibit; }

static float slew(float out, float cmd) {
  float d = cmd - out;
  if (d > DRIVE_SLEW_PER_TICK) d = DRIVE_SLEW_PER_TICK;
  if (d < -DRIVE_SLEW_PER_TICK) d = -DRIVE_SLEW_PER_TICK;
  return out + d;
}

void tick() {
  uint32_t now = millis();
  if (now - lastTickMs < DRIVE_TICK_MS) return;
  lastTickMs = now;
  float tl = cmdL, tr = cmdR;
  if (fwdInhibit) {
    if (tl > 0) tl = 0;
    if (tr > 0) tr = 0;
  }
  outL = slew(outL, tl);
  outR = slew(outR, tr);
  writeMotor(DRIVE_L_PINS, outL, M_L_INVERT);
  writeMotor(DRIVE_R_PINS, outR, M_R_INVERT);
}

float commandedL() { return cmdL; }
float commandedR() { return cmdR; }

}  // namespace drive
