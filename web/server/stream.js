// GET /stream - MJPEG arm-camera feed.
// If ROBOT_STREAM_URL is set (vision-infer's annotated MJPEG on :8080), proxy it.
// Otherwise there is NO feed: respond 503 so the dashboard shows NOT CONNECTED.
// No synthetic/test-pattern frames - the arm cam only ever shows the real camera
// (data rule: no fabricated streams in the UI).

import http from 'node:http';

function noFeed(res) {
  if (res.headersSent) return;
  res.writeHead(503, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('arm camera not connected');
}

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
    console.warn('[stream] robot stream unreachable:', err.message);
    noFeed(res);
  });
  res.on('close', () => upstream.destroy());
}

export function streamHandler(req, res) {
  const url = process.env.ROBOT_STREAM_URL;
  if (url) proxyRobotStream(url, res);
  else noFeed(res);
}
