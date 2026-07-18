# FarmHand - 3-minute pitch script

**"Battery, not Blood."** Target run time **3:00**. Two speakers + one silent
demo operator. Every number below is the same one in `docs/DEVPOST.md` /
`docs/IMPACT.md` - don't drift on stage.

## Roles

- **A - Story & Impact.** Opens, closes, owns the "why." Never touches hardware.
- **B - Tech & Demo.** Narrates the live pick, dashboard, MPU/MCU split, FarmHand.
- **OP - Demo operator (silent).** Runs the robot / types NL commands / advances
  slides on B's cues. Has the laptop and the controller. Never speaks.

**Golden rule:** the robot is already **powered, connected, and mid-SEEK** before
you start talking. If anything is red, OP flips the sim panic switch
(`docs/DEPLOY.md`) and the demo runs on simulated telemetry - the script does
**not** change. Backup: `client/DEMO_TRANSCRIPT.md` + recorded pick footage.

---

## The script (with running clock)

### 0:00 – 0:25 · Environmental hook  - **A**
> _(No slides. A holds up one 3D-printed apple.)_
>
> "Thirty to forty percent of the world's food is lost between the harvest and
> your shelf. Not on the shelf - **before** it ever gets there. A huge share of
> that is labor: there aren't enough hands to pick and sort fast enough, so ripe
> fruit rots in the field.
>
> Our answer isn't more workers bent over in the heat. It's this." _(sets apple
> down in front of the robot)_ "We call it **Battery, not Blood.**"

**[25s]** - _A steps back; B takes over. OP makes sure a fruit is in view._

### 0:25 – 1:05 · The live pick  - **B** narrates, **OP** runs it
> "FarmHand is a rover with a 5-DOF arm and a camera **on the hand** - eye-in-hand.
> Right now it's looking for fruit on its own. Watch."
>
> _(OP does nothing - the robot is autonomous. The arm centers on the apple:
> SEEK -> ALIGN.)_
>
> "It found the apple, it's centering the bounding box by jogging its own
> joints - and it already knows this one is **ripe**, not green. Now it picks..."
>
> _(Arm picks, lifts.)_
>
> "...and here's the part that matters: it doesn't just pick, it **sorts**. Ripe
> apple goes in the ripe-apple bin."
>
> _(Arm drops fruit into `apple_ripe` bin. Wait for the clunk.)_

**[40s -> 1:05]** - _If the arm stalls, B keeps talking and OP triggers the
scripted replay; never wait in silence._

### 1:05 – 1:35 · The dashboard  - **B**, **OP** brings up the screen
> "Everything it just did streamed live to our dashboard." _(OP switches to the
> web app.)_ "State machine, battery, the arm's joint angles, the lidar map from
> a 360° scanner on board - and every pick logged.
>
> And this widget isn't slideware: it's counting **real** picks and computing
> impact live - kilograms of waste avoided, CO₂ avoided - updating as the robot
> works. One arm grades **~400 fruit an hour**, about **60 kilograms** kept out
> of the loss pile - every hour."

**[30s -> 1:35]** - _OP leaves the dashboard up; advances to the architecture
slide on B's next line._

### 1:35 – 2:10 · The dual-brain - MPU/MCU  - **B**, slide up
> "How does a robot this small run AI **and** stay safe? The Arduino **UNO Q**
> has two brains, and we split the robot on the line that matters - **safety and
> latency.**
>
> The Linux side - a Qualcomm chip, about **5 watts** - does all the seeing:
> camera, detection, ripeness, planning. The real-time MCU owns motion and
> safety on its own: an ultrasonic reflex stop in **under 10 milliseconds**, a
> watchdog that kills motion if Linux ever goes quiet. **Pull the network cable
> and it still sees, picks, and stops.** No cloud - the camera frames never leave
> the board."

**[35s -> 2:10]** - _OP switches to the dashboard's NL command box for the finale._

### 2:10 – 2:45 · FarmHand - natural language  - **B**, **OP** types
> "Last thing. You shouldn't need to be an engineer to run this. So we trained a
> language model - **FarmHand** - to take plain English." _(OP types
> **"pick all ripe apples"** and hits enter.)_
>
> "It turns that into a validated command the robot can execute - and here's the
> safety catch: **anything the model outputs that isn't a valid, in-schema
> command is rejected and never reaches the robot.**" _(OP types garbage, e.g.
> **"asdf qwerty"** -> rejected badge; then **"pick the fruit"** -> clarification
> bubble.)_
>
> "Ambiguous? It asks which fruit instead of guessing. We trained it ourselves on
> Freesolo - and on realistic messy commands, typos and slang, it jumps from
> **47% to 81%** over the rule-based baseline. **100% safe**, because every output
> is schema-checked before it can touch the arm."

**[35s -> 2:45]**

### 2:45 – 3:00 · Close  - **A**
> "Picks, sorts, and grades fruit at the point of harvest - in plain English, on
> **5 watts**, with no cloud. Less waste, lower prices, and nobody breaking their
> back in the sun.
>
> **Battery, not Blood.** Thank you."

**[15s -> 3:00]**

---

## Timing summary

| Beat | Speaker | Length | Ends |
|---|---|---|---|
| Environmental hook | A | 0:25 | 0:25 |
| Live autonomous pick + sort | B / OP | 0:40 | 1:05 |
| Dashboard + live impact | B | 0:30 | 1:35 |
| Dual-brain MPU/MCU + on-device AI | B | 0:35 | 2:10 |
| FarmHand natural-language + safety | B / OP | 0:35 | 2:45 |
| Close | A | 0:15 | 3:00 |

## Track callouts (which line scores which prize)

- **Freesolo LLM** -> the FarmHand beat (2:10) - NL -> validated action, trained
  SFT+GRPO on Freesolo, 46.6% -> 81.0% over baseline on realistic input.
- **Qualcomm UNO Q** -> the dual-brain beat (1:35) - MPU/MCU split, on-device, 5 W.
- **Deloitte AI-for-Green / Environmental** -> hook (0:00) + live impact widget (1:05).
- **Overall / Hardware** -> the autonomous pick+sort (0:25) carries the difficulty.

## Cut-downs (if you're over)

- **-> 2:30:** trim the dashboard beat to 15s (just the impact widget), drop the
  lidar mention.
- **-> 90s (expo table):** hook (15s) -> live pick+sort (35s) -> FarmHand NL (25s) ->
  "5 watts, no cloud, Battery not Blood" close (15s). Skip the architecture slide.

## Pre-flight checklist (OP, before you're called up)

- [ ] Robot powered, connected, `/api/health` green (or panic-switch to sim).
- [ ] Dashboard open, NL box reachable; a ripe apple staged in the arm's view.
- [ ] FarmHand service running (`agent:1` in `/api/health`).
- [ ] Backup tab: `DEMO_TRANSCRIPT.md` + recorded pick clip, one click away.
- [ ] Controller paired (teleop fallback if autonomy misbehaves).
