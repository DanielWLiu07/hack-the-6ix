#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pca = Adafruit_PWMServoDriver();

// Servo pulse lengths
#define SERVOMIN  500   // Adjust if needed
#define SERVOMAX  2500   // Adjust if needed

// Servo channels
const uint8_t servo1 = 0;
const uint8_t servo2 = 1;
const uint8_t servo3 = 2;
const uint8_t servo4 = 3;

// Convert angle (0-180°) to PCA9685 pulse
uint16_t angleToPulse(int angle) {
  return map(angle, 0, 180, SERVOMIN, SERVOMAX);
}

void setServoAngle(uint8_t channel, int angle) {
  if (channel!=3){
    angle = constrain(angle, 0, 270);
    pca.setPWM(channel, 0, angleToPulse(angle));
    return;
  }
  angle = constrain(angle, 0, 180);
  pca.setPWM(channel, 0, angleToPulse(angle));
  
}


void setup() {

}

void loop() {

}