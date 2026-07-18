"""lidar_node — Raspberry Pi lidar reader → Socket.IO `lidar_scan` events.

Pipeline: RPLIDAR serial → full 360° scan → polar→cartesian (meters,
robot frame) → downsample ≤360 pts → emit `lidar_scan` at ~2 Hz.
"""

__version__ = "0.1.0"
