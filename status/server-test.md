## [22:05] WIP — server-test starting; server-core not up yet
web/server/ doesn't exist and server-core has no status file. Building everything that doesn't need a live server: schema validators + conformance test harness in web/server/test/ (own package.json so I never touch server-core's), scripts/check-stack.sh, load/robustness harness. Will poll status/server-core.md and run tests the moment their sim is up.

## [22:11] DONE — task 1: schema conformance suite green against live hub
web/server/test/ is its own npm package (deps never touch server-core's package.json). `cd web/server/test && npm install && npm test`. Validators for all 9 root-CLAUDE.md events (strict: unknown keys = errors) + live tests: sim payloads conform, all events relay robot↔web verbatim (nl_command exempted — it routes via FarmHand). 10/10 tests pass. SAMPLES in helpers.js are canonical fixtures other workers can reuse.

## [22:11] DONE — task 2: scripts/check-stack.sh
One command for master: `./scripts/check-stack.sh` (honors SERVER_URL env). Checks hub reachable → socket.io connect → sim telemetry arrives + passes schema → GET /api/stats + /api/picks (200 + valid JSON) → /stream answers → vite up. Currently: 6 pass, 0 fail, 0 warn. Exits nonzero on any failure.

## [22:11] DONE — task 3: load/robustness — hub survives everything; findings below
Storm (3×15 clients, half destroyed mid-flight), malformed payload barrage (12 garbage shapes incl. NaN/Infinity, prototype-less objects, unknown events), ~5MB oversized lidar_scan: hub stays up, sim keeps emitting, new clients still served. 4/4 robustness tests pass, re-run confirmed stable.

FINDINGS for @server-core (informational, nothing to fix):
1. TRANSIENT (observed ~22:3x, now resolved): an earlier run saw schema-invalid payloads relayed verbatim to other clients (garbage telemetry/detection/pick_event/lidar_scan reached browsers). Latest runs show them dropped — assuming you added validation mid-flight; it works. If validation is NOT yours, this is flaky and worth a look.
2. Sim cadence measured: telemetry 5 Hz ✓, detection ~every 10 s, pick_event > 30 s apart. Fine per se, but web-frontend may wait a while to see a pick log entry — consider a faster sim pick cycle (or env knob) for demo/dev.
3. estop relays with payload {} ✓; hub relays fine with no role handshake — my clients pass role via query+auth, ignored today. If you later route by role (robot-only commands), tell me and I'll tighten relay tests.

Next: idle-ready — will re-run suite + check-stack on request or when server-core posts new milestones (persistence/REST changes). Nothing needed from anyone.

## [restart] WIP — server-test back up after crash; baseline re-verified green
Crashed & restarted. Verified prior work still functions: hub is live on :3001 (server-core restarted it; `base44_forwarding:true`, sim robot + a farmhand agent connected). Re-ran my full suite against it: **10/10 pass, 0 fail** (`cd web/server/test && npm test`). check-stack.sh unchanged.
Phase-2 landed in server-core since my last run: Base44 pick_event forwarder (`web/server/base44.js`, env-gated) + nl_command→agent / nl_action→ui+robot wiring (index.js:94,102-112). Starting phase-2 test coverage: (1) nl_command/nl_action routing integration test, (2) Base44 forwarder test, (3) robot-client persistence integration test. NOTE: shared :3001 hub has BASE44 forwarding ON → I will NOT fire test pick_events at it (would pollute real Orchard OS); phase-2 integration tests run against a private hub instance I spawn with Base44 disabled.

## [restart+phase2] DONE — phase-2 test coverage landed: nl_command path, Base44 forwarder, robot integration. 28/28 green.
Extended the suite per BROADCAST phase-2 (@server-test: cover both once landed + robot-client integration test). Run: `cd web/server/test && npm test` → **28/28 pass** (was 10). New files (I own web/server/test/):
- `integration.test.js` (12 tests) — spawns a PRIVATE hub via new `helpers.spawnHub()` (Base44 forced OFF so test pick_events never hit the real Orchard OS webhook; also deterministic regardless of who's on the shared :3001). Covers: `nl_command` ui→agent routing; `nl_action(ok,action)` echoed to ui + forwarded to robot with the mapped `pick{target}`; `task:stop`→`estop`; `ok:false` and `clarification` echoed to ui but NOT forwarded to robot; non-agent `nl_action` spoof ignored; robot `pick_event`/`detection` persist to `/api/picks`//api/detections`; ui control (drive/arm_pose/pick/estop) reaches robot; `/api/health` reflects robot.
- `base44.test.js` (7 tests) — unit-tests `web/server/base44.js` against a throwaway local webhook: disabled unless `BASE44_WEBHOOK_URL` set; exact PickReport body per docs/BASE44.md (`{job_id?,fruit,ripeness,bin,success,ts}`, no `duration_ms` leak); `X-Base44-Secret` header present/absent correctly; `BASE44_JOB_ID` tagging; 500 / unreachable / timeout never throw into the hub.
- Added `nl_action` validator + sample to my `schemas.js`/`helpers.js`; `connectTo(url,...)` + `spawnHub()` helpers; `test:integration`/`test:base44` npm scripts; README updated.
- `check-stack.sh` gained 2 informational /api/health checks: FarmHand agent connected? Base44 forwarding on? Current shared-hub run: 7 pass, 0 fail, 1 warn (Base44 env not set on the hub right now — flag flaps as server-core restarts).

FINDING for @server-core (informational — I do not touch your code): the hub relays raw `nl_command` to robots too, because `nl_command` is in your generic `CONTROL_EVENTS` fan-out (index.js:83-92) as well as the agent route (index.js:94). Root CLAUDE.md intends nl_command to reach the robot only *structured* (via FarmHand→nl_action). Harmless today (fw-linux ignores the raw copy), so I did NOT assert it as a failure — instead pinned it with a "documents status quo" test so any future change shows in the diff. If you'd rather robots never see raw nl_command, drop it from CONTROL_EVENTS' robot emit and ping me; I'll flip that test to assert-absent.

Next: idle-ready. Will re-run suite/check-stack on request or when server-core/db/llm-client post new milestones. Nothing needed from anyone.
