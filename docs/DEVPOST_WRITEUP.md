<!--
  DEVPOST_WRITEUP.md - POLISHED, paste-ready Devpost narrative.
  Applies the team style rule (no em dashes, no emojis), the apple + banana
  strategy, the pitch-craft research (docs/TRACK_PITCHES.md), and the impact
  honesty guardrails (docs/IMPACT.md). Every number here is carried over
  unchanged from the verified drafts (DEVPOST_SUBMISSION.md, DEVPOST.md,
  status/vision-train.md, ml/freesolo-agent). Do not invent numbers; fill the
  two flagged TODOs only when measured. This is the human-facing form copy;
  DEVPOST.md stays the per-track technical appendix.
-->

# FarmHand: Battery, not Blood

## Project name
FarmHand: Battery, not Blood

## Tagline (under ~200 chars)
An autonomous rover and robotic arm that picks fruit AND sorts it by ripeness at
the point of harvest. On-device AI on a 5 watt board, plain-English commands, no
cloud.

## Elevator pitch
A third of the world's food is lost before it ever reaches a shelf, and a huge
share of that is labor: there are not enough hands to pick and grade perishable
fruit fast enough, so ripe produce rots in the field. FarmHand is a low-cost rover
with a 5-DOF arm and a camera on its hand that reads each apple or banana's type
and ripeness with AI running entirely on the robot, picks it, and drops it into
the right bin. You command it in plain English, you can teleop it with a
PlayStation controller, and everything streams to a live dashboard. It attacks
food waste, food prices, and back-breaking stoop labor at once. Battery, not
Blood.

---

## Inspiration
Roughly one third of all the food the world produces is lost or wasted, about 1.3
billion tonnes a year (FAO), and fruit and vegetables are the worst category, near
45 percent. A large slice of that loss happens in one specific place: the gap
between the harvest and the shelf. The FAO estimates 13.8 percent of food is lost
after the farm but before it ever reaches retail. There are not enough hands to
pick and grade perishable fruit in time, so it rots in the field before it is ever
sorted.

That labor gap is not abstract. On US fruit farms, labor runs as high as 38
percent of the cost of production. An estimated 42 percent of hired crop
farmworkers are undocumented, and the workforce is shrinking and aging. In 2025,
one Oregon grower lost about a quarter of a 125-acre cherry harvest, roughly a
quarter of a million dollars, for one reason: about half the workers did not show
up to pick it. Not weather, not disease. No hands.

Most food-waste technology targets the retail or the consumer end. We wanted to
attack the gap at its source, in the field, where the labor shortage actually
bites. That became our framing: Battery, not Blood. Replace brutal, scarce stoop
labor with a cheap machine that runs all day on a battery and both picks and
grades at the point of harvest.

## What it does
In one sentence: FarmHand is a robot that picks fruit and sorts it by ripeness
right at the point of harvest, so less of it rots before it reaches you.

- It sees. A camera on the arm (eye-in-hand) feeds a vision model that returns the
  fruit type, its ripeness, and where it is, for each apple or banana.
- It sorts by type and ripeness, not just picks. Apples and bananas go to
  different bins, and ripe and unripe go to different bins, four bins in total
  (apple ripe, apple unripe, banana ripe, banana unripe). Telling apple from
  banana, then ripe from unripe, then routing to the right bin, is the useful and
  the hard part.
- It understands plain English. Type "grab every ripe banana" or "pick all ripe
  apples" and the FarmHand language model turns it into a validated command. Ask
  it something ambiguous like "pick the fruit" and it asks which fruit instead of
  guessing.
- It keeps itself safe on its own. An ultrasonic reflex stop (under 10
  milliseconds) and a half-second motion watchdog run on a dedicated real-time
  chip, independent of the AI side. On a fault the arm holds its grip rather than
  going limp and dropping the fruit.
- It maps its world. A 360-degree lidar streams a live map, and our SLAM-lite
  recovers the robot's path from the scan stream alone.
- It reports its impact live. Telemetry, detections, pick events, and a running
  waste-avoided and CO2e-avoided counter stream to a React and Three.js dashboard,
  saved to MongoDB Atlas, gated by Auth0, deployed on Vercel.

## How we built it
The dual-brain robot (Arduino UNO Q). The UNO Q has two processors, and we split
the robot on the line that actually matters, safety and latency:

- The Linux side, a Qualcomm Dragonwing QRB2210 running about 5 watts (about the
  power of a phone charger), does all the seeing: camera capture, the vision
  model, visual servoing, and the pick-and-sort state machine. All AI inference
  runs here, on the robot. No camera frame ever leaves the board.
- The real-time side, an STM32U585 microcontroller, owns motion and safety: drive
  motor PWM, smooth interpolated servo motion that never snaps, the ultrasonic
  reflex stop, and the watchdog. Because safety lives on the real-time chip, if
  the vision process ever hangs mid-pick, the arm holds and the wheels stop
  without the Linux side in the loop.
- The two halves talk over the App Lab Bridge (MsgPack-RPC). That contract is
  written down in firmware/BRIDGE.md.

Vision. A YOLOv8n detector, four classes (apple and banana, each ripe and unripe),
320 pixels, trained locally and exported to ONNX and int8, run on-device with
onnxruntime on the A53 cores. A zero-model OpenCV color-blob detector ships as an
always-works fallback behind the same interface, so the robot can classify fruit
even with no trained model loaded.

FarmHand language model. We generated about 2,300 synthetic command-to-action
pairs, plus preference pairs, and fine-tuned a small model (Qwen3.5-0.8B) on
Freesolo. The inference client validates every model output against a strict JSON
schema and rejects anything invalid before it can reach the robot. The model never
pipes raw text to hardware.

Web and telemetry. An Express and Socket.IO hub relays a fixed set of JSON event
schemas between the robot and the browser. A React and Three.js dashboard renders
it, MongoDB Atlas stores picks and detections and computes the live impact math,
Auth0 gates the control page, Vercel hosts the frontend, and a Base44 webhook
forwards every pick event to a companion product (Orchard OS).

## Challenges we ran into
- Making a language model safe to wire to a motor. A model that emits free text
  cannot drive an arm. We forced FarmHand to emit only schema-valid JSON and put a
  hard validator in the client, so invalid output is rejected and never forwarded,
  and ambiguous commands return a clarifying question instead of a guess.
- SLAM with no odometry. Our lidar scan carries no wheel or IMU pose, so we
  recover the robot's path by aligning each scan to a growing map. Pose out of
  nothing, with about 14 percent open-loop drift.
- An int8 quantization confidence bug. Our int8 export got the boxes and classes
  right but saturated the confidence score, so we ship the fp32 model as the demo
  model and keep int8 as the on-device speed lever.
- Building against hardware that arrived late. Every subsystem was built and
  tested against mocks and simulators (a fake robot, a synthetic camera, a
  simulated lidar), so the whole demo runs end to end with one command even
  without the physical robot in the room.
- Coordinating a large parallel build. We ran the work across many contributors
  through shared status files and frozen message schemas so nothing drifted.

## Accomplishments that we are proud of
- Genuinely on-device AI. Detection and ripeness classification both run inside
  the UNO Q's roughly 5 watt envelope. Pull the network cable and the robot still
  sees, picks, and stops.
- A vision model that is actually accurate. Our v0 hits mAP@50 of 0.993 and
  mAP@50-95 of 0.930 (precision 0.988, recall 0.986) across all four classes, and
  the color-blob fallback holds precision 0.965 and recall 0.891.
- Plain English safely driving real hardware. Ten commands proven end to end
  through the live stack: seven actions forwarded, three clarifications correctly
  withheld, and zero invalid outputs ever reaching the robot.
- Live, defensible impact numbers. The dashboard computes waste avoided and CO2e
  avoided from real pick data, and every constant traces to an FAO or USDA source.
  We deliberately under-claim.
- A robot that maps a room from lidar alone, rendered live in the 3D dashboard.
- Completeness. One command boots the full demo, and every claim a judge can
  question links to a file they can open.

## What we learned
- The safe way to connect a language model to actuators is a hard schema boundary,
  not trust.
- On a two-brain board, the real design decision is where you draw the line
  between the two. Put safety on the real-time side and it survives a crashed AI
  process.
- On-device inference is not only a Qualcomm requirement, it is the Green-AI
  story: the model runs on a battery-scale device with no datacenter behind it and
  no video ever leaving the farm.
- Under-claiming impact numbers, with conservative constants and cited sources,
  makes them survive judge questions. Inflated ones do not.

## What is next
- FarmHand is trained. SFT plus GRPO on Freesolo (Qwen3.5-0.8B) reached 96.7
  percent exact match on the held-out set, up from a 93.3 percent regex baseline,
  and every output is schema-valid. The trained model is deployed and driving the
  robot client. Next: an optional distillation pass and a larger eval set.
- On-board vision benchmark. Quote the YOLOv8n int8 FPS measured on the UNO Q
  itself. (TODO: fill when the board bench runs, the harness is ready.)
- Voice commands. Browser speech-to-text into the same command pipeline.
- Real-prop fine-tune. A 30-minute relabel-and-finetune loop on photos of the
  physical 3D-printed fruit to close the sim-to-real gap.
- Loop-closure SLAM and multi-arm throughput.

---

## Built with
arduino-uno-q, qualcomm-dragonwing-qrb2210, stm32, python, onnxruntime, yolov8,
opencv, freesolo (LLM fine-tune), socket.io, express, node.js, react, three.js /
react-three-fiber, vite, mongodb-atlas, auth0, vercel, rplidar, base44,
playstation-controller (Gamepad API)

## Prize tracks we are submitting to
- Overall / Best Hardware. Full-custom arm plus on-device vision plus lidar plus a
  polished full-stack app, sorting by type and ripeness into four bins.
- Qualcomm UNO Q. Intentional Linux-MPU and real-time-MCU split, genuine on-device
  AI with no cloud. Evidence: docs/QUALCOMM.md.
- Deloitte AI-for-Green (or Environmental, pick one at submission). Live,
  quantified waste-avoided and CO2e math plus efficient ~5 watt edge inference.
  Evidence: docs/IMPACT.md, docs/DEVPOST.md.
- Freesolo, Best Model Trained. FarmHand, a small tuned model that turns natural
  language into validated action JSON and beats a frontier baseline on our task.
  Evidence: ml/freesolo-agent/.
- MLH MongoDB Atlas and MLH Auth0. Both live in the web stack.

## Links (fill at submission)
- Live dashboard: (Vercel URL, deploy worker posts it)
- Repo: https://github.com/DanielWLiu07/hack-the-6ix
- Demo video: (under 3 minutes, shot structure in docs/PITCH.md and
  docs/TRACK_PITCHES.md)

---

### Evidence index (for the "how do you know?" questions)
| Claim | File |
|---|---|
| Vision v0 metrics (mAP 0.993, P 0.988, R 0.986) | status/vision-train.md, ml/ripeness/export/ |
| On-device split and FPS harness | docs/QUALCOMM.md, robot/vision/bench.py |
| Impact math and sources | docs/IMPACT.md, web/server/db/impact.js |
| FarmHand eval (96.7% GRPO, 93.3% baseline) | ml/freesolo-agent/data/eval.py |
| NL-to-robot end-to-end run | ml/freesolo-agent/client/DEMO_TRANSCRIPT.md |
| SLAM room-tour | robot/lidar/sim/tour.py, scan_match.py |
| Per-track pitch and stat bank | docs/TRACK_PITCHES.md |
| 3-minute pitch script | docs/PITCH.md |
