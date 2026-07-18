// GET /stream - MJPEG.
// If ROBOT_STREAM_URL is set (vision-infer's annotated MJPEG on :8080), proxy it.
// Otherwise serve a generated moving test pattern so the dashboard <img> works today.

import http from 'node:http';
import { encode } from 'jpeg-js';

const BOUNDARY = 'ht6frame';
const W = 320;
const H = 240;
const FPS = 5;

// --- test pattern -----------------------------------------------------------

let tick = 0;
function renderTestFrame() {
  const data = Buffer.alloc(W * H * 4);
  const t = tick++;
  const cx = W / 2 + Math.sin(t / 10) * 90;
  const cy = H / 2 + Math.cos(t / 13) * 60;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // gradient background
      let r = (x / W) * 80;
      let g = 30 + (y / H) * 60;
      let b = 60;
      // sweeping bar
      if (Math.abs(x - ((t * 7) % W)) < 4) { r = 200; g = 200; b = 40; }
      // bouncing "fruit" blob
      const d = Math.hypot(x - cx, y - cy);
      if (d < 18) { r = 220; g = 50; b = 50; }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return encode({ data, width: W, height: H }, 70).data;
}

function serveTestPattern(res) {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store',
    Connection: 'close',
    'Access-Control-Allow-Origin': '*',
  });
  const timer = setInterval(() => {
    const jpg = renderTestFrame();
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
    res.write(jpg);
    res.write('\r\n');
  }, 1000 / FPS);
  res.on('close', () => clearInterval(timer));
}

// --- proxy ------------------------------------------------------------------

function proxyRobotStream(url, res) {
  const upstream = http.get(url, (up) => {
    res.writeHead(up.statusCode || 200, {
      'Content-Type': up.headers['content-type'] || 'multipart/x-mixed-replace',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*',
    });
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    console.warn('[stream] robot stream unreachable, using test pattern:', err.message);
    if (!res.headersSent) serveTestPattern(res);
  });
  res.on('close', () => upstream.destroy());
}

export function streamHandler(req, res) {
  const url = process.env.ROBOT_STREAM_URL;
  if (url) proxyRobotStream(url, res);
  else serveTestPattern(res);
}
