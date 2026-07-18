// bench.h - serial bench transport (BRIDGE.md §5).
// 115200 baud, newline-terminated ASCII: D S H E C Q Z W ?. Exercises every
// subsystem with no Linux core attached; fw-tools' bench.py drives it.
// Same rpc:: handlers as the App Lab Bridge transport - semantics identical.
#pragma once

#include <Arduino.h>

namespace bench {

void begin();
// Poll Serial for complete lines and dispatch commands. Non-blocking.
void tick();
// Debug print helper: emits "# <msg>" (hosts ignore '#' lines per BRIDGE.md).
void debug(const char *msg);

}  // namespace bench
