#include "bench.h"

#include "arm.h"
#include "config.h"
#include "drive.h"
#include "safety.h"
#include "sonar.h"

namespace bench {

static char line[96];
static uint8_t lineLen = 0;

static void printStatus() {
  float pose[NUM_JOINTS];
  arm::currentPose(pose);
  Serial.print(F("state="));
  switch (safety::state()) {
    case safety::RUN: Serial.print(F("RUN")); break;
    case safety::WATCHDOG_STOP: Serial.print(F("WATCHDOG_STOP")); break;
    case safety::ESTOP: Serial.print(F("ESTOP")); break;
  }
  Serial.print(F(" wd="));
  Serial.print(safety::watchdogEnabled() ? 1 : 0);
  Serial.print(F(" beat_ms="));
  Serial.print(safety::msSinceHeartbeat());
  Serial.print(F(" drive="));
  Serial.print(drive::commandedL());
  Serial.print(F(","));
  Serial.print(drive::commandedR());
  Serial.print(F(" arm="));
  for (uint8_t j = 0; j < NUM_JOINTS; j++) {
    Serial.print(pose[j], 1);
    Serial.print(j < NUM_JOINTS - 1 ? F(",") : F(""));
  }
  Serial.print(F(" moving="));
  Serial.print(arm::moving() ? 1 : 0);
  Serial.print(F(" sonar_cm="));
  Serial.print(sonar::lastCm(), 1);
  Serial.print(F(" blocked="));
  Serial.println(sonar::blocked() ? 1 : 0);
}

static void printHelp() {
  Serial.println(F("bench commands:"));
  Serial.println(F("  h                  heartbeat (arms watchdog)"));
  Serial.println(F("  w 0|1              watchdog disable/enable"));
  Serial.println(F("  e                  e-stop (latched, servos limp)"));
  Serial.println(F("  r                  clear e-stop"));
  Serial.println(F("  d <l> <r>          tank drive, -1..1"));
  Serial.println(F("  x                  stop drive"));
  Serial.println(F("  s <j0..j4> <ms>    move 5 servos (deg) over ms"));
  Serial.println(F("  j <idx> <delta>    jog one joint by delta deg"));
  Serial.println(F("  z <ms>             go to home pose"));
  Serial.println(F("  u                  read ultrasonic"));
  Serial.println(F("  p                  print status line"));
}

static void dispatch(char *s) {
  // strtok-based parse: first token = command, rest = float args.
  char *tok = strtok(s, " \t");
  if (!tok) return;
  char cmd = tok[0];
  float a[8];
  uint8_t n = 0;
  while (n < 8 && (tok = strtok(NULL, " \t")) != NULL) a[n++] = atof(tok);

  switch (cmd) {
    case 'h':
      safety::heartbeat();
      Serial.println(F("ok beat"));
      break;
    case 'w':
      safety::setWatchdogEnabled(n >= 1 && a[0] != 0);
      Serial.println(F("ok wd"));
      break;
    case 'e':
      safety::triggerEstop();
      drive::stop();
      arm::off();
      Serial.println(F("ok ESTOP"));
      break;
    case 'r':
      safety::clearEstop();
      arm::engage();
      Serial.println(F("ok run"));
      break;
    case 'd':
      if (n >= 2 && safety::motionAllowed()) {
        drive::set(a[0], a[1]);
        Serial.println(F("ok drive"));
      } else {
        Serial.println(F("err drive (args or stopped)"));
      }
      break;
    case 'x':
      drive::stop();
      Serial.println(F("ok stop"));
      break;
    case 's':
      if (n >= NUM_JOINTS + 1 && safety::motionAllowed()) {
        float joints[NUM_JOINTS];
        for (uint8_t j = 0; j < NUM_JOINTS; j++) joints[j] = a[j];
        bool ok = arm::moveTo(joints, (uint32_t)a[NUM_JOINTS]);
        Serial.println(ok ? F("ok move") : F("ok move (clamped)"));
      } else {
        Serial.println(F("err move (args or stopped)"));
      }
      break;
    case 'j':
      if (n >= 2 && safety::motionAllowed()) {
        arm::jog((uint8_t)a[0], a[1]);
        Serial.println(F("ok jog"));
      } else {
        Serial.println(F("err jog (args or stopped)"));
      }
      break;
    case 'z':
      if (safety::motionAllowed()) {
        arm::moveTo(JOINT_HOME_DEG, n >= 1 ? (uint32_t)a[0] : 1500);
        Serial.println(F("ok home"));
      } else {
        Serial.println(F("err home (stopped)"));
      }
      break;
    case 'u':
      Serial.print(F("sonar_cm="));
      Serial.println(sonar::lastCm(), 1);
      break;
    case 'p':
      printStatus();
      break;
    case '?':
      printHelp();
      break;
    default:
      Serial.println(F("err unknown (try ?)"));
  }
}

void begin() {
  Serial.begin(BENCH_BAUD);
  Serial.println(F("fw-mcu bench ready ('?' for help)"));
}

void tick() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen > 0) {
        line[lineLen] = '\0';
        dispatch(line);
        lineLen = 0;
      }
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    } else {
      lineLen = 0;  // overflow — drop the line
      Serial.println(F("err line too long"));
    }
  }
}

}  // namespace bench
