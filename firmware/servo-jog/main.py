"""servo-jog Linux part - serves the slider UI and relays to the MCU over Bridge.

Sliders POST /servo {ch,deg} -> Bridge.call("set_servo", ch, deg).
Park button POST /park -> Bridge.call("park"). GET / -> the HTML page.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from arduino.app_utils import App, Bridge

PORT = 7000
JOINTS = [("base", "D3"), ("shoulder", "D10"), ("elbow", "D9"), ("gripper", "D11")]


def _angles():
    """Current MCU joint angles [base, shoulder, elbow, gripper], or None."""
    try:
        return [int(x) for x in Bridge.call("get_servos")]
    except Exception:  # noqa: BLE001
        return None

PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>servo jog</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; background:#0f1115; color:#e7e9ee; padding:18px; }
  h1 { font-size:1.1rem; margin:0 0 4px; }
  .sub { color:#8b93a3; font-size:.8rem; margin-bottom:18px; }
  .joint { background:#171a21; border:1px solid #232833; border-radius:12px; padding:14px 16px; margin-bottom:14px; }
  .row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
  .name { font-weight:600; }
  .pin { color:#7f8798; font-size:.75rem; margin-left:6px; }
  .val { font-variant-numeric:tabular-nums; font-size:1.35rem; font-weight:700; color:#5db0ff; }
  input[type=range]{ width:100%; height:34px; accent-color:#5db0ff; }
  .warn { color:#e0a24a; font-size:.72rem; margin-top:6px; }
  button { width:100%; padding:14px; font-size:1rem; font-weight:600; border:0; border-radius:12px;
           background:#5db0ff; color:#08131f; margin-top:6px; }
  button.secondary { background:#232833; color:#cfd6e4; }
  button:active { filter:brightness(.9); }
  .poses { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:6px 0; }
  .poses button { margin-top:0; background:#2a5c86; color:#eaf2fb; }
  .sect { color:#7f8798; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; margin:16px 0 4px; }
  #cap { text-align:center; font-family:ui-monospace,monospace; font-size:.9rem; color:#9ad0ff;
         background:#141821; border:1px solid #232833; border-radius:8px; padding:8px; margin-top:12px; }
  #st { text-align:center; font-size:.75rem; color:#8b93a3; margin-top:8px; min-height:1em; }
</style></head>
<body>
  <h1>servo jog</h1>
  <div class="sub">live per-servo control &middot; UNO Q direct drive</div>
  <div id="joints"></div>
  <div class="sect">poses / actions</div>
  <div class="poses">
    <button class="pose" data-id="0">Normal</button>
    <button class="pose" data-id="1">Grab</button>
    <button class="pose" data-id="2">Deposit L</button>
    <button class="pose" data-id="3">Deposit R</button>
  </div>
  <button id="park" class="secondary">Park all &rarr; 90&deg;</button>
  <div id="cap">[base, shoulder, elbow, gripper] = [90, 90, 90, 90]</div>
  <div id="st">ready</div>
<script>
const JOINTS = __JOINTS__;
const box = document.getElementById('joints');
let timer = null, last = {};
JOINTS.forEach((j, ch) => {
  const d = document.createElement('div'); d.className = 'joint';
  d.innerHTML = `<div class="row"><div><span class="name">${j[0]}</span><span class="pin">ch ${ch} &middot; ${j[1]}</span></div>
    <div class="val" id="v${ch}">90&deg;</div></div>
    <input type="range" min="0" max="180" value="90" id="s${ch}">
    ${j[0]==='gripper' ? '<div class="warn">gripper: creep toward closed, stop before it stalls (gears)</div>' : ''}`;
  box.appendChild(d);
  const s = d.querySelector('#s'+ch), v = d.querySelector('#v'+ch);
  s.addEventListener('input', () => {
    v.textContent = s.value + '°';
    last[ch] = s.value;
    updateCap();
    if (!timer) timer = setTimeout(flush, 40);   // throttle
  });
});
function updateCap(){
  const a = JOINTS.map((_, ch) => document.getElementById('s'+ch).value);
  document.getElementById('cap').textContent = '[base, shoulder, elbow, gripper] = [' + a.join(', ') + ']';
}
function syncSliders(angles){
  if (!Array.isArray(angles)) return;
  angles.forEach((deg, ch) => {
    const s = document.getElementById('s'+ch); if (!s) return;
    s.value = deg; document.getElementById('v'+ch).textContent = deg + '°';
  });
  updateCap();
}
function flush(){
  timer = null;
  const pending = last; last = {};
  Object.entries(pending).forEach(([ch, deg]) => send('/servo', {ch:+ch, deg:+deg}));
}
function send(path, body){
  return fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
    .then(r => r.json()).then(j => {
      document.getElementById('st').textContent = j.ok ? 'ok' : ('err: '+(j.err||'?'));
      if (j.angles) syncSliders(j.angles);   // server echoes MCU angles after pose/park
      return j;
    })
    .catch(e => { document.getElementById('st').textContent = 'net err: '+e; });
}
document.getElementById('park').addEventListener('click', () => send('/park', {}));
document.querySelectorAll('.pose').forEach(b => b.addEventListener('click', () => {
  document.getElementById('st').textContent = 'moving to ' + b.textContent + '...';
  send('/pose', {id: +b.dataset.id});
}));
</script>
</body></html>
""".replace("__JOINTS__", json.dumps(JOINTS))


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, body, ctype="application/json"):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._reply(200, PAGE, "text/html; charset=utf-8")
        else:
            self._reply(404, "{}")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except Exception:
            data = {}
        try:
            if self.path == "/servo":
                ch, deg = int(data["ch"]), int(data["deg"])
                Bridge.call("set_servo", ch, deg)
                self._reply(200, json.dumps({"ok": True, "ch": ch, "deg": deg}))
            elif self.path == "/park":
                Bridge.call("park")
                self._reply(200, json.dumps({"ok": True, "angles": _angles()}))
            elif self.path == "/pose":
                pid = int(data["id"])
                Bridge.call("goto_pose", pid)   # smooth move; blocks ~0.8 s
                self._reply(200, json.dumps({"ok": True, "id": pid, "angles": _angles()}))
            else:
                self._reply(404, "{}")
        except Exception as e:  # noqa: BLE001 - surface any bridge error to the UI
            self._reply(500, json.dumps({"ok": False, "err": str(e)}))

    def log_message(self, *args):
        pass


def _serve():
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


threading.Thread(target=_serve, daemon=True).start()
print(f"servo-jog UI listening on :{PORT}")


def loop():
    time.sleep(3600)


App.run(user_loop=loop)
