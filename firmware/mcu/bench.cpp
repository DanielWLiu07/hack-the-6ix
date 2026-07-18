#include "bench.h"

#include "config.h"
#include "rpc_handlers.h"
#include "safety.h"

namespace bench {

static char line[96];
static uint8_t lineLen = 0;

static void replyOk(int state) {
  Serial.print(F("OK "));
  Serial.println(state);
}

static void replyErr(int code, const char *msg) {
  Serial.print(F("ERR "));
  Serial.print(code);
  Serial.print(F(" "));
  Serial.println(msg);
}

static void replyStatus() {
  int st[STATUS_LEN];
  rpc::get_status(st);
  Serial.print(F("ST"));
  for (uint8_t i = 0; i < STATUS_LEN; i++) {
    Serial.print(F(" "));
    Serial.print(st[i]);
  }
  Serial.println();
}

static void printHelp() {
  Serial.println(F("# D <l> <r>                       set_drive (-1..1)"));
  Serial.println(F("# S <j0> <j1> <j2> <j3> <j4> <ms> move_servos (deg, ms)"));
  Serial.println(F("# H                               heartbeat"));
  Serial.println(F("# E                               estop (latched)"));
  Serial.println(F("# C                               clear_estop"));
  Serial.println(F("# Q                               get_status -> ST ..."));
  Serial.println(F("# Z                               zero_all (90 deg, 1500 ms)"));
  Serial.println(F("# W <0|1>                        watchdog disarm/arm (bench only)"));
}

// Strict float parse; returns false on trailing garbage ("1.2x").
static bool parseFloat(const char *tok, float *out) {
  char *end = NULL;
  double v = strtod(tok, &end);
  if (end == tok || *end != '\0') return false;
  *out = (float)v;
  return true;
}

static void dispatch(char *s) {
  char *tok = strtok(s, " \t");
  if (!tok) return;
  if (tok[1] != '\0') {
    replyErr(3, "unknown command");
    return;
  }
  char cmd = (char)toupper(tok[0]);

  // Collect and strictly parse the numeric args.
  float a[8];
  uint8_t n = 0;
  while ((tok = strtok(NULL, " \t")) != NULL) {
    if (n >= 8 || !parseFloat(tok, &a[n])) {
      replyErr(2, "unparseable arg");
      return;
    }
    n++;
  }

  switch (cmd) {
    case 'D':
      if (n != 2) { replyErr(1, "want: D <l> <r>"); return; }
      replyOk(rpc::set_drive(a[0], a[1]));
      break;
    case 'S': {
      if (n != NUM_JOINTS + 1) { replyErr(1, "want: S <j0..j4> <ms>"); return; }
      int joints[NUM_JOINTS];
      for (uint8_t j = 0; j < NUM_JOINTS; j++) joints[j] = (int)a[j];
      replyOk(rpc::move_servos(joints, (int)a[NUM_JOINTS]));
      break;
    }
    case 'H':
      if (n != 0) { replyErr(1, "want: H"); return; }
      replyOk(rpc::heartbeat());
      break;
    case 'E':
      if (n != 0) { replyErr(1, "want: E"); return; }
      replyOk(rpc::estop());
      break;
    case 'C':
      if (n != 0) { replyErr(1, "want: C"); return; }
      replyOk(rpc::clear_estop());
      break;
    case 'Q':
      if (n != 0) { replyErr(1, "want: Q"); return; }
      replyStatus();
      break;
    case 'Z':
      if (n != 0) { replyErr(1, "want: Z"); return; }
      replyOk(rpc::zero_all());
      break;
    case 'W':
      // Bench-only knob (BRIDGE.md §5): bench boots DISARMED so a human at a
      // serial monitor isn't stuck in WATCHDOG; W 1 arms + resets the timer.
      if (n != 1) { replyErr(1, "want: W <0|1>"); return; }
      safety::setWatchdogEnabled(a[0] != 0);
      replyOk((int)safety::tick());
      break;
    case '?':
      printHelp();
      replyOk((int)safety::state());
      break;
    default:
      replyErr(3, "unknown command");
  }
}

void begin() {
  Serial.begin(BENCH_BAUD);
  Serial.println(F("# uno-q-mcu bench " FW_VERSION));
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
      lineLen = 0;  // overflow - drop the line
      replyErr(2, "line too long");
    }
  }
}

void debug(const char *msg) {
  Serial.print(F("# "));
  Serial.println(msg);
}

}  // namespace bench
