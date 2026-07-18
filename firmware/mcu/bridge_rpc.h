// bridge_rpc.h - App Lab Bridge transport binding (BRIDGE.md §4).
//
// Registers the §3 command set under exactly these names: "set_drive",
// "move_servos", "heartbeat", "estop", "clear_estop", "get_status",
// "zero_all". All semantics live in rpc_handlers.* - this file is only glue.
//
// Per the §4 caveat the concrete Bridge API (header name, provide/call
// signatures, array-arg support) must be verified against the App Lab
// runtime on OUR board; fw-tools posts the confirmed names during board
// setup. Until then this glue targets Arduino_RouterBridge and is
// compile-guarded: on a vanilla core it compiles away and the bench serial
// transport still provides the full command set.
#pragma once

namespace bridge_rpc {

void begin();
void tick();

}  // namespace bridge_rpc
