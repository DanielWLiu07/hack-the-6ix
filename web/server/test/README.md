# Hub test suite (owner: server-test)

Standalone npm package on purpose - its deps never touch `web/server/package.json`.

```bash
cd web/server/test
npm install          # once
npm test             # everything (~90s with live server; skips cleanly if hub is down)
npm run test:conformance
npm run test:robustness
npm run test:integration   # phase-2: nl_command/nl_action routing + robot persistence (spawns a private hub)
npm run test:base44        # phase-2: Base44 Orchard OS webhook forwarder
```

Point at a non-default hub with `SERVER_URL=http://host:3001 npm test`.

## What's here

- `schemas.js` - validators for every Socket.IO event in root `CLAUDE.md` (the source of truth; if these disagree with it, these are wrong). Strict: unknown keys are errors.
- `schemas.test.js` - validator self-tests, no server needed.
- `conformance.test.js` - against the live hub: sim payloads pass schemas; every event type relays robot<->web verbatim. `nl_command` is exempt from verbatim relay (routes through FarmHand).
- `robustness.test.js` - reconnect storms, malformed/oversized payloads: hub must survive and must not relay schema-invalid garbage.
- `integration.test.js` - phase-2 end-to-end paths against a **private hub instance** the test spawns (`helpers.spawnHub`, Base44 forced OFF so test pick_events never hit the real Orchard OS webhook): the FarmHand NL path (`nl_command` ui->agent, `nl_action` fan-out to ui + robot with the mapped `pick`/`estop` control, `ok:false`/`clarification`/non-agent-spoof all correctly NOT forwarded) and the robot-client path (`pick_event`/`detection` persist to `/api/picks`/`/api/detections`, ui control reaches the robot, health reflects the robot). Runs on a private hub because the shared `:3001` hub runs with Base44 forwarding ON and needs determinism.
- `base44.test.js` - the `web/server/base44.js` forwarder in isolation against a throwaway local webhook: disabled unless `BASE44_WEBHOOK_URL` set, exact PickReport body per `docs/BASE44.md` (`{job_id?,fruit,ripeness,bin,success,ts}` - no `duration_ms` leak), `X-Base44-Secret` header, and fire-and-forget resilience (500 / unreachable / timeout never throw).
- `helpers.js` - client helpers (`connect`/`connectTo`), `spawnHub()`, `nl_action` validator wiring, and canonical `SAMPLES` payloads (usable by other workers as fixtures).

Quick stack health check (for master): `./scripts/check-stack.sh` from repo root.

Findings get filed in `status/server-test.md` - this package never fixes server code.

## Known timing

Sim cadence (measured): telemetry 5 Hz, detection ~every 10 s, pick_event per full pick cycle (>30 s possible - absence in the window is a warning, not a failure).
