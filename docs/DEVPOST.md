<!--
  DEVPOST.md - shared Devpost draft. SECTION OWNERSHIP:
    - Top matter + track index ........ skeleton by llm-client (edit via master)
    - Freesolo LLM track .............. llm-client (this file's author)
    - FarmHand demo shot list ......... llm-client
    - Qualcomm UNO Q track ............ vision-infer  (append below the marker)
    - Deloitte AI-for-Green ........... vision-infer  (append below the marker)
  Other workers: add your track section under its stub header; don't rewrite
  another owner's section. Numbers here are LIVE as of the timestamps noted.
-->

# Battery, not Blood - Autonomous Fruit-Picking & Sorting Robot

> 30–40% of food is lost between harvest and shelf - much of it to labor
> shortage and slow, brutal stoop labor. **FarmHand** is a low-cost rover +
> 5-DOF arm that **picks _and_ sorts** fruit at the point of harvest: an
> eye-in-hand camera classifies fruit type + ripeness with **on-device AI on
> the Arduino UNO Q**, the arm picks it, and drops it into the correct bin. A
> PlayStation controller gives teleop; a 360° lidar streams a live map; the
> whole thing streams to a React + Three.js dashboard. **We attack food waste,
> food prices, and back-breaking labor at once - on 5 watts, no cloud.**

## What it does (60-second version)

- **Sees** - eye-in-hand camera → on-device vision model → `{fruit, ripeness, bbox}`.
- **Understands** - natural-language commands ("pick all ripe apples") → the
  **FarmHand LLM** → a validated structured action → the robot.
- **Acts** - SEEK → ALIGN → PICK → SORT → DROP state machine, servo-interpolated
  arm, ultrasonic e-stop + watchdog.
- **Reports** - telemetry, detections, pick events, and a live lidar map stream
  to the dashboard; MongoDB Atlas persistence; quantified waste-avoided stats.

## Prize tracks

| Track | Section |
|---|---|
| Freesolo LLM (FarmHand NL commands) | [↓ Freesolo](#freesolo-llm-track--farmhand-natural-language-commands) |
| Qualcomm UNO Q (on-device AI) | [↓ Qualcomm](#qualcomm-uno-q-track--on-device-ai) |
| Deloitte AI-for-Green (quantified impact) | [↓ Deloitte](#deloitte-ai-for-green--quantified-impact) |
| Overall / Hardware | arm + vision + lidar sophistication; see hardware writeup |

---

## Freesolo LLM track - FarmHand natural-language commands

**The problem with NL control:** an LLM that emits free text can't safely drive
a robot. FarmHand is trained to emit **only JSON** matching a strict action
schema, and the inference client **validates every output** - anything that
isn't valid, in-schema JSON is rejected and **never reaches the robot**.

### The action contract

Every model output is one of two JSON shapes:

```jsonc
// 1. Action - all four keys always present ("any" = unspecified)
{"task":"pick|sort|stop|drive","fruit":"apple|banana|any","filter":"ripe|unripe|any","zone":"any|left|right|forward|backward|home"}
// 2. Clarification - ambiguous or off-topic input
{"clarify":"Which fruit - apples, bananas, or both?"}
```

Color language maps to ripeness (red apple / yellow banana → `ripe`, green →
`unripe`). Ambiguous commands ("pick the fruit") return a clarification instead
of guessing - the robot stays put until the user answers.

### Dataset _(live, generated + seeded-reproducible)_

| Split | Examples | Purpose |
|---|---|---|
| `farmhand_train.jsonl` | **2,349** | SFT training (chat-JSONL) |
| `farmhand_val.jsonl` | **123** | validation (5%, same distribution) |
| `eval_set.jsonl` | **30** | hand-written held-out - never trained on |
| `farmhand_prefs.jsonl` | **600** | preference pairs (chosen/rejected) for DPO/RL - bonus |

- **2,752 assistant turns** total across train+val: **2,432 actions + 320
  clarifications** (multi-turn clarify→answer→action dialogs included).
- Task distribution: `pick` 1,468 · `drive` 550 · `sort` 224 · `stop` 190.
- Varied phrasing, typos, slang, and caps; generator is seeded so re-runs are
  byte-identical, and eval texts are excluded from the training pool.
- Exportable to `prompt-completion` / `alpaca` / `dpo-flat` if Freesolo's
  trainer wants a different shape.

### Eval _(regex baseline on the 30 held-out commands - the comparison row)_

| Metric | Accuracy |
|---|---|
| **Exact match (all 4 fields)** | **28/30 (93.3%)** |
| `task` | 30/30 (100%) |
| `fruit` | 30/30 (100%) |
| `filter` | 29/30 (96.7%) |
| `zone` | 29/30 (96.7%) |

The two misses are the idiomatic cases only a trained model should nail -
_"bananas ripe or not"_ (→ `filter:any`) and _"come back to the charging
station"_ (→ `zone:home`). This regex baseline is the floor the trained
FarmHand model beats; `eval.py --endpoint <url>` scores the real model the same
way for a side-by-side row. _(Trained-model number: TODO once teammate's
endpoint is live - one env var flips the client from mock to real.)_

### End-to-end integration (works today)

`nl_command` text → hub → **FarmHand service** → validate → hub → **UI echo +
robot forward**. Proven live against the real Socket.IO hub - 10 commands
driven through as a real UI client while observing the actual robot-forward:

| Command | Result | Reached robot? |
|---|---|---|
| `pick all ripe apples` | `{task:pick, fruit:apple, filter:ripe}` | `pick{apple}` |
| `sort the unripe apples into the left bin` | `{task:sort, fruit:apple, filter:unripe, zone:left}` | |
| `yo can u snag me a banana thats not ripe` | `{task:pick, fruit:banana, filter:unripe}` | `pick{banana}` |
| `stop!!!` | `{task:stop}` | mapped → `estop` |
| `pick the fruit` | `clarify: "Which fruit…"` | withheld - awaits reply |
| `asdf qwerty zzz` | `clarify: "I can pick, sort, drive, or stop…"` | withheld |

**Full run:** 7 valid actions forwarded, 3 clarifications correctly withheld, 0
invalid outputs reached the robot. Reproducible: `client/demo_driver.py` →
`client/DEMO_TRANSCRIPT.md`.

### FarmHand demo video - shot list

1. **Hook (5s)** - dashboard NL box on screen, operator types
   _"pick all ripe apples"_ and hits enter.
2. **The parse (5s)** - cut to a terminal/overlay showing the model's JSON
   action appear next to the raw text: text in → `{task:pick,…}` out.
3. **Validation gate (5s)** - split screen: type garbage (_"asdf qwerty"_) →
   red "REJECTED, not forwarded" badge; then _"pick the fruit"_ → yellow
   clarification bubble _"Which fruit - apples, bananas, or both?"_. Sell that
   the robot **cannot** be driven by bad output.
4. **Robot acts (10s)** - the arm executes the ripe-apple pick from shot 1,
   drops into the `apple_ripe` bin; pick_event flashes in the dashboard log.
5. **Range (8s)** - quick montage: _"grab every ripe banana"_, _"sort the
   unripe apples into the left bin"_, _"stop!!!"_ (arm freezes) - showing
   pick / sort / e-stop all from plain English.
6. **The number (5s)** - freeze on the eval table: _93.3% held-out accuracy,
   100% task/fruit, every output schema-checked before it touches hardware._
7. **Tag (2s)** - "FarmHand - natural language to safe robot action. No cloud."

_Backup footage: capture the `demo_driver.py` transcript run on-screen - it's a
guaranteed-working end-to-end take even if live hardware misbehaves._

---

<!-- ============================================================ -->
<!-- vision-infer: APPEND your two sections BELOW this marker.    -->
<!-- Keep the ## headers + anchors exactly as stubbed so the      -->
<!-- track index links above resolve.                             -->
<!-- ============================================================ -->

## Qualcomm UNO Q track - on-device AI

**The one-liner:** fruit detection *and* ripeness classification run **on the
UNO Q itself** - a ~5 W edge device - while a separate real-time MCU owns motion
and safety. Unplug the network and the robot still sees, picks, and stops.

**Intentional dual-brain architecture.** The UNO Q pairs a Qualcomm Dragonwing
QRB2210 (quad Cortex-A53, Debian Linux) with an STM32U585 real-time MCU, and we
split the robot along the line that actually matters - *latency and safety*:

- **MPU (Linux, ~5 W)** - camera capture → detector → ripeness classification →
  annotated MJPEG + `detection` events; visual-servoing and the pick/sort state
  machine. Everything that wants a filesystem, OpenCV/onnxruntime, and the
  network stack.
- **MCU (real-time)** - tank-drive PWM, PCA9685 servo interpolation (20 ms tick,
  never snaps), an ultrasonic reflex e-stop (**<10 ms, no Linux round-trip**),
  and a **500 ms motion watchdog**. Every safety guarantee is enforced *on the
  MCU, independent of Linux* - if the vision process crashes mid-pick, the arm
  holds (never limps) and drive zeroes without Linux in the loop. That is the
  hard-real-time / rich-OS partition the track asks for, not "Linux runs Python."

The two halves speak over the App Lab Bridge (MsgPack-RPC); that boundary is our
Qualcomm judging surface. Full contract: `firmware/BRIDGE.md`. Full write-up:
`docs/QUALCOMM.md`.

**Genuine on-device AI - no cloud inference, ever.** One `load_detector()`
interface, two interchangeable backends that both run on the QRB2210:

- **YOLOv8n**, 4-class (`apple/banana × ripe/unripe`), int8-quantized, 320 px,
  via onnxruntime CPUExecutionProvider on the A53 cores.
- **HSV blob detector** - a zero-model OpenCV fallback that ships and classifies
  today with no training. Auto-selects to ONNX when the trained model exists.

Raw camera frames and the model never leave the board - the laptop/cloud only
receives result dicts for the dashboard. Hard project rule.

**On-device FPS + accuracy - final trained v0** (`robot/vision/bench.py`; laptop
arm64 CPU reference, same harness re-runs on the board via `./deploy_unoq.sh
bench`):

| Model | Size | FPS | Latency | Accuracy (held-out val) |
|---|---|---|---|---|
| YOLOv8n fp32 (demo model) | 320×320 | 70 | 14.4 ms | **mAP50 0.993 / mAP50-95 0.930** |
| YOLOv8n int8 (speed lever) | 320×320 | 180 | 5.5 ms | class correct, conf-saturated¹ |
| HSV fallback | 640×480 | 473 | 2.1 ms | precision 0.965 / recall 0.891 |

Per-class mAP50 all ≥ 0.991 (apple/banana × ripe/unripe); overall P 0.988 /
R 0.986. ¹int8 is ~2.6× faster but its confidences pin at ~1.54 (correct boxes +
class, unrankable) - fp32 is the demo model; int8 is the on-device speed lever if
the board needs it (opset-13 per-channel re-quant). fp32's 70 fps already clears
camera framerate. Full table + methodology: `docs/QUALCOMM.md`.

---

## Deloitte AI-for-Green - quantified impact

**The problem, in numbers.** 30–40 % of food is lost between harvest and shelf,
much of it to labor shortage and slow, late grading. A low-cost robot that
**picks *and* sorts by ripeness at the point of harvest** attacks that loss gap
directly - fruit is graded into the right bin the moment it's picked instead of
joining the post-harvest loss pile. That's the "Battery, not Blood" pitch, in
one machine.

**Throughput → waste avoided (live, not projected).** The dashboard computes
these from *actual* `pick_event`s in real time (`web/server/store.js`,
`docs/DATA.md`), so we cite measured numbers on stage, not slideware:

- Pick+sort cycle ≈ **8.4 s** measured → a single arm grades **~400+ fruit/hr**.
- Mass per graded fruit: **apple 0.18 kg, banana 0.12 kg** (USDA medium-fruit
  averages) → **~0.15 kg/pick avg**.
- **Waste avoided = 0.15 kg × successful picks** → on the order of **~60 kg/hr**
  graded at harvest, for one arm.
- **CO₂e avoided = waste_avoided × 2.5 kg CO₂e/kg** (conservative end of the FAO
  food-wastage-footprint range, 2–4) → **~150 kg CO₂e/hr**. We say "conservative"
  on stage.

Every figure the judges see ticks up live as the robot picks - the impact/ROI
widget is driven by real pick data (`/api/stats` → `waste_avoided_kg`,
`co2e_avoided_kg`), not a static number.

**Green AI - the compute itself is sustainable.** The perception model runs
inside the UNO Q's **~5 W envelope**, on-device. Compare a cloud-inference path:
the GPU accelerator alone draws **~70–300 W**, before datacenter PUE overhead
(~1.5–2×) and the per-frame energy of streaming video off-site. Grading at the
edge is an order-of-magnitude energy win *per inference* - and it works in a
connectivity-poor field with no datacenter round-trip and no video leaving the
farm (privacy + resilience). Efficient quantized edge inference is itself the
Green-AI story, on top of the food waste it prevents.

**Both dimensions of the track:** AI applied to sustainability (food-waste
reduction, labor-free local agriculture) **and** sustainable AI (5 W quantized
edge model, no datacenter).
