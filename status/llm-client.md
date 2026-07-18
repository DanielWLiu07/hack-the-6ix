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
