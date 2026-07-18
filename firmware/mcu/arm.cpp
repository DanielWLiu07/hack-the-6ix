#include "arm.h"

#include "pca9685.h"

namespace arm {

static float cur[NUM_JOINTS];    // interpolated pose being output right now
static float from[NUM_JOINTS];   // pose at move start
static float target[NUM_JOINTS];
static uint32_t moveStartMs = 0;
static uint32_t moveDurMs = 0;
static bool active = false;      // a move is in progress
static uint32_t lastTickMs = 0;

static float clampJoint(uint8_t j, float deg) {
  if (deg < JOINT_MIN_DEG[j]) return JOINT_MIN_DEG[j];
  if (deg > JOINT_MAX_DEG[j]) return JOINT_MAX_DEG[j];
  return deg;
}

static uint16_t degToMicros(float deg) {
  if (deg < 0) deg = 0;
  if (deg > 180) deg = 180;
  return (uint16_t)(SERVO_MIN_US + (SERVO_MAX_US - SERVO_MIN_US) * (deg / 180.0f));
}

static void writePose() {
  for (uint8_t j = 0; j < NUM_JOINTS; j++) {
    pca9685::writeMicros(j, degToMicros(cur[j]));
  }
}

// Smoothstep easing: zero velocity at both ends, so heavy joints accelerate
// gently instead of yanking current from the rail.
static float ease(float t) { return t * t * (3.0f - 2.0f * t); }

void begin() {
  pca9685::begin(PCA9685_ADDR, SERVO_PWM_FREQ_HZ);
  for (uint8_t j = 0; j < NUM_JOINTS; j++) {
    cur[j] = from[j] = target[j] = ZERO_ALL_DEG;
  }
  writePose();
}

void moveTo(const float joints[NUM_JOINTS], uint32_t durationMs) {
  float maxDelta = 0;
  for (uint8_t j = 0; j < NUM_JOINTS; j++) {
    from[j] = cur[j];
    target[j] = clampJoint(j, joints[j]);
    float d = fabsf(target[j] - from[j]);
    if (d > maxDelta) maxDelta = d;
  }
  if (durationMs < SERVO_MIN_MOVE_MS) durationMs = SERVO_MIN_MOVE_MS;
  if (durationMs > SERVO_MAX_MOVE_MS) durationMs = SERVO_MAX_MOVE_MS;
  // Stretch duration so no joint exceeds the speed cap.
  uint32_t minDur = (uint32_t)((maxDelta / SERVO_MAX_DEG_PER_TICK) * SERVO_TICK_MS);
  if (durationMs < minDur) durationMs = minDur;
  moveStartMs = millis();
  moveDurMs = durationMs;
  active = true;
}

void hold() {
  active = false;
  for (uint8_t j = 0; j < NUM_JOINTS; j++) target[j] = cur[j];
}

void tick() {
  uint32_t now = millis();
  if (now - lastTickMs < SERVO_TICK_MS) return;
  lastTickMs = now;
  if (!active) return;
  float t = (moveDurMs == 0) ? 1.0f : (float)(now - moveStartMs) / (float)moveDurMs;
  if (t >= 1.0f) {
    t = 1.0f;
    active = false;
  }
  float k = ease(t);
  for (uint8_t j = 0; j < NUM_JOINTS; j++) {
    cur[j] = from[j] + (target[j] - from[j]) * k;
  }
  writePose();
}

bool moving() { return active; }

void currentPose(float out[NUM_JOINTS]) {
  for (uint8_t j = 0; j < NUM_JOINTS; j++) out[j] = cur[j];
}

}  // namespace arm
