# FarmHand client (`ml/freesolo-agent/client/`)

NL command → structured robot action, with strict schema validation between the
LLM and the robot. Two pieces:

- **`farmhand.py`** - core translator. Zero dependencies (pure stdlib).
  - `FARMHAND_URL` unset → deterministic mock regex rules (works today).
  - `FARMHAND_URL` set → POSTs `{"text": ...}` to the teammate's Freesolo model
    endpoint (`FARMHAND_API_KEY` optional bearer token, `FARMHAND_TIMEOUT` secs).
  - Every model output is validated against the action schema; anything invalid
    is rejected with `{"ok": false, "error": ...}`. Raw LLM output never
    reaches the robot.
- **`service.py`** - Socket.IO client that connects to the laptop hub
  (`SERVER_URL`, default `http://localhost:3001`), listens for `nl_command`
  `{"text": ...}`, and emits back `nl_action` (see below). Auto-reconnects.

## Quickstart

```sh
# one-liner test, no deps:
python3 farmhand.py "grab every ripe banana"

# unit + validation tests (23):
python3 -m unittest test_farmhand -v

# run the service (needs python-socketio):
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python service.py
```

## `nl_action` payload (emitted back to the hub)

```jsonc
{"ts": 0, "text": "pick all ripe apples", "ok": true,
 "action": {"task":"pick","fruit":"apple","filter":"ripe"}}          // do it
{"ts": 0, "text": "pick the fruit", "ok": true,
 "clarification": "Which fruit - apples, bananas, or both?"}          // ask user
{"ts": 0, "text": "...", "ok": false, "error": "invalid_model_output"} // drop it
```

Action schema (aligned with llm-data's dataset, status/llm-data.md 22:12):
`task ∈ pick|sort|stop|drive`, `fruit ∈ apple|banana|any`,
`filter ∈ ripe|unripe|any`, `zone ∈ any|left|right|forward|backward|home`.
Validated actions always carry all 4 keys; missing fruit/filter/zone default to
`any`. `mock: true` is added when the built-in rules answered instead of the
real model.

## Swapping in the teammate's real model

Set `FARMHAND_URL`. If their request/response format differs from
`{"text": ...}` → JSON body, adjust `endpoint_model()` / `parse_model_body()`
in `farmhand.py` - that's the only place the wire format lives. Open questions
for them are in `../NOTES.md`.
