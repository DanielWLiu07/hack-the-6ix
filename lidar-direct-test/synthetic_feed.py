#!/usr/bin/env python3
"""Synthetic C1 feed - speaks the EXACT protocol of lidar_direct_server.py so
the teammate's client can be driven without the physical RPLidar/Pi.

Broadcasts {"points": [[angle_deg, distance_mm], ...]} over ws://0.0.0.0:8765,
a fake 6x4 m room with the lidar drifting and one moving obstacle. Point the
client at the real Pi (ws://<pi-ip>:8765) once lidar_direct_server.py is running
there; this is only a stand-in for laptop-side testing.
"""
import asyncio
import json
import math
import time

import websockets

WS_PORT = 8765
clients = set()

# room in mm
W, H, OBST_R = 6000.0, 4000.0, 300.0


async def handler(ws):
    clients.add(ws)
    print(f"[synth] client connected: {ws.remote_address} ({len(clients)} total)", flush=True)
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)
        print(f"[synth] client disconnected ({len(clients)} total)", flush=True)


def scan(t):
    # Stationary lidar at room center -> SLAM has no motion to mis-estimate, so
    # the map stays PUT (no rotation) and the full 360deg around is sensed.
    px = W / 2
    py = H / 2
    ox = W / 2 + 1600 * math.cos(t * 0.5)          # one moving obstacle for liveliness
    oy = H / 2 + 950 * math.sin(t * 0.5)
    pts = []
    for a in range(360):
        rad = math.radians(a)
        dx, dy = math.cos(rad), math.sin(rad)
        d = 1e9
        if dx > 1e-6:  d = min(d, (W - px) / dx)
        if dx < -1e-6: d = min(d, (0 - px) / dx)
        if dy > 1e-6:  d = min(d, (H - py) / dy)
        if dy < -1e-6: d = min(d, (0 - py) / dy)
        cx, cy = ox - px, oy - py                  # ray vs obstacle circle
        proj = cx * dx + cy * dy
        if proj > 0:
            perp2 = cx * cx + cy * cy - proj * proj
            if perp2 < OBST_R * OBST_R:
                d = min(d, proj - math.sqrt(OBST_R * OBST_R - perp2))
        d += math.sin(a * 12.9898 + t * 3.0) * 8.0  # ~8mm sensor noise
        pts.append([round(float(a), 2), round(float(max(0.0, d)), 1)])
    return pts


async def broadcast_loop():
    t0 = time.time()
    n = 0
    while True:
        if clients:
            msg = json.dumps({"points": scan(time.time() - t0)})
            dead = set()
            for ws in list(clients):
                try:
                    await ws.send(msg)
                except Exception:
                    dead.add(ws)
            clients.difference_update(dead)
            n += 1
            if n == 1 or n % 50 == 0:
                print(f"[synth] broadcast #{n} to {len(clients)} client(s)", flush=True)
        await asyncio.sleep(0.12)                    # ~8 Hz


async def main():
    print(f"[synth] C1 synthetic feed on ws://0.0.0.0:{WS_PORT} (teammate's protocol)", flush=True)
    async with websockets.serve(handler, "0.0.0.0", WS_PORT):
        await broadcast_loop()


if __name__ == "__main__":
    asyncio.run(main())
