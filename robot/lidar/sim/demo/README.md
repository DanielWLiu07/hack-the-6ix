# SLAM room-tour demo segment

Backup demo-video footage of the **on-device SLAM** (RPLIDAR C1 -> Raspberry Pi):
a 360° lidar streams pose-less scans, and `scan_match.py` (scan-to-map ICP)
recovers the robot's trajectory *and* a global occupancy map in real time - no
cloud, no wheel/IMU odometry.

## Files (generated, deterministic)

| File | What |
|------|------|
| `slam_room_tour.mp4` | The segment: intro title card -> live map build-up (HUD: scan #, map pts, match residual) -> outro hold on the finished map. ~13 s. |
| `slam_room_tour.gif`  | Same, GIF (for Devpost/README embeds). |
| `slam_room_tour_map.png` | Hero still: completed room map + full recovered trajectory. |

## Regenerate

```sh
cd robot/lidar/sim
.venv/bin/pip install matplotlib          # + system ffmpeg for .mp4
.venv/bin/python tour.py demo/slam_room_tour.mp4 --demo --seconds 16 --fps 10
.venv/bin/python tour.py demo/slam_room_tour.gif --demo            # GIF variant
```

Fixed random seed => byte-stable footage. `--seconds` longer = more room coverage
but more open-loop drift smear (no loop closure); 16 s is the tuned sweet spot.

## Notes for the video editor / pitch

- The **cyan** points are the *live* 360° scan; **blue** is the accumulated map;
  **orange** is the recovered path + robot. The wavy blob mid-room is the moving
  obstacle (a person pacing) - realistic dynamic-object smear, not a bug.
- Talking point: "This map is built **on the Pi**, from lidar alone - the same
  edge-compute story as the on-device fruit vision. No cloud in the loop."
- These are generated from the simulator so footage exists before the physical
  C1 is mounted; swap in a real capture at the venue if time allows (the lidar node
  owns the real device - the emit schema is identical).
