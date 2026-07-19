// pwmtest v5 - REGISTER-HACK 50 Hz hardware PWM on all 4 servo pins.
//
// The Zephyr driver fixes each timer's prescaler for ~500 Hz, so pwm_set can't
// reach 50 Hz on the 16-bit TIM3/TIM4. We let analogWrite() do the one-time pin
// mux + clock/device init, then reprogram the timer registers directly for a
// true 50 Hz (20 ms) servo signal. Jitter-free (pure hardware, no ISR).
//
// Corrected sketch-pin -> STM32 -> timer map (via Zephyr digital-pin list):
//   base     pin 3  = PB0  = TIM3_CH3
//   elbow    pin 9  = PB8  = TIM4_CH3
//   shoulder pin 10 = PB9  = TIM4_CH4
//   gripper  pin 11 = PB15 = TIM1_CH3N  (complementary output)
//
// After setup, positions are updated by writing CCRx directly - NEVER call
// analogWrite() on these pins again (it would restore the 500 Hz prescaler).

#include <Arduino.h>

#define REG(base, off) (*(volatile uint32_t *)((base) + (off)))
#define O_CR1   0x00
#define O_EGR   0x14
#define O_CCMR2 0x1C
#define O_CCER  0x20
#define O_PSC   0x28
#define O_ARR   0x2C
#define O_CCR3  0x3C
#define O_CCR4  0x40
#define O_BDTR  0x44

#define TIM1_BASE 0x40012C00UL   // advanced: needs BDTR.MOE. gripper CH3N
#define TIM3_BASE 0x40000400UL   // base CH3
#define TIM4_BASE 0x40000800UL   // elbow CH3 + shoulder CH4

static const uint32_t PSC_50 = 159;    // 160 MHz / 160 = 1 MHz -> 1 us / tick
static const uint32_t ARR_50 = 19999;  // 20000 us -> 20 ms -> 50 Hz

// degrees -> pulse us (matches Servo attach(500,2500): 0deg=500us,180deg=2500us)
static uint32_t us(int deg) { return 500u + (uint32_t)deg * 2000u / 180u; }

static void gpTimer50Hz(uint32_t base) {   // general-purpose timer common setup
  REG(base, O_CR1) &= ~1u;                 // CEN=0 while reconfiguring
  REG(base, O_PSC) = PSC_50;
  REG(base, O_ARR) = ARR_50;
  REG(base, O_CR1) |= (1u << 7);           // ARPE
}

static void setup50Hz() {
  // 1) one-time mux + device/clock init via the Arduino path
  analogWrite(3, 90);    // PB0  -> TIM3_CH3
  analogWrite(9, 90);    // PB8  -> TIM4_CH3
  analogWrite(10, 90);   // PB9  -> TIM4_CH4
  analogWrite(11, 90);   // PB15 -> TIM1_CH3N
  delay(10);

  // 2) TIM3: base on CH3 (normal, active-high)
  gpTimer50Hz(TIM3_BASE);
  { uint32_t m = REG(TIM3_BASE, O_CCMR2); m &= ~0x00FFu; m |= (6u << 4) | (1u << 3); REG(TIM3_BASE, O_CCMR2) = m; }
  REG(TIM3_BASE, O_CCR3) = us(90);
  REG(TIM3_BASE, O_CCER) |= (1u << 8);     // CC3E
  REG(TIM3_BASE, O_EGR)  = 1u;             // UG: latch PSC/ARR
  REG(TIM3_BASE, O_CR1) |= 1u;             // CEN

  // 3) TIM4: elbow CH3 + shoulder CH4 (normal)
  gpTimer50Hz(TIM4_BASE);
  { uint32_t m = REG(TIM4_BASE, O_CCMR2);
    m &= ~0x00FFu; m |= (6u << 4)  | (1u << 3);    // CH3 PWM1 + preload
    m &= ~0xFF00u; m |= (6u << 12) | (1u << 11);   // CH4 PWM1 + preload
    REG(TIM4_BASE, O_CCMR2) = m; }
  REG(TIM4_BASE, O_CCR3) = us(130);        // elbow
  REG(TIM4_BASE, O_CCR4) = us(90);         // shoulder
  REG(TIM4_BASE, O_CCER) |= (1u << 8) | (1u << 12);  // CC3E, CC4E
  REG(TIM4_BASE, O_EGR)  = 1u;
  REG(TIM4_BASE, O_CR1) |= 1u;

  // 4) TIM1: gripper on CH3N (complementary output, advanced timer)
  gpTimer50Hz(TIM1_BASE);
  { uint32_t m = REG(TIM1_BASE, O_CCMR2); m &= ~0x00FFu; m |= (6u << 4) | (1u << 3); REG(TIM1_BASE, O_CCMR2) = m; }
  REG(TIM1_BASE, O_CCR3) = us(95);
  REG(TIM1_BASE, O_CCER) |= (1u << 10);    // CC3NE (complementary out), CC3NP=0
  REG(TIM1_BASE, O_BDTR) |= (1u << 15);    // MOE (main output enable)
  REG(TIM1_BASE, O_EGR)  = 1u;
  REG(TIM1_BASE, O_CR1) |= 1u;
}

static inline void baseUs(uint32_t u)     { REG(TIM3_BASE, O_CCR3) = u; }
static inline void elbowUs(uint32_t u)    { REG(TIM4_BASE, O_CCR3) = u; }
static inline void shoulderUs(uint32_t u) { REG(TIM4_BASE, O_CCR4) = u; }
static inline void gripperUs(uint32_t u)  { REG(TIM1_BASE, O_CCR3) = u; }

void setup() {
  Serial.begin(115200);
  setup50Hz();
  Serial.println("# reg-hack 50Hz on all 4 servos");
}

void loop() {
  // sweep all 4 within SAFE sub-ranges to confirm clean 50 Hz motion
  for (int i = 0; i <= 100; i++) {
    baseUs(us(70 + 40 * i / 100));       // 70..110
    shoulderUs(us(60 + 60 * i / 100));   // 60..120
    elbowUs(us(100 + 60 * i / 100));     // 100..160
    gripperUs(us(100 + 45 * i / 100));   // 100..145
    delay(25);
  }
  for (int i = 100; i >= 0; i--) {
    baseUs(us(70 + 40 * i / 100));
    shoulderUs(us(60 + 60 * i / 100));
    elbowUs(us(100 + 60 * i / 100));
    gripperUs(us(100 + 45 * i / 100));
    delay(25);
  }
}
