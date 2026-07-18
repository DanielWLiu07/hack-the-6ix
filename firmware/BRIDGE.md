# BRIDGE.md - MCU ↔ Linux RPC protocol (UNO Q)

**Owner: fw-tools. This document is the contract.** `fw-mcu` (STM32 sketch) and
`fw-linux` (Python) both conform to it. If something here must change, post a
BLOCKED status entry and let master arbitrate - do not drift silently.

There are two transports for the *same* command set:

1. **App Lab Bridge RPC** - the real thing, used on the UNO Q between the
   QRB2210 Linux side and the STM32U585 sketch. This is the Qualcomm-track
   judging boundary.
2. **Serial bench protocol** - plain text over USB serial, implemented by the
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
  steps servos every 20 ms until the target is reached (never snaps - snapping
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
| 2 | `WATCHDOG` | no `heartbeat()` for **500 ms** | drive PWM → 0; servos **hold last pose** (never go limp - a limp arm drops the fruit and itself). Auto-clears on next `heartbeat()`. |
| 3 | `ESTOP` | `estop()` received (from Linux or serial) | drive → 0, servo interpolation frozen at current pose, all motion commands ignored. **Latched**: only `clear_estop()` exits it. |

Priority: `ESTOP` > `WATCHDOG` > `OBSTACLE` > `OK`. Flags for the lower states
are still tracked and reported in `get_status()` while a higher state is active.

## 3. RPC surface (Linux → MCU)

| Call | Args | Returns | Notes |
|---|---|---|---|
| `set_drive(l, r)` | float, float | int state (see §2) | Ignored (returns state) unless state is `OK`/`OBSTACLE`. In `OBSTACLE`, forward components are zeroed. |
| `move_servos(joints, duration_ms)` | int[5], int | int state | Starts interpolated move. Ignored in `ESTOP`/`WATCHDOG`. |
| `heartbeat()` | - | int state | Linux calls at **5 Hz** (same tick as telemetry). Feeds the 500 ms watchdog. |
| `estop()` | - | int state (always 3) | Immediate. Also emitted by fw-linux when it receives the Socket.IO `estop` event. |
| `clear_estop()` | - | int state | Exits `ESTOP` (to whatever lower state applies). Does **not** resume prior motion - Linux must re-command. |
| `get_status()` | - | int[10] (below) | Poll at 5 Hz for telemetry; don't poll faster than 20 Hz. |
| `zero_all()` | - | int state | Interpolated move of all 5 servos to 90° over 1500 ms. For assembly/horn alignment. |

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
- coordinate via status files first.)

### Timeout & error behavior (Linux side - fw-linux implements)

- Per-call timeout **250 ms** → retry once → if the retry also fails, mark
  bridge **DOWN**: stop issuing motion calls, set telemetry `state` to
  `"ESTOP"`, retry `heartbeat()` at 1 Hz until it answers, then mark UP and
  resume. (MCU watchdog has already frozen motion 500 ms in, so this is safe.)
- Malformed return (wrong length/type) → treat as timeout.
- Never queue motion commands while DOWN - drop them. Stale motion is worse
  than no motion.

## 4. App Lab Bridge binding (the real transport) - VERIFIED on-desk

**MCU side** (verified by fw-tools against the shipped libraries, 17 Jul):
the bridge is the **`Arduino_RouterBridge`** library (Library Manager,
tested v0.4.3) - a Zephyr wrapper of `Arduino_RPClite` speaking
**MsgPack-RPC** to an rpclib-compatible router on the Linux side. FQBN
`arduino:zephyr:unoq` (core `arduino:zephyr` 0.56.0) compiles on a desktop
via `tools/flash.sh --check`, no board needed.

```cpp
#include <Arduino_RouterBridge.h>

void setup() {
  Bridge.begin();
  // provide_safe -> handler runs in the MAIN LOOP thread (where the 20 ms
  // control tick lives), so handlers can touch motion state without locks.
  // Plain provide() runs in a SEPARATE thread - don't use it for anything
  // that mutates drive/servo state.
  Bridge.provide_safe("set_drive", set_drive);        // (float,float)->int
  Bridge.provide_safe("move_servos", move_servos);    // (int×5, int)->int
  Bridge.provide_safe("heartbeat", heartbeat);        // ()->int
  Bridge.provide("estop", estop_handler);             // plain provide: must
                                                      // fire even if loop hangs
  Bridge.provide_safe("clear_estop", clear_estop);
  Bridge.provide_safe("get_status", get_status);      // ()->MsgPack::arr_t<int>[10]
  Bridge.provide_safe("zero_all", zero_all);
}
```

Note `provide_safe` handlers only run when the main loop services the bridge
- keep the loop tick ≤ 20 ms so RPC latency stays inside the §3 50 ms budget.
`estop` uses plain `provide` (separate thread) intentionally: it must work
even if the control loop wedges; its handler only sets a `volatile bool`.

**Wire signatures**: `move_servos` takes **6 flat int args**
`(j0,j1,j2,j3,j4,duration_ms)` - flat scalars marshal trivially on both
sides; conceptually it's still `joints[5] + duration_ms`. `get_status`
returns a 10-element MsgPack int array (`MsgPack::arr_t<int>`), order per §3.

**Linux side**: the router is rpclib/MsgPack-RPC compatible; App Lab's
Python wrapper (`arduino.app_utils` / `app_bridge` - exists only on the
board's Debian image, exact import TBC on first board contact) or, worst
case, a plain Python `msgpack-rpc` client against the router socket.
fw-linux: keep the transport behind your `MockBridge` interface so swapping
in the real client is one file.

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
W <0|1>                        watchdog disarm/arm (bench-only, see below)
?                              help (list commands, non-normative)
```

**Bench mode boots with the watchdog DISARMED** (else a human typing at
<2 Hz lives in `WATCHDOG` and every motion command is ignored). `W 1` arms it
(and resets its timer) for testing the watchdog path; `W 0` disarms. This
knob exists **only** in the serial bench transport - under App Lab Bridge the
watchdog is always armed, there is no `W` RPC.

### Responses (MCU → host)

Every command gets exactly one response line:

- Success: `OK <state>` - e.g. `H` → `OK 0`
- `Q` → `ST <state> <battery_mv> <j0> <j1> <j2> <j3> <j4> <l_pct> <r_pct> <ultra_cm>`
  (space-separated, same order as §3 `get_status`)
- Error: `ERR <code> <msg>` - codes: `1` bad arg count, `2` unparseable arg,
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
