#!/usr/bin/env python3
"""app.py - phone capture app: upload an iPhone lidar scan → world.glb.

A mobile-first web server you open ON YOUR PHONE at the venue. Scan the scene
with Polycam / Scaniverse (they own the ARKit lidar capture), export GLB/PLY/OBJ,
upload it here → the server runs process.py → drops web/public/world.glb → it's
live in the dashboard's 3D lidar view. Closes the capture loop with no laptop
fiddling. Pure Python stdlib (no Flask) so it runs anywhere.

Run (on the laptop, phone on the same wifi/hotspot):
    cd robot/lidar/phone && python3 app.py            # serves on 0.0.0.0:8092
    # then open http://<laptop-ip>:8092 on the phone
Env: PORT (default 8092), WORLD_OUT (default ../../web/public/world.glb).
"""
import html
import os
import socket
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_HERE = os.path.dirname(os.path.abspath(__file__))
WORLD_OUT = os.environ.get("WORLD_OUT",
                           os.path.normpath(os.path.join(_HERE, "..", "..", "..", "web", "public", "world.glb")))
UPLOAD_DIR = os.path.join(_HERE, "samples")
ALLOWED = (".glb", ".gltf", ".ply", ".obj")
os.makedirs(UPLOAD_DIR, exist_ok=True)

_last = {"name": None, "size": 0, "when": 0, "ok": None, "log": ""}


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1">
<title>FarmHand - phone lidar capture</title>
<style>
  :root{{color-scheme:dark}}
  *{{box-sizing:border-box}}
  body{{margin:0;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#0b0e14;color:#cdd6f4;
       padding:24px 18px;max-width:560px;margin:0 auto}}
  h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#89dceb;margin:0 0 20px;font-size:14px}}
  .card{{background:#11151e;border:1px solid #2a3348;border-radius:14px;padding:18px;margin-bottom:16px}}
  ol{{padding-left:20px;margin:8px 0}} li{{margin:6px 0}}
  input[type=file]{{width:100%;padding:14px;background:#0b0e14;border:1px dashed #45507a;
       border-radius:10px;color:#cdd6f4;margin:10px 0}}
  button{{width:100%;padding:16px;font-size:17px;font-weight:600;border:0;border-radius:10px;
       background:#89dceb;color:#0b0e14}}
  button:disabled{{opacity:.5}}
  .ok{{color:#a6e3a1}} .err{{color:#f38ba8}} .muted{{color:#7f849c;font-size:13px}}
  code{{background:#0b0e14;padding:2px 6px;border-radius:5px;color:#f9e2af}}
  #status{{white-space:pre-wrap;font:13px ui-monospace,monospace}}
</style></head><body>
<h1>FarmHand - phone lidar</h1>
<p class=sub>Scan the scene → upload → it appears in the 3D dashboard.</p>
<div class=card>
  <b>How to capture</b>
  <ol>
    <li>Open <b>Polycam</b> or <b>Scaniverse</b> (LiDAR mode) on this iPhone.</li>
    <li>Scan the demo table / room. Stop when the mesh looks complete.</li>
    <li>Export as <code>GLB</code> (or PLY/OBJ) - "Share → Export model".</li>
    <li>Come back here, pick the file, tap <b>Generate world</b>.</li>
  </ol>
</div>
<div class=card>
  <form id=f method=post action=/upload enctype=multipart/form-data>
    <input type=file name=scan accept=".glb,.gltf,.ply,.obj" required>
    <button type=submit id=go>Generate world</button>
  </form>
  <p class=muted>Optimizes to &lt;15&nbsp;MB and writes <code>world.glb</code>. Last: {last}</p>
  <div id=status></div>
</div>
<div class=card muted>
  <span class=muted>Connected to <code>{ip}</code>. Dashboard: the lidar view swaps to your
  scan automatically after processing. No scan yet? The synthetic room is shown.</span>
</div>
<script>
const f=document.getElementById('f'), go=document.getElementById('go'), st=document.getElementById('status');
f.addEventListener('submit',async e=>{{
  e.preventDefault(); go.disabled=true; go.textContent='Uploading + optimizing…'; st.textContent='';
  try{{
    const r=await fetch('/upload',{{method:'POST',body:new FormData(f)}});
    const t=await r.text();
    st.innerHTML=r.ok?('<span class=ok>✓ '+t+'</span>'):('<span class=err>✗ '+t+'</span>');
  }}catch(err){{ st.innerHTML='<span class=err>✗ '+err+'</span>'; }}
  go.disabled=false; go.textContent='Generate world';
}});
</script>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        body = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._send(200, '{"ok":true}', "application/json")
        last = "none yet" if not _last["name"] else \
            f'{html.escape(_last["name"])} ({_last["size"]//1024} KB) - {"ok" if _last["ok"] else "failed"}'
        self._send(200, PAGE.format(ip=lan_ip(), last=last))

    def do_POST(self):
        if self.path != "/upload":
            return self._send(404, "not found")
        try:
            name, data = self._parse_upload()
        except Exception as e:
            return self._send(400, f"bad upload: {e}")
        if not name:
            return self._send(400, "no file received")
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED:
            return self._send(400, f"unsupported type {ext} - export GLB/PLY/OBJ from Polycam/Scaniverse")

        safe = "upload_" + str(int(time.time())) + ext
        dst = os.path.join(UPLOAD_DIR, safe)
        with open(dst, "wb") as fh:
            fh.write(data)
        _last.update(name=name, size=len(data), when=time.time())

        # run the real optimize pipeline
        proc = subprocess.run(
            [sys.executable, os.path.join(_HERE, "process.py"), dst,
             "--out", WORLD_OUT, "--recenter-floor"],
            capture_output=True, text=True, timeout=300)
        _last["ok"] = proc.returncode == 0
        _last["log"] = (proc.stdout + proc.stderr)[-800:]
        if proc.returncode != 0:
            return self._send(500, "process.py failed:\n" + _last["log"])
        size_mb = os.path.getsize(WORLD_OUT) / 1e6
        tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
        return self._send(200, f"world.glb generated ({size_mb:.1f} MB). {tail}\n"
                               f"Open the dashboard lidar view - it's live.")

    def _parse_upload(self):
        """Minimal multipart/form-data parser (stdlib, cgi-free for 3.13+)."""
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype or "boundary=" not in ctype:
            raise ValueError("expected multipart/form-data")
        boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode()
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        sep = b"--" + boundary
        for part in body.split(sep):
            if b"\r\n\r\n" not in part:
                continue
            headers, payload = part.split(b"\r\n\r\n", 1)
            if b"filename=" not in headers:
                continue
            fname = headers.split(b"filename=", 1)[1].split(b"\r\n", 1)[0].strip().strip(b'"')
            fname = fname.decode(errors="replace")
            if not fname:
                continue
            payload = payload[:-2] if payload.endswith(b"\r\n") else payload  # trailing CRLF
            return os.path.basename(fname), payload
        return None, b""

    def log_message(self, *a):
        pass  # quiet


def main():
    port = int(os.environ.get("PORT", "8092"))
    ip = lan_ip()
    print(f"[phone-app] serving on http://0.0.0.0:{port}")
    print(f"[phone-app] open on your phone:  http://{ip}:{port}")
    print(f"[phone-app] world output: {WORLD_OUT}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
