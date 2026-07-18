#!/usr/bin/env python3
"""Minimal direct lidar streaming server -- Pi to laptop, no middleman.

Reads the RPLidar C1 on ttyAMA0 directly and pushes full 360-degree
scans as JSON over a raw WebSocket to whatever client connects.
No hub, no SLAM, no Socket.IO -- just the Pi talking to one laptop.

Requires the serial port to be free (stop any other service using it
first, e.g. `sudo systemctl stop <slam-service-name>`).
"""
import asyncio
import json
import threading

import websockets
from pyrplidar import PyRPlidar

SERIAL_PORT = '/dev/ttyAMA0'
BAUD = 460800
WS_PORT = 8765

clients = set()
loop = None  # set once the asyncio event loop is running
stop_event = threading.Event()


def lidar_thread():
    """Runs in a background thread -- pyrplidar's scan generator blocks,
    so we keep it off the asyncio event loop and hand batches back via
    run_coroutine_threadsafe.

    Cleanup is NOT left to a bare try/finally here: daemon threads get
    hard-killed the instant the main thread exits, which can skip this
    finally block entirely on a crash or Ctrl+C. Instead, main() sets
    stop_event and explicitly joins this thread before the process
    exits, so lidar.stop()/disconnect() are guaranteed to actually run.
    """
    lidar = PyRPlidar()
    try:
        lidar.connect(port=SERIAL_PORT, baudrate=BAUD, timeout=3)
        print('[server] lidar connected, starting scan')
        scan_gen = lidar.start_scan()
    except Exception as e:
        print(f'[server] FAILED to connect/start lidar: {e}')
        print('[server] is another process (e.g. the SLAM service) already holding the port?')
        print('[server]   check with: sudo lsof /dev/ttyAMA0')
        return

    current = []
    batch_count = 0
    try:
        for point in scan_gen():
            if stop_event.is_set():
                break
            if point.start_flag and current:
                if clients and loop:
                    batch = json.dumps({
                        "points": [
                            [round(p.angle, 2), round(p.distance, 1)]
                            for p in current if p.quality > 0
                        ]
                    })
                    asyncio.run_coroutine_threadsafe(broadcast(batch), loop)
                    batch_count += 1
                    if batch_count == 1 or batch_count % 50 == 0:
                        print(f'[server] broadcast batch #{batch_count} to {len(clients)} client(s)')
                current = []
            current.append(point)
    except Exception as e:
        print(f'[server] lidar read loop error: {e}')
    finally:
        print('[server] stopping motor and closing serial port...')
        try:
            lidar.stop()
        except Exception as e:
            print(f'[server] lidar.stop() failed: {e}')
        try:
            lidar.disconnect()
        except Exception as e:
            print(f'[server] lidar.disconnect() failed: {e}')
        # belt-and-suspenders: force-close the underlying serial handle
        # in case disconnect() didn't fully release the fd
        ser = getattr(lidar, '_serial', None)
        if ser is not None:
            try:
                ser.close()
            except Exception:
                pass
        print('[server] lidar cleanup complete')


async def broadcast(message):
    dead = set()
    for ws in list(clients):
        try:
            await ws.send(message)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)


async def handler(websocket):
    clients.add(websocket)
    print(f'[server] client connected: {websocket.remote_address} ({len(clients)} total)')
    try:
        await websocket.wait_closed()
    finally:
        clients.discard(websocket)
        print(f'[server] client disconnected: {websocket.remote_address} ({len(clients)} total)')


async def main():
    global loop
    loop = asyncio.get_running_loop()
    t = threading.Thread(target=lidar_thread, daemon=True)
    t.start()
    try:
        async with websockets.serve(handler, '0.0.0.0', WS_PORT):
            print(f'[server] listening on ws://0.0.0.0:{WS_PORT}')
            await asyncio.Future()  # run forever, until cancelled/interrupted
    finally:
        print('[server] shutting down, signaling lidar thread to stop...')
        stop_event.set()
        t.join(timeout=5)
        if t.is_alive():
            print('[server] WARNING: lidar thread did not exit cleanly within 5s')


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('[server] interrupted')
