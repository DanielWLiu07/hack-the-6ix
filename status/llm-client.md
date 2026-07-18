# llm-client status (owns ml/freesolo-agent/client/)

## [22:05] WIP — kickoff, building farmhand.py
Plan: (1) farmhand.py with mock regex mode + FARMHAND_URL endpoint mode + strict schema validation, (2) Socket.IO service wiring to server-core, (3) NOTES.md for teammate. Python 3.11.9, no socketio installed yet → will use a local venv inside my dir.

**@server-core — proposed nl_command interface (please confirm/veto in your status file):**
- I run a standalone Socket.IO client (`ml/freesolo-agent/client/service.py`) that connects to `http://localhost:3001` and emits `register` `{"role":"farmhand"}` on connect.
- Server forwards `nl_command` `{"text": "..."}` (from web) to me verbatim (broadcast is fine — I just listen for the event).
- I reply by emitting `nl_action`:
  ```jsonc
  {"ts": 0, "text": "<original text>", "ok": true,  "action": {"task":"pick","fruit":"apple","filter":"ripe"}}
  {"ts": 0, "text": "<original text>", "ok": true,  "clarification": "Apples, bananas, or both?"}
  {"ts": 0, "text": "<original text>", "ok": false, "error": "invalid_model_output"}
  ```
- Server forwards `nl_action.action` to the robot (fw-linux) and/or echoes `nl_action` to the web for display. Schema-validated on my side — server never sees raw LLM output.

## [22:11] DONE — Task 1: farmhand.py (mock + endpoint modes, strict validation)
`ml/freesolo-agent/client/farmhand.py` — zero-dep stdlib. Mock regex rules when `FARMHAND_URL` unset; POST `{"text":...}` to endpoint when set (`FARMHAND_API_KEY`/`FARMHAND_TIMEOUT` supported). Strict enum/whitelist validation; invalid model output → `{"ok":false}`, never forwarded. Handles clarifications (`{"clarify":...}`) and wrapped/prose model responses. **Aligned with llm-data's 22:12 schema note**: zone enum `any|left|right|forward|backward|home`, validated action always carries all 4 keys.
Verify: `python3 farmhand.py "grab every ripe banana"` · 23 unit tests: `python3 -m unittest test_farmhand` — all pass.

## [22:11] DONE — Task 2 (my side): service.py wired + integration-tested
`client/service.py` — Socket.IO client (`SERVER_URL` default :3001, auto-reconnect), emits `register {"role":"farmhand"}` on connect, answers `nl_command` with `nl_action` (also returned as an ack). Deps in `client/.venv` (`pip install -r requirements.txt`, python-socketio 5.16.3). Proven end-to-end against a stand-in Python hub (relay nl_command→me→nl_action→browser): 3/3 commands round-tripped correctly.
**WAITING on @server-core**: add the two relay lines per my 22:05 interface proposal above (forward `nl_command` to all clients, relay my `nl_action` back to web + robot). Ping me via status if you want ack-callback style instead — service already supports both.

## [22:11] DONE — Task 3: NOTES.md for teammate
`ml/freesolo-agent/NOTES.md` — 6 questions (endpoint URL/key, request format, response shape, clarification shape, schema confirmation, dataset format). Master: please relay to the Freesolo teammate. Wire-format lives in exactly one place (`endpoint_model`/`parse_model_body`) so their answers are a 5-line change.

## [22:12] DONE — Task 2 FULLY verified against server-core's REAL hub 🎉
Hub on :3001 is live and already relays both directions. Live smoke test: fake browser → hub `nl_command {"text":"pick all ripe apples"}` → my service → hub `nl_action` → browser received `{"ok":true,"action":{"task":"pick","fruit":"apple","filter":"ripe","zone":"any"}}`. No changes needed from @server-core — interface as proposed at 22:05 works as-is. To run for real: `cd ml/freesolo-agent/client && .venv/bin/python service.py`.

## [22:12] — All assigned tasks complete
Idle-ready. **FarmHand service is RUNNING in background (PID 60155, mock mode, connected to :3001)** — any `nl_command` emitted to the hub gets a live `nl_action` answer right now; @web-frontend can build/test the NL command box against it. Log: my scratchpad `service.log`. Next candidates if master wants: `--interactive` REPL for demo; hook llm-data's `eval.py` through farmhand's validator path; flip to real model the moment teammate answers NOTES.md (1 env var).

## [restart] WIP — recovered after crash, verifying + starting phase-2
Crash killed my background service.py (was PID 60155) and server-core's hub on :3001.
VERIFIED on-disk work intact: farmhand.py 23/23 unit tests pass; `farmhand.py "grab every ripe banana"` → correct action. Hub :3001 is DOWN (server-core's, they're restarting). My service auto-reconnects but exits if hub is down at launch — will relaunch once hub is back.
Phase-2 (per BROADCAST 22:32): end-to-end nl_command demo transcript, 10 commands hub→farmhand→robot mock. Building now.

## [restart+] DONE — recovery complete + phase-2 end-to-end demo transcript
Recovery: farmhand.py 23/23 tests pass; service.py RELAUNCHED and auto-reconnected through a hub restart (verified `agent:1` in /api/health after server-core cycled the hub — resilience proven). Noted server-core's Base44 forwarder is live (`base44_forwarding:true`).
Phase-2 deliverable (BROADCAST 22:32): `client/DEMO_TRANSCRIPT.md` — 10 commands driven through the LIVE hub via `client/demo_driver.py` (reproducible: `.venv/bin/python demo_driver.py DEMO_TRANSCRIPT.md`). Driver connects as a real `ui` client AND a `robot` observer, so it captures the ACTUAL hub→robot forward, not a simulation. Results: 7 valid actions forwarded to robot (with mapped basics: pick→`pick{target}`, stop→`estop`), 3 clarifications correctly withheld from robot, strict schema validation throughout. Full chain: web UI → hub → farmhand (mock+validate) → hub → UI echo + robot forward.
Service RUNNING (mock mode, connected :3001). Idle-ready. Flip to real model = 1 env var (`FARMHAND_URL`) once teammate answers NOTES.md.

## [phase-3] DONE — docs/DEVPOST.md skeleton + Freesolo sections + shot list
Created `docs/DEVPOST.md` (skeleton was mine to make first per BROADCAST phase-3). Contains: shared top matter (pitch/what-it-does/track-index) + my fully-written **Freesolo LLM** section and **FarmHand demo shot list**. All numbers are LIVE-pulled, not remembered:
- Dataset: train 2,349 / val 123 / eval 30 held-out / prefs 600 (DPO bonus); 2,752 assistant turns = 2,432 actions + 320 clarifications; task dist pick 1468/drive 550/sort 224/stop 190.
- Eval: regex baseline 28/30 (93.3%) exact, per-field task/fruit 100%, filter/zone 96.7% (re-ran eval.py --baseline just now).
- Integration table + shot list drawn from my DEMO_TRANSCRIPT.md (7 actions fwd, 3 clarify withheld, 0 invalid reached robot).
**@vision-infer**: file is ready — append your Qualcomm + Deloitte sections BELOW the marker comment. I left stub `##` headers with the exact anchors the track-index links expect (`## Qualcomm UNO Q track — on-device AI`, `## Deloitte AI-for-Green — quantified impact`) — keep those headers verbatim so the index links resolve; add your content under each. Ownership marker is at the top of the file.
Trained-model eval row left as TODO (flips from mock the moment teammate's endpoint lands). Idle-ready.

## [phase-4] DONE — docs/PITCH.md 3-minute pitch script
Wrote `docs/PITCH.md`: full 3:00 script following the mandated flow (env hook → live pick+sort → dashboard → MPU/MCU slide → FarmHand NL), with per-beat timings that sum to exactly 3:00, a timing-summary table, and speaker roles (A=story/impact, B=tech/demo, OP=silent operator).
Numbers kept consistent with docs/DEVPOST.md + vision-infer's sections: 30–40% food loss, ~5 W on-device, <10 ms e-stop, ~400 fruit/hr / ~60 kg waste-avoided/hr, FarmHand 93% held-out, validated-JSON safety catch. Added: per-track callout ("which line scores which prize"), 2:30 + 90s expo cut-downs, and an OP pre-flight checklist tied to the sim panic switch (server-core/docs/DEPLOY.md) and my DEMO_TRANSCRIPT.md as backup.
My FarmHand service still running/connected. Idle-ready.
