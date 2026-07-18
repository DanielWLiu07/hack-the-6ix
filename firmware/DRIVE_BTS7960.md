# DRIVE_BTS7960.md — drive base wiring & pin map (BTS7960 / IBT-2)

The rover's two drive motors (**2× 5840-31ZY, 12 V 400 RPM geared**) use
**BTS7960 / IBT-2** H-bridge drivers
([Amazon B0C9TPQK9M](https://www.amazon.ca/dp/B0C9TPQK9M)), one per motor. This
supplements [`PINOUT.md`](PINOUT.md), which assumes a TB6612/L298-style
(IN1/IN2/EN) driver — the BTS7960 is different and needs the notes below.

> ✅ **Validated on real hardware (2026-07-18):** dual-PWM wiring below confirmed
> working — both 12 V motors spin, driven from a standalone board. Proven so the
> replacement Uno Q is plug-and-play.

> ⚠️ The BTS7960 is a **dual-PWM** driver. Both enables must be HIGH and
> direction is set by *which* of RPWM/LPWM carries the PWM. The stock
> `firmware/mcu` IN1/IN2/PWM logic does **not** drive it (it leaves one
> half-bridge disabled → no current path → no spin). See "Firmware" below.

## Wiring — do BOTH drivers identically except the two signal pins

### Signal header (VCC GND R_IS L_IS R_EN L_EN RPWM LPWM)
| Driver pin | LEFT → MCU | RIGHT → MCU | Notes |
|---|---|---|---|
| VCC  | **logic V** | **logic V** | = the board's logic voltage: **3.3 V** (Uno Q / ESP32) or **5 V** (classic Uno). Never higher than the board. |
| GND  | **GND**  | **GND**  | common with battery − |
| R_EN | tie to VCC | tie to VCC | enable held HIGH (always enabled) |
| L_EN | tie to VCC | tie to VCC | enable held HIGH |
| RPWM | forward-PWM pin | forward-PWM pin | see pin maps below |
| LPWM | reverse-PWM pin | reverse-PWM pin | |
| R_IS | — n/c  | — n/c  | current sense, unused |
| L_IS | — n/c  | — n/c  | unused |

Match VCC to your board's logic level. A 3.3 V board into 5 V VCC makes its
signals *marginal* against the driver's ~3.5 V threshold → the driver may ignore
commands. (Under-volting never damages anything; over-volting fries.)

### Power terminals (B+ B- M+ M-)
| Terminal | Connect to |
|---|---|
| B+ | Power supply **+11.1 V** |
| B− | Power supply **−** (ground) |
| M+ / M− | the **motor's** two leads (NOT B+/B−; polarity arbitrary — fix direction in firmware) |

## ⚠️ Bring-up safety — learned the hard way (this cost us 2 boards)
During bring-up a **Uno Q and an ESP32 were both destroyed** by power/wiring
mistakes. Don't repeat them:

1. **Common ground on the HEAVY path.** battery− → both drivers' B− must be its
   own solid wire. If the only ground return runs through the MCU's thin logic
   ground, motor current routes through the board and **cooks it**.
2. **The 11 V rail (B+) must NEVER touch a logic line.** Before *every* power-on,
   meter **B+ ↔ VCC/3V3 rail → must be OPEN** (also B+ ↔ each signal wire). 11 V
   on a 3.3 V pin kills the board in milliseconds — faster than you can react.
3. **No motor power through a breadboard.** Contacts are ~1–2 A; stall spikes are
   far higher → heat, brownouts, melt. Split B+ at a **terminal block or soldered
   pigtail**. Put an **inline fuse (~10 A)** on battery +.
4. **Measure any buck/buck-boost output (DC volts) BEFORE connecting it.** They
   ship set to arbitrary/high voltages; a mis-set buck on the logic rail fries
   boards instantly. (Not needed for the drive base — board runs on USB, motors
   on 11 V direct, VCC from the board.)
5. **Staged power-up, every time:** (a) flash + validate the board *alone*;
   (b) wire to drivers with the **battery disconnected**, power the board on USB,
   **feel for heat** — cold after 30 s = logic side clean; (c) only then connect
   the battery, with the **wheels propped off the table** (it drives forward).
6. **Continuity checks (unpowered):** each driver VCC↔GND open; breadboard
   VCC↔GND open; B+↔any logic line open.

## Uno Q PWM-capable pins
From the core `arduino:zephyr` 0.56.0 devicetree overlay, `analogWrite()` works
on: **D2, D3, D5, D6, D7, D8, D9, D10, D11, D12, D13** (each a real STM32U585
timer channel). **D4 is NOT PWM-capable.** The BTS7960 needs 2 PWM pins per
motor; D5/D7 (left) and D6/D8 (right) are all valid.

## Firmware
`firmware/mcu`'s stock `drive.cpp` drives IN1/IN2 (digital direction) + one PWM —
correct for TB6612/L298, wrong for BTS7960. For bring-up it was adapted to
**dual-PWM** (enables tied HIGH in hardware; `forward → RPWM=|v|, LPWM=0`;
`reverse → RPWM=0, LPWM=|v|`; `stop → both 0`). The canonical `firmware/mcu` was
left untouched.

**TODO(fw-mcu):** add a proper `DRIVE_BTS7960` mode to `config.h`/`drive.cpp`
(dual-PWM pins + enables tied high) so the repo firmware drives this hardware
directly. Uno Q pins: LEFT RPWM=D5 LPWM=D7, RIGHT RPWM=D6 LPWM=D8.

Direction fixes: if a wheel spins backwards, flip the per-side invert flag in
software (don't rewire). If left/right are swapped, swap the pin pairs.

## Standalone bring-up test rig (no Uno Q needed)
To validate the drive base on any spare board while the Uno Q is unavailable, a
standalone dual-PWM sketch (analogWrite/LEDC) works. Verified pin maps:

| Board | LEFT RPWM/LPWM | RIGHT RPWM/LPWM | VCC + enables |
|---|---|---|---|
| **ESP32-C3 Supermini** (3.3 V) | GPIO4 / GPIO5 | GPIO6 / GPIO7 | 3V3 |
| **Classic Arduino Uno** (5 V) | D5 / D6 | D9 / D10 | 5V |

Logic: `forward → analogWrite(RPWM, duty), analogWrite(LPWM, 0)`; `reverse` swaps;
`stop → both 0`; enables tied to VCC in hardware. Confirmed on the C3 rig — both
motors spin.

## Testing on the Uno Q
Bundle `firmware/mcu` (with the BTS7960 `drive.cpp`) into an App Lab app and run
it — the Uno Q has no separate MCU USB serial, so the repo's `bench.py` won't
attach; drive via the Bridge RPC instead. The `drivetest` app streams
`heartbeat` + `set_drive` through a jog sequence (left-alone → right-alone →
both fwd → both back → spin) and prints `get_status` each step.
