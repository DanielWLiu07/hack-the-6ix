// bridge_rpc.h — the MCU side of the Linux<->MCU App Lab Bridge RPC surface.
//
// Provided methods (units and semantics; final wire encoding is defined by
// fw-tools in firmware/BRIDGE.md — this file conforms to it):
//   set_drive(l: float, r: float) -> bool
//       Normalized tank drive in [-1,1]. Rejected (false) while stopped.
//   move_servos(j0..j4: float deg, duration_ms: int) -> bool
//       Interpolated pose move; false if a target was clamped or motion is
//       blocked. Scalar args, NOT an array — keeps msgpack encoding trivial.
//   heartbeat() -> int
//       Feed the watchdog; first call arms it. Returns safety state enum.
//   estop() -> bool
//       Latched stop: motors zeroed, servo PWM cut.
//   clear_estop() -> bool
//   get_status() -> string
//       Same "key=value ..." line as the bench 'p' command.
//
// Compiles away cleanly when the Bridge library is absent (bench-only build
// on a plain Arduino core): all calls become no-ops.
#pragma once

namespace bridge_rpc {

void begin();
void tick();

}  // namespace bridge_rpc
