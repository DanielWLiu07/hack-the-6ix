"""FarmHand Socket.IO service.

Connects to the laptop hub (server-core, web/server/ on :3001), listens for
`nl_command` {"text": "..."} events, runs them through farmhand.handle()
(mock rules or FARMHAND_URL endpoint + strict validation), and emits back:

  "nl_action" {"ts":..., "text":..., "ok":true, "action":{...}}
             | {"ts":..., "text":..., "ok":true, "clarification":"..."}
             | {"ts":..., "text":..., "ok":false, "error":"..."}

Env:
  SERVER_URL    hub URL           (default http://localhost:3001)
  FARMHAND_URL  model endpoint    (unset -> mock regex rules)

Run:  python3 service.py        (auto-reconnects forever; Ctrl-C to quit)
Deps: pip install -r requirements.txt   (python-socketio[client])
"""

import logging
import os
import sys

import socketio

import farmhand

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("farmhand.service")

SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:3001")

sio = socketio.Client(reconnection=True, reconnection_delay=1, reconnection_delay_max=5)


@sio.event
def connect():
    log.info("connected to %s", SERVER_URL)
    sio.emit("register", {"role": "farmhand"})


@sio.event
def disconnect():
    log.info("disconnected - will auto-reconnect")


@sio.on("nl_command")
def on_nl_command(data):
    text = data.get("text") if isinstance(data, dict) else None
    log.info("nl_command: %r", text)
    env = farmhand.handle(text)
    log.info("-> nl_action: %s", {k: v for k, v in env.items() if k != "ts"})
    sio.emit("nl_action", env)
    return env  # also provided as an ack for callers that use callbacks


def main():
    mode = "endpoint " + os.environ["FARMHAND_URL"] if os.environ.get("FARMHAND_URL") else "MOCK rules"
    log.info("FarmHand service starting (model: %s)", mode)
    try:
        sio.connect(SERVER_URL)
        sio.wait()
    except socketio.exceptions.ConnectionError as e:
        log.error("cannot reach %s (%s) - is server-core up?", SERVER_URL, e)
        sys.exit(1)
    except KeyboardInterrupt:
        sio.disconnect()


if __name__ == "__main__":
    main()
