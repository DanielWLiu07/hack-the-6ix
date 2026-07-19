// cockpit sketch.ino - combined DRIVE + ARM teleop (Uno Q STM32U585).
//
// Forked from teleop's drive sketch (verbatim) + servo-jog's arm, merged so a
// single App Lab app owns both the wheels and the 4-servo arm.
//
//   DRIVE: BTS7960 dual-PWM (5/7/6/8), slew + deadband + 500 ms watchdog + estop.
//   ARM:   4 servos direct GPIO (D3 base, D10 shoulder, D9 elbow, D11 gripper),
//          NON-BLOCKING interpolation in the 20 ms tick so a pose move never
//          stalls the drive loop or starves the heartbeat.
//
// RPCs: set_drive, heartbeat, stop, estop, clear_estop, get_status  (drive)
//       set_servo, goto_pose, park, get_servos                      (arm)

#include <Arduino_RouterBridge.h>

// ===================== DRIVE (unchanged from teleop) =======================
static const int PIN_L_RPWM = 5;   // LEFT  forward PWM
static const int PIN_L_LPWM = 7;   // LEFT  reverse PWM
static const int PIN_R_RPWM = 6;   // RIGHT forward PWM
static const int PIN_R_LPWM = 8;   // RIGHT reverse PWM

static const float DEADBAND      = 0.05f;
static const int   MIN_PWM       = 70;
static const float SLEW_PER_TICK = 0.08f;  // gentler accel/decel (was 0.20) - less jerk;
                                           // full 0->1 in ~250 ms. Lower = softer.
static const int   TICK_MS       = 20;
static const float L_TRIM        = 1.00f;
static const float R_TRIM        = 0.96f;
static const int   L_INVERT      = 0;
static const int   R_INVERT      = 0;
static const unsigned long WATCHDOG_MS = 500;

static float cmdL = 0, cmdR = 0;
static float outL = 0, outR = 0;
static volatile unsigned long lastHbMs = 0;
static volatile bool estopped = false;
static unsigned long lastTickMs = 0;

// state codes: 0 = OK, 2 = WATCHDOG, 3 = ESTOP.
static int stateCode() {
  if (estopped) return 3;
  if (millis() - lastHbMs > WATCHDOG_MS) return 2;
  return 0;
}
static bool motionAllowed() { return stateCode() == 0; }
static float clamp1(float v) { return v > 1.0f ? 1.0f : (v < -1.0f ? -1.0f : v); }

static void writeMotor(int rpwm, int lpwm, float v, int invert) {
  if (invert) v = -v;
  if (v > -DEADBAND && v < DEADBAND) v = 0;
  int pwm = (int)(fabsf(v) * 255.0f);
  if (pwm > 255) pwm = 255;
  if (pwm > 0 && pwm < MIN_PWM) pwm = MIN_PWM;
  if (v > 0) { analogWrite(rpwm, pwm); analogWrite(lpwm, 0); }
  else if (v < 0) { analogWrite(rpwm, 0); analogWrite(lpwm, pwm); }
  else { analogWrite(rpwm, 0); analogWrite(lpwm, 0); }
}

static void motorsOff() {
  cmdL = cmdR = outL = outR = 0;
  analogWrite(PIN_L_RPWM, 0); analogWrite(PIN_L_LPWM, 0);
  analogWrite(PIN_R_RPWM, 0); analogWrite(PIN_R_LPWM, 0);
}

static float slew(float out, float cmd) {
  float d = cmd - out;
  if (d >  SLEW_PER_TICK) d =  SLEW_PER_TICK;
  if (d < -SLEW_PER_TICK) d = -SLEW_PER_TICK;
  return out + d;
}

// ===================== ARM (direct-drive, non-blocking) ====================
static const int PIN_SERVO_BASE     = 3;    // idx 0
static const int PIN_SERVO_SHOULDER = 10;   // idx 1  (confirmed D10)
static const int PIN_SERVO_ELBOW    = 9;    // idx 2  (confirmed D9)
static const int PIN_SERVO_GRIPPER  = 11;   // idx 3
static const int SERVO_MIN_US = 500, SERVO_MAX_US = 2500;

// Per-joint soft limits [base, shoulder, elbow, gripper] - bench-measured.
// base is left wide (0..180) until its wiring/servo is fixed.
static const int JMIN[4] = {   0,   0,  90,  95 };   // shoulder min 0; gripper min 95
static const int JMAX[4] = { 180, 175, 175, 150 };

// Per-joint interpolation speed (deg per 20 ms tick). base is SLOW (1 -> ~50
// deg/s): it's the heavy 30 kg servo and browns out if slewed fast. Others 4.
static const int SERVO_STEP[4] = { 1, 4, 4, 4 };

// Named poses [base, shoulder, elbow, gripper] - PLACEHOLDERS within limits.
// TUNE with the jog sliders, then paste real angles. DEPOSIT_L/R become
// multi-waypoint sequences once we have grab/lift/swing/release angles.
enum { POSE_HOME = 0, NUM_POSES = 1 };
static const int POSES[NUM_POSES][4] = {
  { 120,  45, 150,  95 },   // HOME  [base, shoulder, elbow, gripper=closed] - bench-set
};

// ---- Direct-register 50 Hz hardware PWM (replaces the Servo lib -> no jitter) ----
// analogWrite() does the one-time pin mux + timer clock/device init, then we
// reprogram the STM32 timers to a true 50 Hz (the driver's fixed ~500 Hz
// prescaler can't). Map (sketch pin -> STM32 -> timer/channel):
//   base=pin3=PB0=TIM3_CH3 . shoulder=pin10=PB9=TIM4_CH4 . elbow=pin9=PB8=TIM4_CH3
//   gripper=pin11=PB15=TIM1_CH3N (complementary). 160 MHz/160 -> 1 us tick, ARR 20000.
#define REG(b, o) (*(volatile uint32_t *)((b) + (o)))
#define O_CR1 0x00
#define O_EGR 0x14
#define O_CCMR2 0x1C
#define O_CCER 0x20
#define O_PSC 0x28
#define O_ARR 0x2C
#define O_CCR3 0x3C
#define O_CCR4 0x40
#define O_BDTR 0x44
#define TIM1_BASE 0x40012C00UL
#define TIM3_BASE 0x40000400UL
#define TIM4_BASE 0x40000800UL

static uint32_t degToUs(int deg) {
  return (uint32_t)SERVO_MIN_US + (uint32_t)deg * (SERVO_MAX_US - SERVO_MIN_US) / 180u;
}

// write joint idx (0 base,1 shoulder,2 elbow,3 gripper) to a degree, jitter-free
static void writeServo(int idx, int deg) {
  uint32_t u = degToUs(deg);
  switch (idx) {
    case 0: REG(TIM3_BASE, O_CCR3) = u; break;  // base     TIM3_CH3
    case 1: REG(TIM4_BASE, O_CCR4) = u; break;  // shoulder TIM4_CH4
    case 2: REG(TIM4_BASE, O_CCR3) = u; break;  // elbow    TIM4_CH3
    case 3: REG(TIM1_BASE, O_CCR3) = u; break;  // gripper  TIM1_CH3N
  }
}

static void armPwmBegin() {
  analogWrite(PIN_SERVO_BASE, 90);      // mux each pin + init its timer (deferred)
  analogWrite(PIN_SERVO_SHOULDER, 90);
  analogWrite(PIN_SERVO_ELBOW, 90);
  analogWrite(PIN_SERVO_GRIPPER, 90);
  delay(10);
  // TIM3: base CH3 (normal)
  REG(TIM3_BASE, O_CR1) &= ~1u; REG(TIM3_BASE, O_PSC) = 159; REG(TIM3_BASE, O_ARR) = 19999;
  { uint32_t m = REG(TIM3_BASE, O_CCMR2); m &= ~0x00FFu; m |= (6u << 4) | (1u << 3); REG(TIM3_BASE, O_CCMR2) = m; }
  REG(TIM3_BASE, O_CCER) |= (1u << 8); REG(TIM3_BASE, O_CR1) |= (1u << 7);
  REG(TIM3_BASE, O_EGR) = 1u; REG(TIM3_BASE, O_CR1) |= 1u;
  // TIM4: elbow CH3 + shoulder CH4 (normal)
  REG(TIM4_BASE, O_CR1) &= ~1u; REG(TIM4_BASE, O_PSC) = 159; REG(TIM4_BASE, O_ARR) = 19999;
  { uint32_t m = REG(TIM4_BASE, O_CCMR2); m &= ~0x00FFu; m |= (6u << 4) | (1u << 3);
    m &= ~0xFF00u; m |= (6u << 12) | (1u << 11); REG(TIM4_BASE, O_CCMR2) = m; }
  REG(TIM4_BASE, O_CCER) |= (1u << 8) | (1u << 12); REG(TIM4_BASE, O_CR1) |= (1u << 7);
  REG(TIM4_BASE, O_EGR) = 1u; REG(TIM4_BASE, O_CR1) |= 1u;
  // TIM1: gripper CH3N (complementary, advanced -> needs MOE)
  REG(TIM1_BASE, O_CR1) &= ~1u; REG(TIM1_BASE, O_PSC) = 159; REG(TIM1_BASE, O_ARR) = 19999;
  { uint32_t m = REG(TIM1_BASE, O_CCMR2); m &= ~0x00FFu; m |= (6u << 4) | (1u << 3); REG(TIM1_BASE, O_CCMR2) = m; }
  REG(TIM1_BASE, O_CCER) |= (1u << 10); REG(TIM1_BASE, O_BDTR) |= (1u << 15);
  REG(TIM1_BASE, O_CR1) |= (1u << 7); REG(TIM1_BASE, O_EGR) = 1u; REG(TIM1_BASE, O_CR1) |= 1u;
}

static int armCur[4]    = { 90, 90, 90, 90 };   // current (written) angle
static int armTarget[4] = { 90, 90, 90, 90 };   // goal angle

static int clampJoint(int ch, int deg) {
  if (deg < JMIN[ch]) deg = JMIN[ch];
  if (deg > JMAX[ch]) deg = JMAX[ch];
  return deg;
}

// Step every joint toward its target, capped at SERVO_STEP/tick. Called from
// loop() every 20 ms - never blocks.
static void armTick() {
  for (int i = 0; i < 4; i++) {
    if (armCur[i] == armTarget[i]) continue;
    int step = SERVO_STEP[i];
    int d = armTarget[i] - armCur[i];
    if (d >  step) d =  step;
    if (d < -step) d = -step;
    armCur[i] += d;
    writeServo(i, armCur[i]);
  }
}

// ===================== RPC handlers ========================================
// Bridge marshals args as ints; python sends drive as per-mille (-1000..1000).
static int rpc_set_drive(float l, float r) {
  if (l > 1.0f || l < -1.0f) l *= 0.001f;
  if (r > 1.0f || r < -1.0f) r *= 0.001f;
  if (motionAllowed()) { cmdL = clamp1(l); cmdR = clamp1(r); }
  else { cmdL = cmdR = 0; }
  return stateCode();
}
static int rpc_heartbeat() { lastHbMs = millis(); return stateCode(); }
static int rpc_stop() { cmdL = cmdR = 0; return stateCode(); }

static int rpc_estop() {
  estopped = true;
  motorsOff();
  for (int i = 0; i < 4; i++) armTarget[i] = armCur[i];   // freeze arm in place
  return 3;
}
static int rpc_clear_estop() {
  estopped = false;
  lastHbMs = millis();
  return stateCode();
}
// get_status -> [state, l_pct, r_pct].
static MsgPack::arr_t<int> rpc_get_status() {
  MsgPack::arr_t<int> a;
  a.push_back(stateCode());
  a.push_back((int)(cmdL * 100.0f));
  a.push_back((int)(cmdR * 100.0f));
  return a;
}

// arm RPCs - ignored while estopped so a safety stop also freezes the arm.
static int rpc_set_servo(int ch, int deg) {
  if (estopped || ch < 0 || ch > 3) return -1;
  armTarget[ch] = clampJoint(ch, deg);
  return armTarget[ch];
}
static int rpc_goto_pose(int id) {
  if (estopped || id < 0 || id >= NUM_POSES) return -1;
  for (int i = 0; i < 4; i++) armTarget[i] = clampJoint(i, POSES[id][i]);
  return id;
}
static int rpc_park() {
  if (estopped) return -1;
  for (int i = 0; i < 4; i++) armTarget[i] = clampJoint(i, 90);
  return 0;
}
static MsgPack::arr_t<int> rpc_get_servos() {
  MsgPack::arr_t<int> a;
  for (int i = 0; i < 4; i++) a.push_back(armCur[i]);
  return a;
}

void setup() {
  pinMode(PIN_L_RPWM, OUTPUT); pinMode(PIN_L_LPWM, OUTPUT);
  pinMode(PIN_R_RPWM, OUTPUT); pinMode(PIN_R_LPWM, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  motorsOff();

  armPwmBegin();                        // 50 Hz hardware PWM on all 4 servo pins
  for (int i = 0; i < 4; i++) writeServo(i, armCur[i]);   // park arm at 90

  Bridge.begin();
  Bridge.provide_safe("set_drive", rpc_set_drive);
  Bridge.provide_safe("heartbeat", rpc_heartbeat);
  Bridge.provide_safe("stop", rpc_stop);
  Bridge.provide("estop", rpc_estop);        // plain provide: fires even if loop wedges
  Bridge.provide_safe("clear_estop", rpc_clear_estop);
  Bridge.provide_safe("get_status", rpc_get_status);
  Bridge.provide_safe("set_servo", rpc_set_servo);
  Bridge.provide_safe("goto_pose", rpc_goto_pose);
  Bridge.provide_safe("park", rpc_park);
  Bridge.provide_safe("get_servos", rpc_get_servos);

  lastHbMs = millis();   // grace window until python starts heartbeating
}

void loop() {
  unsigned long now = millis();
  if (now - lastTickMs < TICK_MS) return;
  lastTickMs = now;

  // --- drive ---
  float tl = cmdL, tr = cmdR;
  if (!motionAllowed()) { tl = tr = 0; cmdL = cmdR = 0; }
  outL = slew(outL, tl);
  outR = slew(outR, tr);
  writeMotor(PIN_L_RPWM, PIN_L_LPWM, outL * L_TRIM, L_INVERT);
  writeMotor(PIN_R_RPWM, PIN_R_LPWM, outR * R_TRIM, R_INVERT);

  // --- arm --- (independent of drive; interpolates toward targets)
  armTick();

  digitalWrite(LED_BUILTIN, motionAllowed() ? HIGH : ((now / 200) % 2));
}
