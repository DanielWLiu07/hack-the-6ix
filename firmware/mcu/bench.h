// bench.h — serial bench-test console (115200 baud, newline-terminated).
// Exercises every subsystem with no Linux core attached. Also what
// fw-tools' Python bench client drives. Type '?' for the command list.
#pragma once

#include <Arduino.h>

namespace bench {

void begin();
// Poll Serial for complete lines and dispatch commands. Non-blocking.
void tick();

}  // namespace bench
