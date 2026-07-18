// pca9685.h - minimal PCA9685 16-ch PWM driver over Wire.
// Deliberately dependency-free (no Adafruit lib) so the sketch builds on a
// bare arduino-cli install. Only what the arm needs: init at 50 Hz + set
// pulse width in microseconds per channel.
#pragma once

#include <Arduino.h>

namespace pca9685 {

// Returns false if the chip doesn't ACK (bench mode without hardware -
// callers keep running, writes become no-ops).
bool begin(uint8_t addr, float freqHz);

bool present();

// Set channel pulse width in µs (0 = output off / servo unpowered).
void writeMicros(uint8_t channel, uint16_t us);

// Turn all outputs off (servos go limp) - used only by hard e-stop.
void allOff();

}  // namespace pca9685
