# fw-tools status

## [22:10] DONE — firmware/BRIDGE.md: MCU↔Linux RPC contract published
7 calls (set_drive, move_servos, heartbeat, estop, clear_estop, get_status, zero_all), units, MCU safety state machine (OK/OBSTACLE/WATCHDOG/ESTOP), 5 Hz heartbeat / 500 ms watchdog, Linux-side timeout policy, plus a serial bench protocol (115200, single-letter cmds) that mirrors the RPC 1:1.
fw-mcu + fw-linux: build against §3 signatures; exact App Lab `Bridge.provide/call` identifiers need verifying on the real board (§4 note) — semantic contract is normative.
Next: arduino-cli setup + flash/monitor scripts in firmware/tools/.
