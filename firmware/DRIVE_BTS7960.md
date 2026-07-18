# DRIVE_BTS7960.md — drive base wiring & pin map (BTS7960 / IBT-2)

The rover's two drive motors use **BTS7960 / IBT-2** H-bridge drivers
([Amazon B0C9TPQK9M](https://www.amazon.ca/dp/B0C9TPQK9M)), one per motor. This
supplements [`PINOUT.md`](PINOUT.md), which assumes a TB6612/L298-style
(IN1/IN2/EN) driver — the BTS7960 is different and needs the notes below.

> ⚠️ The BTS7960 is a **dual-PWM** driver. Both enables must be HIGH and
> direction is set by *which* of RPWM/LPWM carries the PWM. The stock
> `firmware/mcu` IN1/IN2/PWM logic does **not** drive it (it leaves one
> half-bridge disabled → no current path → no spin). See "Firmware" below.

## Wiring — do BOTH drivers identically except the two signal pins

### Signal header (VCC GND R_IS L_IS R_EN L_EN RPWM LPWM)
| Driver pin | LEFT → Uno Q | RIGHT → Uno Q | Notes |
|---|---|---|---|
| VCC  | **3.3V** | **3.3V** | logic supply — 3.3 V to match Uno Q logic (not 5 V) |
| GND  | **GND**  | **GND**  | common with battery − |
| R_EN | tie to VCC | tie to VCC | enable held HIGH (always enabled) |
| L_EN | tie to VCC | tie to VCC | enable held HIGH |
| RPWM | **D5** | **D6** | forward PWM |
| LPWM | **D7** | **D8** | reverse PWM |
| R_IS | — n/c  | — n/c  | current sense, unused |
| L_IS | — n/c  | — n/c  | unused |

### Power terminals (B+ B- M+ M-)
| Terminal | Connect to |
|---|---|
| B+ | Power supply **+11.1 V** |
| B− | Power supply **−** (ground) |
| M+ / M− | the motor's two leads (polarity arbitrary — fix direction in firmware) |

### Rules (protect the board)
1. **Common ground:** supply −, both drivers' B−, both drivers' GND, and Uno Q
   GND all tied together. Non-negotiable.
2. **11.1 V goes ONLY to B+/B−.** Never to VCC or a signal pin (those are 3.3 V).
3. Uno Q powered separately (USB or its own 5 V→USB-C buck); motor supply off
   while wiring.
4. Don't route motor power through a breadboard — its contacts are ~1–2 A and
   motor stall spikes are far higher. Split B+ at a terminal block / soldered
   pigtail. Add an inline fuse (~10–15 A) on the battery + lead.

## Uno Q PWM-capable pins
From the core `arduino:zephyr` 0.56.0 devicetree overlay, `analogWrite()` works
on: **D2, D3, D5, D6, D7, D8, D9, D10, D11, D12, D13** (each a real STM32U585
timer channel). **D4 is NOT PWM-capable.** The BTS7960 needs 2 PWM pins per
motor; D5/D7 (left) and D6/D8 (right) are all valid.

## Firmware
`firmware/mcu`'s stock `drive.cpp` drives IN1/IN2 (digital direction) + one PWM —
correct for TB6612/L298, wrong for BTS7960. For bring-up this was adapted to
**dual-PWM** in the `drivetest` App Lab app's own copy of `drive.cpp` (enables
tied HIGH in hardware; `forward → RPWM=|v|, LPWM=0`, `reverse → RPWM=0,
LPWM=|v|`, `stop → both 0`), pins as above. The canonical `firmware/mcu` was left
untouched.

**TODO(fw-mcu):** add a proper `DRIVE_BTS7960` mode to `config.h`/`drive.cpp`
(dual-PWM pins + enable handling) so the repo firmware drives this hardware
directly.

Direction fixes: if a wheel spins backwards, flip `M_L_INVERT`/`M_R_INVERT` in
`config.h` (don't rewire). If left/right are swapped, swap the pin pairs.

## Testing
Bundle `firmware/mcu` (with the BTS7960 `drive.cpp`) into an App Lab app and run
it — the Uno Q has no separate MCU USB serial, so the repo's `bench.py` won't
attach; drive via the Bridge RPC instead. The `drivetest` app streams
`heartbeat` + `set_drive` through a jog sequence (left-alone → right-alone →
both fwd → both back → spin) and prints `get_status` each step.
