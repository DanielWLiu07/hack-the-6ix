#include "pca9685.h"

#include <Wire.h>

// Register map (datasheet §7.3)
#define REG_MODE1 0x00
#define REG_PRESCALE 0xFE
#define REG_LED0_ON_L 0x06
#define REG_ALL_LED_OFF_H 0xFD
#define MODE1_SLEEP 0x10
#define MODE1_AI 0x20
#define MODE1_RESTART 0x80
#define PCA_OSC_HZ 25000000.0f

namespace pca9685 {

static uint8_t i2cAddr = 0x40;
static bool chipPresent = false;
static float pwmFreq = 50.0f;

static bool write8(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(i2cAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool begin(uint8_t addr, float freqHz) {
  i2cAddr = addr;
  pwmFreq = freqHz;
  Wire.begin();
  Wire.beginTransmission(i2cAddr);
  chipPresent = (Wire.endTransmission() == 0);
  if (!chipPresent) return false;

  uint8_t prescale = (uint8_t)(PCA_OSC_HZ / (4096.0f * freqHz) - 1.0f + 0.5f);
  write8(REG_MODE1, MODE1_SLEEP | MODE1_AI);   // must sleep to set prescale
  write8(REG_PRESCALE, prescale);
  write8(REG_MODE1, MODE1_AI);                 // wake
  delay(1);                                    // osc startup (>500 µs)
  write8(REG_MODE1, MODE1_AI | MODE1_RESTART);
  return true;
}

bool present() { return chipPresent; }

void writeMicros(uint8_t channel, uint16_t us) {
  if (!chipPresent || channel > 15) return;
  uint16_t off;
  if (us == 0) {
    off = 0;  // handled by full-off bit below
  } else {
    float ticks = (float)us * pwmFreq * 4096.0f / 1000000.0f;
    if (ticks > 4095.0f) ticks = 4095.0f;
    off = (uint16_t)ticks;
  }
  uint8_t base = REG_LED0_ON_L + 4 * channel;
  Wire.beginTransmission(i2cAddr);
  Wire.write(base);
  Wire.write((uint8_t)0);            // ON_L = 0
  Wire.write((uint8_t)0);            // ON_H = 0
  if (us == 0) {
    Wire.write((uint8_t)0);
    Wire.write((uint8_t)0x10);       // OFF_H full-off bit
  } else {
    Wire.write((uint8_t)(off & 0xFF));
    Wire.write((uint8_t)(off >> 8));
  }
  Wire.endTransmission();
}

void allOff() {
  if (!chipPresent) return;
  write8(REG_ALL_LED_OFF_H, 0x10);
}

}  // namespace pca9685
