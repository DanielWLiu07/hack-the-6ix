// servo-jog sketch.ino - live per-servo jog over the App Lab Bridge.
//
// The Python part (main.py) serves an HTML slider page; each slider change
// POSTs to the Python server which calls Bridge "set_servo"(ch, deg); this
// sketch writes that servo. "park" -> all four to 90 deg.
//
// CONFIRMED pin map (nod-count bench test, 2026-07-19):
//   D3 base (idx0) . D10 shoulder (idx1) . D9 elbow (idx2) . D11 gripper (idx3)
//
// Power: each servo V+ from the 5-6 V >=5 A buck (NOT the UNO Q rails), common
// ground with the UNO Q. Signal is 3.3 V straight from the GPIO.

#include <Servo.h>

#if __has_include(<Arduino_RouterBridge.h>)
#include <Arduino_RouterBridge.h>
#define HAS_BRIDGE 1
#else
#define HAS_BRIDGE 0   // lets it still compile on a vanilla core (no Bridge)
#endif

#define PIN_SERVO_BASE      3
#define PIN_SERVO_SHOULDER  10
#define PIN_SERVO_ELBOW     9
#define PIN_SERVO_GRIPPER   11

#define SERVO_MIN_US 500
#define SERVO_MAX_US 2500

Servo base, shoulder, elbow, gripper;
Servo* joints[4]  = { &base, &shoulder, &elbow, &gripper };
const int pins[4] = { PIN_SERVO_BASE, PIN_SERVO_SHOULDER, PIN_SERVO_ELBOW, PIN_SERVO_GRIPPER };
int cur[4] = { 90, 90, 90, 90 };

// -------- Named poses --------  angles are [base, shoulder, elbow, gripper].
// PLACEHOLDERS - tune with the jog UI, then paste real angles here. DEPOSIT_L/R
// are single targets for now; they become multi-waypoint sequences once we have
// the grab/lift/swing/release angles (see moveSeq()).
enum { POSE_NORMAL = 0, POSE_GRAB = 1, POSE_DEPOSIT_L = 2, POSE_DEPOSIT_R = 3, NUM_POSES = 4 };
static const int POSES[NUM_POSES][4] = {
  {  90,  90,  90,  90 },   // NORMAL     home / stow        (TUNE)
  {  90,  60, 120,  60 },   // GRAB       reach + open grip  (TUNE)
  {  45,  80, 100, 110 },   // DEPOSIT_L  swing left + drop  (TUNE)
  { 135,  80, 100, 110 },   // DEPOSIT_R  swing right + drop (TUNE)
};

// set one servo: ch 0..3, deg 0..180 (clamped). Returns the applied angle.
static int set_servo(int ch, int deg) {
  if (ch < 0 || ch > 3) return -1;
  deg = constrain(deg, 0, 180);
  cur[ch] = deg;
  joints[ch]->write(deg);
  return deg;
}

// all four -> 90 deg.
static int park() {
  for (int i = 0; i < 4; i++) { cur[i] = 90; joints[i]->write(90); }
  return 0;
}

// Smooth blocking interpolation from cur[] to target[] over ms (~20 ms steps),
// so poses never snap. Fine to block a Bridge call for a button press.
static void moveTo(const int target[4], int ms) {
  int start[4];
  for (int i = 0; i < 4; i++) start[i] = cur[i];
  int steps = ms / 20; if (steps < 1) steps = 1;
  for (int s = 1; s <= steps; s++) {
    float t = (float)s / steps;
    for (int i = 0; i < 4; i++) {
      int a = start[i] + (int)((target[i] - start[i]) * t);
      cur[i] = a; joints[i]->write(a);
    }
    delay(20);
  }
  for (int i = 0; i < 4; i++) { cur[i] = target[i]; joints[i]->write(target[i]); }
}

// Go to a named pose (smooth). Returns the pose id, or -1 if out of range.
static int goto_pose(int id) {
  if (id < 0 || id >= NUM_POSES) return -1;
  moveTo(POSES[id], 800);
  return id;
}

#if HAS_BRIDGE
static MsgPack::arr_t<int> get_servos() {
  MsgPack::arr_t<int> a;
  for (int i = 0; i < 4; i++) a.push_back(cur[i]);
  return a;
}
#endif

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) {
    joints[i]->attach(pins[i], SERVO_MIN_US, SERVO_MAX_US);
    joints[i]->write(cur[i]);                 // start parked at 90
  }
#if HAS_BRIDGE
  Bridge.begin();
  Bridge.provide_safe("set_servo", set_servo);   // (int ch, int deg) -> int
  Bridge.provide_safe("park", park);             // () -> int
  Bridge.provide_safe("goto_pose", goto_pose);   // (int id) -> int
  Bridge.provide_safe("get_servos", get_servos); // () -> int[4]
#endif
  Serial.println("# servo-jog ready (4 servos parked at 90)");
}

void loop() {
  // provide_safe handlers run in this loop's context - just yield.
  (void)set_servo; (void)park;   // silence unused warnings on no-bridge builds
  delay(20);
}
