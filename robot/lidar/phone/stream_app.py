#!/usr/bin/env python3
"""stream_app.py - live phone->site camera stream, pure web app (Safari-friendly).

iOS Safari can't read the LiDAR from a web page (Apple exposes it only to native
ARKit apps - true even on iPhone 17 in 2026). What Safari CAN do over HTTPS is
getUserMedia on the camera. So this is a real in-browser web app:

    iPhone Safari  --getUserMedia-->  canvas -> JPEG frames --POST /push-->  server
                                                                              | latest frame
    Dashboard / any viewer  <--MJPEG /stream (multipart/x-mixed-replace)------+

The phone broadcasts; the site (or the web dashboard's lidar view) shows it live
via <img src="/stream">. Pure Python stdlib - no websockets, no native app.

HTTPS note: getUserMedia requires a secure context. Serve this through the ngrok
HTTPS tunnel (see run below) - that's what unlocks the camera on the phone.

Run:
    cd robot/lidar/phone && python3 stream_app.py        # 0.0.0.0:8092
    ngrok http 8092                                       # gives the https URL for the phone
Env: PORT (8092).
"""
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import socket

# shared latest-frame state
_lock = threading.Condition()
_frame = {"jpeg": None, "seq": 0, "when": 0.0}
_stats = {"pushes": 0, "viewers": 0}


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception:
        return "127.0.0.1"


# PWA assets (home-screen "app": manifest + icon + service worker)
_ICON_CACHE = {}


def app_icon(size):
    """Generate a FarmHand apple icon (cached). Falls back to a solid tile if
    Pillow is unavailable so installability never breaks."""
    if size in _ICON_CACHE:
        return _ICON_CACHE[size]
    try:
        from PIL import Image, ImageDraw
        import io
        img = Image.new("RGB", (size, size), (11, 14, 20))
        d = ImageDraw.Draw(img)
        cx, cy, r = size // 2, int(size * 0.56), int(size * 0.28)
        for dx in (-int(r * 0.45), int(r * 0.45)):
            d.ellipse([cx + dx - r, cy - r, cx + dx + r, cy + r], fill=(210, 50, 45))
        d.ellipse([cx - r, cy - int(r * 0.8), cx + r, cy + r], fill=(210, 50, 45))
        d.ellipse([cx + 2, cy - r - int(size * 0.12), cx + int(size * 0.16), cy - r + int(size * 0.02)],
                  fill=(120, 190, 60))
        d.line([cx, cy - r, cx, cy - r - int(size * 0.1)], fill=(110, 80, 50), width=max(2, size // 40))
        buf = io.BytesIO(); img.save(buf, "PNG"); data = buf.getvalue()
    except Exception:
        # 1x1 dark PNG fallback
        import base64
        data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    _ICON_CACHE[size] = data
    return data


MANIFEST = ('{"name":"FarmHand","short_name":"FarmHand","start_url":"/","scope":"/",'
            '"display":"standalone","orientation":"portrait","background_color":"#0b0e14",'
            '"theme_color":"#0b0e14","icons":['
            '{"src":"/icon-180.png","sizes":"180x180","type":"image/png","purpose":"any"},'
            '{"src":"/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]}')

SERVICE_WORKER = (
    "self.addEventListener('install',e=>self.skipWaiting());"
    "self.addEventListener('activate',e=>self.clients.claim());"
    "self.addEventListener('fetch',e=>{});"   # network passthrough (live stream, no caching)
)


BROADCAST_PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>FarmHand</title>
<link rel=manifest href=/manifest.json>
<meta name=theme-color content="#0b0e14">
<meta name=mobile-web-app-capable content=yes>
<meta name=apple-mobile-web-app-capable content=yes>
<meta name=apple-mobile-web-app-status-bar-style content=black-translucent>
<meta name=apple-mobile-web-app-title content=FarmHand>
<link rel=apple-touch-icon href=/icon-180.png>
<link rel=icon href=/icon-180.png>
<style>
 :root{color-scheme:dark;--bg:#070b10;--panel:#0e141d;--line:#1c2735;--grn:#7ee787;--amb:#f9b559;--cy:#7ce0ff}
 *{box-sizing:border-box} html,body{margin:0;height:100%}
 body{font:16px ui-sans-serif,-apple-system,system-ui,sans-serif;background:
   radial-gradient(120% 80% at 50% -10%,#0d1a1e 0%,var(--bg) 60%);color:#e6edf3;
   display:flex;flex-direction:column;min-height:100dvh;align-items:center;padding:14px 14px calc(14px + env(safe-area-inset-bottom))}
 .brand{display:flex;align-items:center;gap:9px;margin:4px 0 2px}
 .brand .dot{width:9px;height:9px;border-radius:50%;background:var(--grn);box-shadow:0 0 12px var(--grn)}
 h1{font-size:20px;font-weight:800;letter-spacing:.5px;margin:0}
 h1 span{color:var(--grn)}
 .tag{font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:var(--amb);margin:0 0 12px}
 /* camera stage with AR scan reticle */
 .stage{position:relative;width:100%;max-width:540px;aspect-ratio:3/4;border-radius:18px;overflow:hidden;
   background:#000;border:1px solid var(--line);box-shadow:0 10px 40px #000a}
 video{width:100%;height:100%;object-fit:cover;display:block}
 .reticle{position:absolute;inset:0;pointer-events:none}
 .reticle .b{position:absolute;width:34px;height:34px;border:3px solid var(--grn);opacity:.9}
 .reticle .tl{top:16px;left:16px;border-right:0;border-bottom:0;border-radius:8px 0 0 0}
 .reticle .tr{top:16px;right:16px;border-left:0;border-bottom:0;border-radius:0 8px 0 0}
 .reticle .bl{bottom:16px;left:16px;border-right:0;border-top:0;border-radius:0 0 0 8px}
 .reticle .br{bottom:16px;right:16px;border-left:0;border-top:0;border-radius:0 0 8px 0}
 .scanline{position:absolute;left:8%;right:8%;height:2px;background:linear-gradient(90deg,transparent,var(--cy),transparent);
   filter:drop-shadow(0 0 6px var(--cy));animation:scan 2.6s ease-in-out infinite;opacity:0}
 body.live .scanline{opacity:1}
 @keyframes scan{0%{top:14%}50%{top:84%}100%{top:14%}}
 .hud{position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;
   font:11px ui-monospace,monospace;color:#cdd6f4}
 .pill{background:#0009;border:1px solid var(--line);border-radius:20px;padding:5px 10px;backdrop-filter:blur(6px)}
 .pill.rec{color:var(--grn)} body:not(.live) .pill.rec{color:#7f849c}
 .install{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;
   margin:12px 0 0;max-width:540px;width:100%;font-size:13.5px;color:#c9d4e0}
 button#go{margin-top:14px;width:100%;max-width:540px;padding:17px;font-size:17px;font-weight:800;letter-spacing:.3px;
   border:0;border-radius:14px;background:linear-gradient(180deg,#8bf29a,#4bd06a);color:#06210d;
   box-shadow:0 8px 24px #2fae5340}
 button#go.stop{background:linear-gradient(180deg,#ff8fa3,#f0526e);color:#2a0710;box-shadow:0 8px 24px #f0526e40}
 #st{margin-top:10px;font:12px ui-monospace,monospace;color:var(--grn);text-align:center;white-space:pre;min-height:16px}
 .foot{color:#5b6472;font-size:11px;text-align:center;margin-top:8px;max-width:540px}
</style></head><body>
<div class=brand><span class=dot></span><h1>Farm<span>Hand</span> · Field Scanner</h1></div>
<p class=tag>Battery, not Blood - eye-in-hand vision</p>
<div class=stage>
  <video id=v playsinline autoplay muted></video>
  <div class=reticle>
    <div class="b tl"></div><div class="b tr"></div><div class="b bl"></div><div class="b br"></div>
    <div class=scanline></div>
  </div>
  <div class=hud>
    <span class="pill rec" id=rec>● STANDBY</span>
    <span class=pill id=meta>LiDAR • iPhone</span>
  </div>
</div>
<button id=go>>︎ Start scanning</button>
<div id=st>tap start · allow camera</div>
<div class=install id=install style=display:none><b>Install as an app:</b> Share -> <b>Add to Home&nbsp;Screen</b>, then launch FarmHand from your home screen.</div>
<p class=foot>Live feed streams to the FarmHand dashboard. View on the laptop at <b>/view</b>.</p>
<canvas id=c style=display:none></canvas>
<script>
// show the "Add to Home Screen" hint only in Safari (not once installed/standalone)
const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if(!standalone) document.getElementById('install').style.display='block';
if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js').catch(()=>{}); }
const v=document.getElementById('v'),c=document.getElementById('c'),go=document.getElementById('go'),st=document.getElementById('st'),rec=document.getElementById('rec');
let on=false,stream=null,sent=0;
const FPS=12, Q=0.5, W=640;
async function start(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280}},audio:false});
  }catch(e){ st.textContent='camera blocked: '+e.message+' - needs HTTPS + allow camera'; st.style.color='#f38ba8'; return; }
  v.srcObject=stream; await v.play(); on=true;
  document.body.classList.add('live'); rec.textContent='● LIVE';
  go.textContent='■ Stop scanning'; go.classList.add('stop'); st.style.color='var(--grn)'; loop();
}
function stop(){ on=false; if(stream){stream.getTracks().forEach(t=>t.stop());}
  document.body.classList.remove('live'); rec.textContent='● STANDBY';
  go.textContent='>︎ Start scanning'; go.classList.remove('stop'); st.textContent='stopped'; }
go.onclick=()=> on?stop():start();
async function loop(){
  if(!on) return;
  const vw=v.videoWidth||1280, vh=v.videoHeight||720, scale=W/vw;
  c.width=W; c.height=Math.round(vh*scale);
  c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  c.toBlob(async b=>{
    if(b&&on){ try{ await fetch('/push',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:b}); sent++; }catch(e){} }
  },'image/jpeg',Q);
  st.textContent='streaming to dashboard · '+sent+' frames · '+c.width+'×'+c.height;
  setTimeout(()=>requestAnimationFrame(loop), 1000/FPS);
}
</script></body></html>"""

VIEW_PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Phone stream - live</title>
<style>body{margin:0;background:#0b0e14;color:#cdd6f4;font:14px -apple-system,system-ui,sans-serif;
 display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}
 img{max-width:96vw;max-height:82vh;border-radius:14px;border:1px solid #2a3348;background:#000}
 .h{position:fixed;top:12px;left:12px;font:12px ui-monospace,monospace;color:#89dceb;
    background:rgba(17,21,30,.8);padding:8px 12px;border-radius:8px}</style></head><body>
<div class=h>live phone stream - <span id=s>connecting...</span></div>
<img id=im src=/stream alt="waiting for phone...">
<script>
 const im=document.getElementById('im'),s=document.getElementById('s');
 im.onload=()=>s.textContent='LIVE'; im.onerror=()=>s.textContent='no phone yet - open this URL on the iPhone';
 setInterval(async()=>{try{const r=await fetch('/health');const j=await r.json();s.textContent='LIVE · '+j.pushes+' frames';}catch(e){}},2000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _hdr(self, code, ctype, extra=None, length=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        if length is not None:
            self.send_header("Content-Length", str(length))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _html(self, body):
        b = body.encode()
        self._hdr(200, "text/html; charset=utf-8", length=len(b))
        self.wfile.write(b)

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p == "/" :
            return self._html(BROADCAST_PAGE)
        if p == "/view":
            return self._html(VIEW_PAGE)
        if p == "/manifest.json":
            b = MANIFEST.encode()
            self._hdr(200, "application/manifest+json", length=len(b)); return self.wfile.write(b)
        if p == "/sw.js":
            b = SERVICE_WORKER.encode()
            self._hdr(200, "application/javascript", length=len(b)); return self.wfile.write(b)
        if p in ("/icon-180.png", "/icon-512.png"):
            data = app_icon(180 if "180" in p else 512)
            self._hdr(200, "image/png", extra={"Cache-Control": "max-age=86400"}, length=len(data))
            return self.wfile.write(data)
        if p == "/health":
            body = ('{"ok":true,"pushes":%d,"has_frame":%s,"age_ms":%d}' %
                    (_stats["pushes"], "true" if _frame["jpeg"] else "false",
                     int((time.time() - _frame["when"]) * 1000) if _frame["when"] else -1)).encode()
            return self._hdr(200, "application/json", length=len(body)) or self.wfile.write(body)
        if p == "/snapshot":
            with _lock:
                data = _frame["jpeg"]
            if not data:
                return self._hdr(503, "text/plain", length=0)
            self._hdr(200, "image/jpeg", extra={"Cache-Control": "no-store"}, length=len(data))
            return self.wfile.write(data)
        if p == "/stream":
            return self._mjpeg()
        return self._hdr(404, "text/plain", length=0)

    def _mjpeg(self):
        boundary = "frameboundary"
        self._hdr(200, "multipart/x-mixed-replace; boundary=%s" % boundary,
                  extra={"Cache-Control": "no-store", "Connection": "close"})
        _stats["viewers"] += 1
        last = -1
        try:
            while True:
                with _lock:
                    _lock.wait_for(lambda: _frame["seq"] != last, timeout=5)
                    data = _frame["jpeg"]; last = _frame["seq"]
                if not data:
                    continue
                head = ("--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n"
                        % (boundary, len(data))).encode()
                self.wfile.write(head); self.wfile.write(data); self.wfile.write(b"\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            _stats["viewers"] -= 1

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/push":
            return self._hdr(404, "text/plain", length=0)
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n) if n else b""
        if data:
            with _lock:
                _frame["jpeg"] = data
                _frame["seq"] += 1
                _frame["when"] = time.time()
                _stats["pushes"] += 1
                _lock.notify_all()
        self._hdr(200, "text/plain", length=2); self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        # lightweight request trace so we can see the phone connect live
        try:
            ua = self.headers.get("User-Agent", "")[:40]
            print("REQ %s %s  ua=%s" % (self.command, self.path, ua), flush=True)
        except Exception:
            pass


def main():
    port = int(os.environ.get("PORT", "8092"))
    print(f"[stream] serving on http://0.0.0.0:{port}")
    print(f"[stream] phone (broadcast): http://{lan_ip()}:{port}/   (use the HTTPS ngrok URL on the phone!)")
    print(f"[stream] laptop (view)    : http://{lan_ip()}:{port}/view")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
