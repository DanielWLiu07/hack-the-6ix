# BRIDGE.md — MCU ↔ Linux RPC protocol (UNO Q)

**Owner: fw-tools. This document is the contract.** `fw-mcu` (STM32 sketch) and
`fw-linux` (Python) both conform to it. If something here must change, post a
BLOCKED status entry and let master arbitrate — do not drift silently.

There are two transports for the *same* command set:

1. **App Lab Bridge RPC** — the real thing, used on the UNO Q between the
   QRB2210 Linux side and the STM32U585 sketch. This is the Qualcomm-track
   judging boundary.
2. **Serial bench protocol** — plain text over USB serial, implemented by the
   sketch's bench-test mode. Lets us exercise the MCU with no Linux side
   (fw-tools' `bench.py` drives it, humans can type it into a monitor).

Semantics (names, args, units, timing, error behavior) are identical on both.

---

## 1. Conventions & units

| Quantity | Type | Range / unit |
|---|---|---|
| Drive command `l`, `r` | float | −1.0 … +1.0 normalized tank drive. +1 = full forward. MCU maps to PWM+direction. |
| Joint angles `joints[5]` | int | degrees, 0–180. Order: `[base, shoulder, elbow, wrist, gripper]` (PCA9685 ch 0–4). |
| `duration_ms` | int | 100 … 5000. Time to interpolate from current pose to target. MCU clamps out-of-range values. |
| Distance | int | cm (ultrasonic). |
| Battery | int | millivolts. `0` = not sensed (battery ADC is optional, see PINOUT.md). |

Rules both sides rely on:

- **All RPC calls return in < 50 ms.** No call ever blocks on physical motion.
  `move_servos` *starts* an interpolated move and returns immediately; the MCU
  steps servos every 20 ms until the target is reached (never snaps — snapping
  browns out the rail and drops fruit).
- A new `move_servos` **preempts** an in-progress move: interpolation retargets
  from the current interpolated pose. Same for `set_drive` (last write wins).
- Out-of-range args are **clamped**, not rejected (hackathon: keep the robot
  moving). The one exception: wrong arg *count/type* → error return.

## 2. MCU safety state machine

The MCU is always in exactly one state. This is the value returned by
`heartbeat()` / `get_status()` and it gates what commands do.

| # | State | Entered when | Effect |
|---|---|---|---|
| 0 | `OK` | normal | everything works |
| 1 | `OBSTACLE` | ultrasonic < **15 cm** (reflex, <10 ms, no Linux round-trip) | forward drive components are zeroed (reverse & turn-in-place still allowed); arm unaffected. Auto-clears when distance > **25 cm** (hysteresis). |
| 2 | `WATCHDOG` | no `heartbeat()` for **500 ms** | drive PWM → 0; servos **hold last pose** (never go limp — a limp arm drops the fruit and itself). Auto-clears on next `heartbeat()`. |
| 3 | `ESTOP` | `estop()` received (from Linux or serial) | drive → 0, servo interpolation frozen at current pose, all motion commands ignored. **Latched**: only `clear_estop()` exits it. |

Priority: `ESTOP` > `WATCHDOG` > `OBSTACLE` > `OK`. Flags for the lower states
are still tracked and reported in `get_status()` while a higher state is active.

## 3. RPC surface (Linux → MCU)

| Call | Args | Returns | Notes |
|---|---|---|---|
| `set_drive(l, r)` | float, float | int state (see §2) | Ignored (returns state) unless state is `OK`/`OBSTACLE`. In `OBSTACLE`, forward components are zeroed. |
| `move_servos(joints, duration_ms)` | int[5], int | int state | Starts interpolated move. Ignored in `ESTOP`/`WATCHDOG`. |
| `heartbeat()` | — | int state | Linux calls at **5 Hz** (same tick as telemetry). Feeds the 500 ms watchdog. |
| `estop()` | — | int state (always 3) | Immediate. Also emitted by fw-linux when it receives the Socket.IO `estop` event. |
| `clear_estop()` | — | int state | Exits `ESTOP` (to whatever lower state applies). Does **not** resume prior motion — Linux must re-command. |
| `get_status()` | — | int[10] (below) | Poll at 5 Hz for telemetry; don't poll faster than 20 Hz. |
| `zero_all()` | — | int state | Interpolated move of all 5 servos to 90° over 1500 ms. For assembly/horn alignment. |

`get_status()` return, fixed order:

```
[ state, battery_mv, j0, j1, j2, j3, j4, drive_l_pct, drive_r_pct, ultra_cm ]
   §2      mV (0=n/a)   current interpolated      −100…100 int      cm, 999 =
                        joint degrees (int)       (l/r × 100)       no echo
```

fw-linux maps this straight into the root-schema `telemetry` event
(`arm` = j0…j4, `drive.l/r` = pct/100, `state` string comes from fw-linux's own
task state machine, except MCU state 3 → `"ESTOP"` always wins).

**No MCU→Linux push calls in v1.** Linux learns everything by polling
`get_status()` at 5 Hz. (Reflex/watchdog protection is already local to the
MCU, so push adds no safety; polling keeps both sides simpler. If we later
want instant obstacle events, we'll add a Bridge notification `on_state(state)`
— coordinate via status files first.)

### Timeout & error behavior (Linux side — fw-linux implements)

- Per-call timeout **250 ms** → retry once → if the retry also fails, mark
  bridge **DOWN**: stop issuing motion calls, set telemetry `state` to
  `"ESTOP"`, retry `heartbeat()` at 1 Hz until it answers, then mark UP and
  resume. (MCU watchdog has already frozen motion 500 ms in, so this is safe.)
- Malformed return (wrong length/type) → treat as timeout.
- Never queue motion commands while DOWN — drop them. Stale motion is worse
  than no motion.

## 4. App Lab Bridge binding (the real transport)

The UNO Q's Arduino App Lab runtime ships an RPC bridge between the Linux
container and the sketch. Register each call in §3 by **exactly these string
names**: `"set_drive"`, `"move_servos"`, `"heartbeat"`, `"estop"`,
`"clear_estop"`, `"get_status"`, `"zero_all"`.

Sketch side (shape per App Lab's RPC examples):

```cpp
#include <Arduino.h>
// App Lab bridge header per the installed runtime's RPC example
Bridge.provide("set_drive", set_drive);      // float,float -> int
Bridge.provide("move_servos", move_servos);  // array[5],int -> int
// ... one provide() per call in §3
```

Python side (fw-linux):

```python
from arduino.app_utils import Bridge   # per App Lab runtime
state = Bridge.call("heartbeat")       # blocking call, returns int
```

> ⚠️ **Verify the exact API names** (`Bridge.provide` / `Bridge.call` /
> import path) against the RPC example bundled with the App Lab version
> installed on our UNO Q before writing lots of code — Arduino has renamed
> these between releases. **The §1–§3 semantic contract is normative; this
> section's identifiers are descriptive.** Whoever touches the board first
> (likely fw-tools during setup) posts the confirmed names in their status
> file; both firmware workers then align.

Until the board is in hand, fw-linux codes against a `MockBridge` with the §3
signatures, and fw-mcu structures the sketch so each RPC handler is a plain
function — bindable to either App Lab Bridge or the serial parser below.

## 5. Serial bench protocol (fallback + bench-test transport)

USB CDC serial, **115200 baud**, newline-terminated ASCII, single-letter
commands, space-separated args. Implemented by fw-mcu's bench mode; identical
handler functions behind it as §4. Human-typeable in any serial monitor.

### Commands (host → MCU)

```
D <l> <r>                      set_drive        e.g.  D 0.5 -0.5
S <j0> <j1> <j2> <j3> <j4> <ms>  move_servos    e.g.  S 90 45 120 90 30 1000
H                              heartbeat
E                              estop
C                              clear_estop
Q                              get_status
Z                              zero_all
?                              help (list commands, non-normative)
```

### Responses (MCU → host)

Every command gets exactly one response line:

- Success: `OK <state>` — e.g. `H` → `OK 0`
- `Q` → `ST <state> <battery_mv> <j0> <j1> <j2> <j3> <j4> <l_pct> <r_pct> <ultra_cm>`
  (space-separated, same order as §3 `get_status`)
- Error: `ERR <code> <msg>` — codes: `1` bad arg count, `2` unparseable arg,
  `3` unknown command.

The MCU never prints unsolicited lines (keeps parsing trivial), **except** one
boot banner `# uno-q-mcu bench <version>` on reset, and lines starting with
`#` which hosts must ignore (debug).

## 6. Rate summary

| What | Rate |
|---|---|
| `heartbeat()` from Linux | 5 Hz (watchdog trips at 500 ms ≈ 2.5 missed beats) |
| `get_status()` poll | 5 Hz (telemetry tick) |
| Servo interpolation step (MCU-internal) | every 20 ms |
| Ultrasonic poll (MCU-internal) | ≥ 20 Hz |
| `set_drive` from teleop | ≤ 10 Hz (dashboard emits 10 Hz; MCU just takes last-write-wins) |
