# FarmHand client (`ml/freesolo-agent/client/`)

Natural-language command -> validated robot action, with strict schema validation
between the LLM and the robot. Two pieces:

- **`farmhand.py`** - core translator (pure stdlib, zero deps).
  - `FARMHAND_URL` set -> calls the Freesolo (OpenAI-compatible) chat endpoint with
    the trained model, then validates the output.
  - `FARMHAND_URL` unset -> deterministic built-in rules (works offline).
  - Endpoint error/timeout -> graceful fallback to the built-in rules
    (`FARMHAND_FALLBACK=1` default), so the NL box never dies mid-demo.
  - Every model output is validated against the action schema; anything invalid
    (bad JSON, out-of-enum, extra keys, prompt injection) is rejected and never
    reaches the robot.
- **`service.py`** - Socket.IO client that connects to the hub (`SERVER_URL`,
  default `http://localhost:3001`), answers `nl_command` with `nl_action`,
  auto-reconnects, and warms the model on connect so the first command is fast.

## Deploy on the robot: minimal config, run the preflight

**The only thing you configure is the key + endpoint**, in a git-ignored `.env`
(everything else has a working default):

```sh
cp .env.example .env      # then set FREESOLO_API_KEY, FARMHAND_URL, FARMHAND_MODEL
```

| Var | Needed? | Default |
|---|---|---|
| `FREESOLO_API_KEY` | for the trained model | (mock mode if unset) |
| `FARMHAND_URL` | for the trained model | (mock mode if unset) |
| `FARMHAND_MODEL` | for the trained model | - |
| `SERVER_URL` | only if the hub is not localhost | `http://localhost:3001` |
| `FARMHAND_FALLBACK` / `FARMHAND_JSON_MODE` / `FARMHAND_TIMEOUT` | no | `1` / `1` / `20` |

**Then run the preflight ONCE - it catches every config problem on the ground:**

```sh
.venv/bin/python selftest.py     # green = safe to demo; red = prints the fix
```

It checks: `.env` present, key not masked/truncated, endpoint reachable, model
returns the right action, fallback works, hub reachable. `demo.sh up` starts the
service automatically (and bootstraps the venv on a fresh clone) - no manual steps.

## Quickstart / test

```sh
python3 farmhand.py "grab every ripe banana"     # one-liner, prints the action
.venv/bin/python -m unittest test_farmhand        # 32 unit tests (incl. adversarial)
.venv/bin/python service.py                        # run the service (auto-reconnect)
```

## `nl_action` payload (emitted back to the hub)

```jsonc
{"ts": 0, "text": "pick all ripe apples", "ok": true,
 "action": {"task":"pick","fruit":"apple","filter":"ripe","zone":"any"}}  // do it
{"ts": 0, "text": "pick the fruit", "ok": true,
 "clarification": "Which fruit - apples, bananas, or both?"}              // ask user
{"ts": 0, "text": "...", "ok": false, "error": "invalid_model_output"}     // drop it
```

`ok:true` + `action` = execute; `ok:true` + `clarification` = ask; `ok:false` =
rejected. A `fallback` key is added when the built-in rules answered because the
endpoint was unreachable. Action schema: `task` in pick|sort|stop|drive, `fruit`
in apple|banana|any, `filter` in ripe|unripe|any, `zone` in
any|left|right|forward|backward|home. Validated actions always carry all 4 keys.

## Wire format

Freesolo serves an OpenAI-compatible API: `POST <FARMHAND_URL>/chat/completions`,
`Authorization: Bearer <FREESOLO_API_KEY>`, `model=<FARMHAND_MODEL>`. All of that
lives in `endpoint_model()` in `farmhand.py` - the single place to change if the
serving shape ever differs. Training pipeline: `../training/` (see its README).
