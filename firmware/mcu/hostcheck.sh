#!/usr/bin/env bash
# Host-side syntax check for the MCU sketch — no arduino-cli needed.
# Generates minimal Arduino/Wire stubs and runs g++ -fsyntax-only over every
# source file. NOT a substitute for a real arduino-cli compile (fw-tools'
# flash.sh), but catches C++ errors instantly on any laptop.
set -euo pipefail
cd "$(dirname "$0")"

STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT

cat > "$STUB/Arduino.h" <<'EOF'
#pragma once
#include <ctype.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define LED_BUILTIN 13
#define F(x) x
class String : public std::string {
 public:
  String() {}
  String(const char *s) : std::string(s) {}
  String &operator+=(const char *s) { append(s); return *this; }
  template <typename T> String &operator+=(const T &) { return *this; }
};
unsigned long millis();
void delay(unsigned long);
void delayMicroseconds(unsigned int);
void pinMode(int, int);
void digitalWrite(int, int);
int digitalRead(int);
void analogWrite(int, int);
unsigned long pulseIn(int, int, unsigned long);
class HardwareSerial {
 public:
  void begin(unsigned long);
  int available();
  int read();
  template <typename T> void print(const T &) {}
  template <typename T, typename U> void print(const T &, const U &) {}
  template <typename T> void println(const T &) {}
  template <typename T, typename U> void println(const T &, const U &) {}
  void println() {}
};
extern HardwareSerial Serial;
EOF

cat > "$STUB/Wire.h" <<'EOF'
#pragma once
#include <stddef.h>
#include <stdint.h>
class TwoWire {
 public:
  void begin();
  void beginTransmission(uint8_t);
  uint8_t endTransmission();
  size_t write(uint8_t);
};
extern TwoWire Wire;
EOF

fail=0
for f in *.cpp; do
  if g++ -std=c++17 -fsyntax-only -Wall -Wextra -I"$STUB" -I. "$f"; then
    echo "ok   $f"
  else
    echo "FAIL $f"
    fail=1
  fi
done
if g++ -std=c++17 -fsyntax-only -Wall -Wextra -I"$STUB" -I. -x c++ mcu.ino; then
  echo "ok   mcu.ino"
else
  echo "FAIL mcu.ino"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "ALL CLEAN"
else
  exit 1
fi
