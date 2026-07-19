# FarmHandCapture - native iOS LiDAR world scanner

A native SwiftUI + ARKit app that scans the room with the iPhone's **LiDAR**
(real depth, which Safari cannot access) and streams the colored 3D mesh over
your local WiFi to the FarmHand laptop, where `mesh_receiver.py` turns it into
`web/public/world.glb` for the dashboard. No browser, no tunnel.

Ported from the BodyCapture capture-app. Builds clean (verified with xcodebuild).

## What you need
- A LiDAR iPhone (iPhone 17 / any Pro). Non-Pro phones have no LiDAR mesh.
- Xcode on the laptop, your Apple ID / team already set (DEVELOPMENT_TEAM 6N55MD7SSM).
- Phone and laptop on the **same network** (see step 3 - Personal Hotspot is the reliable one).

## Get it onto your phone (about 3 minutes)
1. Generate + open the project:
   ```
   cd robot/lidar/phone/ios/FarmHandCapture
   xcodegen generate
   open FarmHandCapture.xcodeproj
   ```
   (xcodegen already ran; the .xcodeproj exists. Re-run it only after editing project.yml.)
2. In Xcode: plug in the iPhone via USB (or same WiFi). Pick it as the run
   destination (top bar, next to the scheme). If Xcode complains about signing,
   open the target's Signing and Capabilities and confirm your team is selected.
3. Press the Run button (the play triangle). Xcode builds and installs
   FarmHandCapture onto the phone. First run: on the phone, trust the developer
   profile under Settings > General > VPN and Device Management, then reopen the app.

## Connect + scan
1. On the **laptop**, start the receiver:
   ```
   cd robot/lidar/phone && python3 mesh_receiver.py
   ```
   It prints `set laptop IP = X.X.X.X`. Note that number.
2. **Network**: the reliable path is the iPhone's **Personal Hotspot** - turn it on,
   connect the laptop to it. (Normal shared WiFi also works if it does not block
   device-to-device traffic.) Re-run the receiver after joining so it prints the
   right IP for that network.
3. In the app, type that laptop IP into the **laptop IP** field, tap **Start scan**.
4. Walk the phone around the scene. The wireframe mesh grows on the phone, and on
   the laptop the receiver logs `world.glb updated: N anchors ...` every ~2 s.
5. The dashboard 3D lidar view now shows your real scanned world.

## How it streams (wire format)
TCP to the laptop on port 9353, one frame per mesh-anchor update:
`'MSH2' | uint32 len | uuid(16) | float32 x16 transform | uint32 vCount | uint32
tCount | verts | indices | RGB`. Parsed by `../mesh_receiver.py`.

Interleaved on the same socket, the live camera pose at ~30 Hz (mesh anchors say
where the world is, this says where the phone is - required for any egocentric
"distance ahead" use, since a long session's ARKit origin drifts far from the
device):
`'POSE' | uint32 len (72) | float64 unix epoch s | float32 x16 camera transform
(column-major, camera-to-world)`. The receiver serves the latest pose as JSON at
`GET :9355/pose` (position, forward vector, 4x4 transform, age).

## Files
- `project.yml` - XcodeGen config (bundle id, team, iOS 17)
- `Sources/FarmHandApp.swift` - app entry
- `Sources/ARScanView.swift` - scan UI + ARKit scene-reconstruction session
- `Sources/MeshStreamController.swift` - mesh serialization + TCP streaming
