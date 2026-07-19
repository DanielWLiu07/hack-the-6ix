# Shared message schemas

Single source of truth for every Socket.IO event that crosses robot, server,
and web. All components conform to these payloads; do not drift from them.

## Robot -> server -> web

```jsonc
"telemetry"  {"ts":0,"battery_v":11.1,"state":"IDLE|SEEK|PICK|SORT|ESTOP","arm":[0,0,0,0,0],"drive":{"l":0,"r":0}}
"detection"  {"ts":0,"fruit":"apple|banana","ripeness":"ripe|unripe","conf":0.93,"bbox":[x,y,w,h]}
"pick_event" {"ts":0,"fruit":"apple","ripeness":"ripe","bin":"apple_ripe","success":true,"duration_ms":8000,"image_url":"http://<hub>/media/pick_<ts>.svg"}  // image_url OPTIONAL
"lidar_scan" {"ts":0,"points":[[x,y]]}          // meters, robot frame, downsampled <=360 pts
```

## Web/controller -> server -> robot

```jsonc
"drive"      {"l":-1.0,"r":1.0}                  // normalized tank drive
"arm_pose"   {"joints":[90,45,120,90,30]}        // degrees
"pick"       {"target":"nearest|apple|banana"}
"estop"      {}
"nl_command" {"text":"pick all ripe apples"}     // -> FarmHand LLM -> {"task":"pick","fruit":"apple","filter":"ripe"}
```

`nl_command` reaches the robot only as the validated structured action, never
as raw text.

## SLAM map (addendum)

Two additional robot-to-web events, max 0.5 Hz for the map:

```jsonc
"slam_map"  {"ts":0,"resolution":0.05,"width":128,"height":128,"origin":[x,y],"data":"<base64 uint8 occupancy, 0=free 100=occupied 255=unknown>"}
"slam_pose" {"ts":0,"x":0.0,"y":0.0,"theta":0.0}   // theta radians
```

Grid capped at 128x128 cells. Producer: the lidar SLAM node (sim and
hardware). Consumer: the web lidar page renders the grid under the live scan
with the pose marker.

## Fleet roster (addendum)

One server-to-web event, ~1 Hz, for the fleet dashboard:

```jsonc
"fleet" {"ts":0,"robots":[{"id":"rover-01","sim":false,"state":"IDLE|SEEK|PICK|SORT|ESTOP","battery_v":11.1,"pos":[x,y],"theta":0.0,"drive":{"l":0,"r":0},"arm":[0,0,0,0,0],"last_ts":0}]}
```

Server-aggregated, not robot-emitted: the hub keys each connected robot
socket's telemetry + slam_pose by socket id, labels it (rover-NN), and
snapshots the roster. `pos` is null until that robot emits slam_pose; `sim`
flags stand-in robots. Robots keep emitting plain telemetry/slam_pose.

## Bins

`apple_ripe`, `apple_unripe`, `banana_ripe`, `banana_unripe`. Fallback: two
bins (apple/banana) if the sort mechanism is tight on time.

## Controller input

PlayStation controller connected to the laptop, read via the browser Gamepad
API in the dashboard; emits `drive`/`arm_pose`/`pick` events. Fallback: DS4
over Bluetooth with evdev.
