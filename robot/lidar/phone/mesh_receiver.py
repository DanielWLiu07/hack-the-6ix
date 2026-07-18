#!/usr/bin/env python3
"""mesh_receiver.py - receive the FarmHandCapture LiDAR mesh stream -> world.glb.

The native iOS app (robot/lidar/phone/ios/FarmHandCapture) streams ARKit
scene-reconstruction mesh anchors over TCP. ARKit re-meshes anchors constantly,
so "latest anchor mesh wins" is not stable enough for a live dashboard - later
updates can be sparser than earlier ones and make the world appear to collapse.

This receiver therefore fuses incoming colored vertices into a persistent
world-space voxel map on the laptop, then exports that fused map to
web/public/world.glb. The web view renders an additive accumulated LiDAR world
instead of transient anchor snapshots.

Wire format (little-endian), one frame per anchor update:
  'MSH2' | uint32 payloadLen | payload
  payload: uuid(16) | float32 x16 transform (column-major)
           | uint32 vCount | uint32 tCount
           | vCount*3 float32 (anchor-local verts) | tCount*3 uint32 indices
           | vCount*3 uint8 RGB

Run (on the laptop, iPhone on the same WiFi / your hotspot):
    cd robot/lidar/phone && python3 mesh_receiver.py           # listens 0.0.0.0:9353
Then in the app enter this laptop's IP (printed at startup) and tap Start scan.
Env: PORT (9353), WORLD_OUT (default ../../web/public/world.glb), EXPORT_EVERY_S (2).
"""
import os
import socket
import socketserver
import struct
import threading
import time
import tempfile

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
WORLD_OUT = os.environ.get("WORLD_OUT",
                           os.path.normpath(os.path.join(_HERE, "..", "..", "..", "web", "public", "world.glb")))
PORT = int(os.environ.get("PORT", "9353"))
EXPORT_EVERY_S = float(os.environ.get("EXPORT_EVERY_S", "2"))
VOXEL_M = float(os.environ.get("VOXEL_M", "0.06"))
MAX_VERTS_PER_UPDATE = int(os.environ.get("MAX_VERTS_PER_UPDATE", "12000"))

# Persistent fused world: voxel key -> [sum_r, sum_g, sum_b, count]
_voxels = {}
_lock = threading.Lock()
_dirty = False
_stats = {"frames": 0, "clients": 0}


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception:
        return "127.0.0.1"


def _recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def _parse_payload(p):
    """Return (uuid, world_verts Nx3, faces Mx3, colors Nx3 uint8)."""
    off = 0
    uuid = p[off:off + 16]; off += 16
    t = np.frombuffer(p, dtype="<f4", count=16, offset=off).reshape(4, 4).T  # column-major -> M
    off += 64
    vcount, tcount = struct.unpack_from("<II", p, off); off += 8
    verts = np.frombuffer(p, dtype="<f4", count=vcount * 3, offset=off).reshape(-1, 3).astype(np.float64)
    off += vcount * 12
    faces = np.frombuffer(p, dtype="<u4", count=tcount * 3, offset=off).reshape(-1, 3).astype(np.int64)
    off += tcount * 12
    colors = np.frombuffer(p, dtype="<u1", count=vcount * 3, offset=off).reshape(-1, 3)
    # anchor-local -> world
    h = np.hstack([verts, np.ones((len(verts), 1))])
    world = (h @ t.T)[:, :3]
    return uuid, world, faces, colors


def _voxel_keys(points):
    return np.floor(points / VOXEL_M).astype(np.int32)


def _fuse_vertices(world_verts, colors):
    """Accumulate colored points into the persistent voxel map.

    We intentionally fuse vertices rather than trusting ARKit anchor identity:
    anchors are local, unstable reconstruction fragments; world voxels are the
    persistent state the demo actually needs.
    """
    if len(world_verts) == 0:
        return 0
    step = max(1, len(world_verts) // MAX_VERTS_PER_UPDATE)
    pts = world_verts[::step]
    cols = colors[::step]
    keys = _voxel_keys(pts)
    added = 0
    for key, col in zip(keys, cols):
        k = (int(key[0]), int(key[1]), int(key[2]))
        slot = _voxels.get(k)
        if slot is None:
            _voxels[k] = [int(col[0]), int(col[1]), int(col[2]), 1]
            added += 1
        else:
            slot[0] += int(col[0])
            slot[1] += int(col[1])
            slot[2] += int(col[2])
            slot[3] += 1
    return added


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        global _dirty
        with _lock:
            _stats["clients"] += 1
        peer = self.client_address[0]
        print(f"[mesh] client connected: {peer}", flush=True)
        sock = self.request
        try:
            while True:
                try:
                    hdr = _recv_exact(sock, 8)
                except (ConnectionResetError, OSError):
                    break
                if not hdr:
                    break
                magic, length = hdr[:4], struct.unpack("<I", hdr[4:8])[0]
                if magic != b"MSH2" or length <= 0 or length > 50_000_000:
                    print(f"[mesh] bad frame magic={magic!r} len={length}", flush=True)
                    break
                payload = _recv_exact(sock, length)
                if payload is None:
                    break
                try:
                    uuid, verts, faces, colors = _parse_payload(payload)
                except Exception as e:
                    print(f"[mesh] parse error: {e}", flush=True)
                    continue
                with _lock:
                    if len(verts) > 0:
                        added = _fuse_vertices(verts, colors)
                        if added:
                            _dirty = True
                    _stats["frames"] += 1
        finally:
            print(f"[mesh] client disconnected: {peer}", flush=True)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def export_loop():
    global _dirty
    import trimesh
    from trimesh.voxel.ops import multibox
    while True:
        time.sleep(EXPORT_EVERY_S)
        with _lock:
            if not _dirty or not _voxels:
                continue
            items = list(_voxels.items())
            frames = _stats["frames"]
            _dirty = False
        if not items:
            continue
        centers = np.array(
            [[(x + 0.5) * VOXEL_M, (y + 0.5) * VOXEL_M, (z + 0.5) * VOXEL_M] for (x, y, z), _ in items],
            dtype=np.float64,
        )
        rgb = np.array(
            [[r / c, g / c, b / c] for _, (r, g, b, c) in items],
            dtype=np.uint8,
        )
        try:
            mesh = multibox(centers=centers, pitch=VOXEL_M, colors=rgb)
            os.makedirs(os.path.dirname(os.path.abspath(WORLD_OUT)), exist_ok=True)
            out_dir = os.path.dirname(os.path.abspath(WORLD_OUT))
            fd, tmp_path = tempfile.mkstemp(prefix="world.", suffix=".glb", dir=out_dir)
            os.close(fd)
            try:
                mesh.export(tmp_path)
                os.replace(tmp_path, WORLD_OUT)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            mb = os.path.getsize(WORLD_OUT) / 1e6
            print(f"[mesh] world.glb updated: {len(items)} voxels, {len(mesh.vertices)} verts, "
                  f"{len(mesh.faces)} faces, {mb:.1f} MB (frames rx: {frames})", flush=True)
        except Exception as e:
            print(f"[mesh] export failed: {e}", flush=True)


def main():
    ip = lan_ip()
    print(f"[mesh] receiver listening on 0.0.0.0:{PORT}", flush=True)
    print(f"[mesh] in the iPhone app, set laptop IP = {ip}", flush=True)
    print(f"[mesh] world output: {WORLD_OUT}", flush=True)
    threading.Thread(target=export_loop, daemon=True).start()
    Server(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
