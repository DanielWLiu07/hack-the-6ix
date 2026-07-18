# Build Plan

**Golden rule: at every 6-hour checkpoint we must have a *demoable* system.** Judges score completeness - a robot that reliably picks one apple beats a half-working SLAM stack.

## Demo priority ladder (build in this order)

1. **P0 - Arm picks a fruit and drops it in a bin on command** (recorded poses). This alone is a demo.
2. **P0 - Web dashboard shows live telemetry** (fake data first, real data when robot's up).
3. **P1 - Vision-autonomous pick & sort**: on-arm camera detects apple/banana + ripeness → arm picks → carries to the matching bin pose.
4. **P1 - Drive + teleop via PlayStation controller** (browser Gamepad API in dashboard → `drive` events).
5. **P2 - Lidar live point-cloud/map in the web app** (Three.js scatter is fine; ROS2+Foxglove only if time).
6. **P2 - FarmHand LLM commanding** (Freesolo track).
7. **P3 - Autonomous navigate-then-pick, ElevenLabs voice.**

Never let a P2 block a P0. If IK is fighting us → record/replay servo poses ("canned picks") and move on; revisit later.

## Workstreams & suggested split (4 people)

| Person | Owns | Details |
|---|---|---|
| **A - Arm + firmware** | Arm assembly, servo driver, MCU firmware, pick sequences | Start 3D prints FIRST THING (longest lead time). Bench-test 30kg servos on separate 5V BEC before mounting. |
| **B - Drive base + power** | Chassis, motors/drivers, power tree, e-stop, teleop | Get it rolling Sat AM. Power budget in HARDWARE.md - brownouts are the #1 hackathon robot killer. |
| **C - Vision + ML** | Ripeness model, camera pipeline on UNO Q Linux, Freesolo training | Grab apple dataset (Roboflow "apple ripeness" sets exist) Fri night, train YOLOv8n/MobileNet overnight, quantize for on-device. Freesolo job Sat PM. |
| **D - Web** | React+Three.js landing, dashboard, Express/Socket.IO, Atlas, Auth0, Vercel | Ship with simulated telemetry immediately so web never blocks on hardware. Wire real feed Sat PM. |

## Timeline (assuming Fri eve → Sun AM hacking window - adjust to real schedule)

### Fri night (hours 0–6)
- [ ] All: repo, team sync on this plan, claim UNO Q + hardware from Qualcomm table
- [ ] A: **queue all 3D prints** (arm segments, gripper, mounts) - reprint queue is the bottleneck
- [ ] A: servo driver + one 30kg servo sweep test on bench PSU
- [ ] B: power tree soldered; motors spin via driver + MCU PWM
- [ ] C: dataset downloaded, training run launched (overnight), UNO Q Linux flashed + camera capture working
- [ ] D: Vite app scaffolded, deployed to Vercel, Atlas cluster live, Socket.IO echoing fake telemetry to dashboard

### Sat AM (6–16)
- [ ] A: arm assembled, 5-servo poses scripted, first canned pick of a real apple (film it immediately - backup demo footage)
- [ ] B: base drives under teleop from dashboard buttons; ultrasonic e-stop on MCU
- [ ] C: model v1 on-device: bounding box + ripe/unripe at usable FPS; camera → server MJPEG/WebRTC stream
- [ ] D: dashboard v1: live camera, telemetry cards, pick log persisted to Atlas, Auth0 login

### Sat PM (16–26)
- [ ] A+C: **vision → IK → pick** loop closed (the money demo). Simple 3-DOF geometric IK; depth from known apple size or fixed pick plane
- [ ] B: lidar on Pi streaming scans → web Three.js point cloud
- [ ] C: Freesolo SFT job: generate synthetic command→JSON dataset, train, evaluate; wire FarmHand → robot command bus
- [ ] D: manga-shader Three.js landing (Blender/Meshy assets), ripeness analytics charts

### Sat night (26–34)
- [ ] All: integration on full system; battery-powered untethered run
- [ ] Film demo video segments as things work (never wait until the end)
- [ ] Stretch: ElevenLabs voice, autonomous drive-to-tree

### Sun AM (34–end)
- [ ] Feature freeze 3h before deadline. No new features, only demo hardening
- [ ] Devpost writeup (use TRACKS.md checklist), video edit, slide for MPU/MCU split + env impact numbers
- [ ] Rehearse 3-min pitch: env hook → live pick → dashboard → edge-AI story → FarmHand

## Top risks & fallbacks

| Risk | Likelihood | Fallback |
|---|---|---|
| Servo brownout resets everything | HIGH | Separate 5V/5A+ buck for servos, common ground, big electrolytic cap across servo rail. Never power servos from Pi/UNO Q 5V. |
| IK too fiddly | HIGH | Record/replay poses; place apples at known positions. Judges care that it picks, not how. |
| 3D prints late/failed | MED | Start hour 0; design arm segments printable in <2h each; cardboard+zip-tie gripper backup. |
| ROS2/Foxglove rabbit hole | MED | Skip ROS entirely: raw lidar serial → Python → WebSocket → Three.js points. Foxglove is a P2 nicety. |
| On-device inference too slow on QRB2210 | MED | Quantize to int8 / shrink input to 320px / classify only in detected ROI. Absolute floor: run on Pi - but Qualcomm track needs it on UNO Q, so fight for it. |
| Live demo fails on stage | MED | Backup video of every working milestone, filmed as achieved. |
| WiFi at venue blocks robot↔server | MED | Phone hotspot; server can also run on a laptop with Vercel as public mirror. |
