#include "drive.h"

#include "config.h"

namespace drive {

static float cmdL = 0, cmdR = 0;    // requested by RPC/bench
static float outL = 0, outR = 0;    // slew-limited, actually applied

static float clamp1(float v) {
  if (v > 1.0f) return 1.0f;
  if (v < -1.0f) return -1.0f;
  return v;
}

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

void begin() {
  pinMode(PIN_ML_IN1, OUTPUT);
  pinMode(PIN_MR_IN1, OUTPUT);
#if !DRIVE_PHASE_ENABLE
  pinMode(PIN_ML_IN2, OUTPUT);
  pinMode(PIN_MR_IN2, OUTPUT);
#endif
  pinMode(PIN_ML_PWM, OUTPUT);
  pinMode(PIN_MR_PWM, OUTPUT);
  stop();
}

void set(float l, float r) {
  cmdL = clamp1(l);
  cmdR = clamp1(r);
}

void stop() {
  cmdL = cmdR = outL = outR = 0;
  writeMotor(PIN_ML_IN1, PIN_ML_IN2, PIN_ML_PWM, 0, MOTOR_L_INVERT);
  writeMotor(PIN_MR_IN1, PIN_MR_IN2, PIN_MR_PWM, 0, MOTOR_R_INVERT);
}

static float slew(float out, float cmd) {
  float d = cmd - out;
  if (d > DRIVE_SLEW_PER_TICK) d = DRIVE_SLEW_PER_TICK;
  if (d < -DRIVE_SLEW_PER_TICK) d = -DRIVE_SLEW_PER_TICK;
  return out + d;
}

void tick() {
  outL = slew(outL, cmdL);
  outR = slew(outR, cmdR);
  writeMotor(PIN_ML_IN1, PIN_ML_IN2, PIN_ML_PWM, outL, MOTOR_L_INVERT);
  writeMotor(PIN_MR_IN1, PIN_MR_IN2, PIN_MR_PWM, outR, MOTOR_R_INVERT);
}

float commandedL() { return cmdL; }
float commandedR() { return cmdR; }

bool movingForward() { return cmdL > DRIVE_DEADBAND || cmdR > DRIVE_DEADBAND; }

}  // namespace drive
