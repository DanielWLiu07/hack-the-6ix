// sketch.ino - Uno Q teleop drive (STM32U585 real-time core).
//
// A from-scratch, teleop-ONLY firmware for the rover drive train. No arm, no
// sonar, no bench console - just the differential drive + the safety a moving
// robot needs. Deliberately one file so there is nothing to mis-wire.
//
// Control path (all self-contained on the Uno Q, no laptop hub):
//   browser gamepad -> web_ui page :7000 -> python/main.py -> App Lab Bridge RPC
//   -> the handlers below -> BTS7960 dual-PWM -> motors.
//
// Motor driver: BTS7960 / IBT-2, dual-PWM. R_EN + L_EN tied HIGH in hardware.
// Direction = which of RPWM/LPWM carries the PWM; both 0 = coast/stop.
// Pins are the ones proven on the rover (firmware/DRIVE_BTS7960.md).
//
// Safety, layered:
//   * 500 ms heartbeat watchdog: python must call heartbeat() or motors stop.
//   * estop() latches motors off until clear_estop().
//   * python also runs a deadman timeout, so the browser/controller dropping
//     out zeroes drive before the MCU watchdog even fires.

#include <Arduino_RouterBridge.h>

// ---- BTS7960 dual-PWM pins (LEFT / RIGHT, forward / reverse) --------------
static const int PIN_L_RPWM = 5;   // LEFT  forward PWM
static const int PIN_L_LPWM = 7;   // LEFT  reverse PWM
static const int PIN_R_RPWM = 6;   // RIGHT forward PWM
static const int PIN_R_LPWM = 8;   // RIGHT reverse PWM

// ---- drive tuning ---------------------------------------------------------
static const float DEADBAND      = 0.05f;  // below this -> 0 (motor won't move)
static const int   MIN_PWM       = 70;     // stiction floor (0..255, ~27%)
// Asymmetric slew: quick to speed up (responsive), gentle to slow down so the
// rover eases to a stop instead of cutting abruptly and shaking. Per 20 ms tick.
static const float SLEW_UP       = 0.20f;  // accel: full 0->1 in ~100 ms
static const float SLEW_DOWN     = 0.06f;  // decel/stop: ~1->0 in ~330 ms
static const int   TICK_MS       = 20;     // drive control period
static const float L_TRIM        = 1.00f;  // per-side straight-line trim
static const float R_TRIM        = 0.96f;  // right motor runs faster -> slow it
static const int   L_INVERT      = 0;      // flip if a wheel spins backwards
static const int   R_INVERT      = 0;
static const unsigned long WATCHDOG_MS = 500;

// ---- state ----------------------------------------------------------------
static float cmdL = 0, cmdR = 0;   // requested (normalized -1..1)
static float outL = 0, outR = 0;   // slew-limited, actually written
static volatile unsigned long lastHbMs = 0;
static volatile bool estopped = false;
static unsigned long lastTickMs = 0;

// state codes returned to python (match the drivenode convention):
//   0 = OK, 2 = WATCHDOG, 3 = ESTOP.
static int stateCode() {
  if (estopped) return 3;
  if (millis() - lastHbMs > WATCHDOG_MS) return 2;
  return 0;
}
static bool motionAllowed() { return stateCode() == 0; }

static float clamp1(float v) { return v > 1.0f ? 1.0f : (v < -1.0f ? -1.0f : v); }

// applyFloor: hold PWM at the stiction minimum so the wheel breaks free from
// rest. Skipped while coasting to a stop so the output eases through the floor
// to 0 instead of snapping off (that snap is what makes the rover jolt/shake).
static void writeMotor(int rpwm, int lpwm, float v, int invert, bool applyFloor) {
  if (invert) v = -v;
  if (v > -DEADBAND && v < DEADBAND) v = 0;
  int pwm = (int)(fabsf(v) * 255.0f);
  if (pwm > 255) pwm = 255;
  if (applyFloor && pwm > 0 && pwm < MIN_PWM) pwm = MIN_PWM;  // break stiction, don't hum
  if (v > 0) {
    analogWrite(rpwm, pwm);
    analogWrite(lpwm, 0);
  } else if (v < 0) {
    analogWrite(rpwm, 0);
    analogWrite(lpwm, pwm);
  } else {
    analogWrite(rpwm, 0);
    analogWrite(lpwm, 0);
  }
}

static void motorsOff() {
  cmdL = cmdR = outL = outR = 0;
  analogWrite(PIN_L_RPWM, 0);
  analogWrite(PIN_L_LPWM, 0);
  analogWrite(PIN_R_RPWM, 0);
  analogWrite(PIN_R_LPWM, 0);
}

static float slew(float out, float cmd) {
  // Heading toward a smaller magnitude (slowing down / stopping) ramps gently;
  // speeding up ramps quickly.
  float rate = (fabsf(cmd) < fabsf(out)) ? SLEW_DOWN : SLEW_UP;
  float d = cmd - out;
  if (d > rate) d = rate;
  if (d < -rate) d = -rate;
  return out + d;
}

// ---- RPC handlers ---------------------------------------------------------
// The App Lab Bridge marshals args as INTEGERS (floats are truncated), so
// python sends per-mille ints (-1000..1000). |v|>1 can only be per-mille, so
// scale it back; a real -1..1 float (e.g. a future bench caller) passes through.
static int rpc_set_drive(float l, float r) {
  lastHbMs = millis();  // a drive command also feeds the watchdog (Linux is alive)
  if (l > 1.0f || l < -1.0f) l *= 0.001f;
  if (r > 1.0f || r < -1.0f) r *= 0.001f;
  if (motionAllowed()) {
    cmdL = clamp1(l);
    cmdR = clamp1(r);
  } else {
    cmdL = cmdR = 0;
  }
  return stateCode();
}

static int rpc_heartbeat() {
  lastHbMs = millis();
  return stateCode();
}

static int rpc_stop() {
  cmdL = cmdR = 0;
  return stateCode();
}

static int rpc_estop() {
  estopped = true;
  motorsOff();
  return 3;
}

static int rpc_clear_estop() {
  estopped = false;
  lastHbMs = millis();  // fresh grace window so it doesn't instantly re-trip
  return stateCode();
}

// get_status -> [state, l_pct, r_pct] as a MsgPack int array.
static MsgPack::arr_t<int> rpc_get_status() {
  MsgPack::arr_t<int> a;
  a.push_back(stateCode());
  a.push_back((int)(cmdL * 100.0f));
  a.push_back((int)(cmdR * 100.0f));
  return a;
}

void setup() {
  pinMode(PIN_L_RPWM, OUTPUT);
  pinMode(PIN_L_LPWM, OUTPUT);
  pinMode(PIN_R_RPWM, OUTPUT);
  pinMode(PIN_R_LPWM, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  motorsOff();

  Bridge.begin();
  // provide_safe: handler runs in the main-loop context, so it may touch drive
  // state without locks. estop uses plain provide so it fires from the bridge
  // thread even if the loop wedges - it cuts the pins directly.
  Bridge.provide_safe("set_drive", rpc_set_drive);
  Bridge.provide_safe("heartbeat", rpc_heartbeat);
  Bridge.provide_safe("stop", rpc_stop);
  Bridge.provide("estop", rpc_estop);
  Bridge.provide_safe("clear_estop", rpc_clear_estop);
  Bridge.provide_safe("get_status", rpc_get_status);

  lastHbMs = millis();  // 500 ms grace at boot until python starts heartbeating
}

void loop() {
  unsigned long now = millis();
  if (now - lastTickMs < TICK_MS) return;
  lastTickMs = now;

  float tl = cmdL, tr = cmdR;
  if (!motionAllowed()) {  // watchdog or estop -> cut immediately, no gentle coast
    tl = tr = 0;
    cmdL = cmdR = 0;
    outL = outR = 0;
  }
  outL = slew(outL, tl);
  outR = slew(outR, tr);
  // Floor the PWM only while actively commanded (breaks stiction from rest);
  // when the target is 0 the output eases through the floor to a soft stop.
  writeMotor(PIN_L_RPWM, PIN_L_LPWM, outL * L_TRIM, L_INVERT, fabsf(tl) > DEADBAND);
  writeMotor(PIN_R_RPWM, PIN_R_LPWM, outR * R_TRIM, R_INVERT, fabsf(tr) > DEADBAND);

  // LED: solid = armed & driving-capable, blink = watchdog/estop.
  digitalWrite(LED_BUILTIN, motionAllowed() ? HIGH : ((now / 200) % 2));
}
