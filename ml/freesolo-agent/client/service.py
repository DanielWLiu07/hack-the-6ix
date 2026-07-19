"""FarmHand Socket.IO service.

Connects to the laptop hub (the hub, web/server/ on :3001), listens for
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
import threading
import time

import socketio

import farmhand

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("farmhand.service")

SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:3001")

sio = socketio.Client(reconnection=True, reconnection_delay=1, reconnection_delay_max=5)

# Keep the Freesolo endpoint warm: Modal serving scales to zero when idle, and a
# cold first request can time out (-> fallback to rules). A periodic ping keeps
# the trained model responsive (~0.8s) throughout the demo. 0 disables.
KEEPALIVE_SECONDS = int(os.environ.get("FARMHAND_KEEPALIVE", "150"))
_keepalive_started = False


def _keepalive():
    if not os.environ.get("FARMHAND_URL"):
        return
    first = True
    while True:
        try:
            farmhand.handle("pick an apple")
            if first:
                log.info("model warmed up")
                first = False
        except Exception as e:  # never let keepalive break the service
            log.warning("keepalive ping failed: %s", e)
        if KEEPALIVE_SECONDS <= 0:
            return
        time.sleep(KEEPALIVE_SECONDS)


@sio.event
def connect():
    global _keepalive_started
    log.info("connected to %s", SERVER_URL)
    sio.emit("register", {"role": "farmhand"})
    if not _keepalive_started:
        _keepalive_started = True
        threading.Thread(target=_keepalive, daemon=True).start()


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
        log.error("cannot reach %s (%s) - is the hub up?", SERVER_URL, e)
        sys.exit(1)
    except KeyboardInterrupt:
        sio.disconnect()


if __name__ == "__main__":
    main()
