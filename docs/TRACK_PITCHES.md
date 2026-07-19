# Per-Track Pitch Guide - what to say at each judging table

Fruit strategy is **apple + banana, both** (team decision). Apple is the reliable
live-pick hero (firmware and vision were built around the 3D-printed apple).
Banana carries the vivid ripeness-and-waste story. Showing both proves the full
4-bin sort by TYPE and RIPENESS, which is the uniqueness and difficulty score.

This is the companion to `PITCH.md` (the single 3-minute stage script): use
PITCH.md on the main stage, use THIS doc when you walk a specific sponsor's table
and have 60-90 seconds to score their exact criteria.

Every number here traces to `IMPACT.md`. Do not invent new ones on the floor.
Style: no emojis, no em dashes anywhere (team rule).

---

## Why two fruits, and why that is the point

- **Type sorting is the differentiator.** One fruit only demonstrates ripe vs
  unripe. Two fruits demonstrate the full four-bin sort the system was designed
  for: apple_ripe, apple_unripe, banana_ripe, banana_unripe. Telling apple from
  banana is instantly readable to a judge and is the harder ML problem. That is
  where "difficulty" and "uniqueness" are won.
- **Apple = reliability.** The 3D-printed apple is what the canned pick, the
  gripper geometry, and the vision baseline were tuned on. It is the dependable
  P0 pick and the fallback if anything wobbles.
- **Banana = story.** Ripeness on a banana is unmistakable (green, yellow,
  spotted), it is the most-consumed and most-traded fruit on earth, and its ripe
  window is only a few days. That is the sharpest version of the harvest-to-shelf
  waste narrative.
- **Ripeness routing is a real anti-waste mechanism.** Unripe ships and ripens in
  transit, ripe sells now, the over-ripe tail is the loss. Grading by ripeness at
  harvest routes each fruit to where it will not rot.

Sort classes are the four bins above (schema in docs/SCHEMAS.md). If a bin
mechanism is tight on time, fall back to two bins (apple vs banana) and still
show the type sort.

---

## Universal 15-second open (use before any track-specific pitch)

> "Thirty to forty percent of the world's food is lost before it ever reaches a
> shelf, and a huge share of that is labor: not enough hands to pick and grade
> fast enough, so ripe fruit rots in the field. This robot picks a fruit, reads
> its type and ripeness on-device, and sorts it, at the point of harvest. We call
> it Battery, not Blood."

Then pivot into the track-specific block below.

---

## 1. Overall (1st-3rd place)

**They score:** difficulty, uniqueness, design, completeness. Completeness is the
differentiator: most hardware teams demo something half-working.

**Hook:** "Full-custom autonomous robot that closes the whole loop, and it sorts
by both type and ripeness, four bins."

**60-second script:**
> "Everything here is ours: the 5-DOF arm, the rover, the on-arm camera, the
> firmware, the vision model, the web stack. It runs the full loop autonomously:
> seeks a fruit, centers on it by jogging its own joints, reads whether it is an
> apple or a banana and whether it is ripe, picks, and drops it in the matching
> one of four bins. Telling apple from banana and ripe from unripe, then routing
> to the right bin, is the hard part, and it is the useful part. And it is
> complete: live dashboard, persistent history, natural-language control, and
> staged fallbacks so the demo never dies. If autonomy stumbles we drive by
> controller, if the arm stalls a recorded pick replays, if the robot is down the
> dashboard runs on the simulator with the same interface."

**Show this:** an autonomous apple pick, then a banana, landing in different bins.
The type sort in front of their eyes is the difficulty proof. Then the dashboard
updating from those picks.

**If asked "what was hardest?":** closing vision to motion safely across two
processors (see Qualcomm block), and a gripper that handles both a rigid apple and
a softer banana without crushing either.

---

## 2. Best Environmental (our declared one-of-three)

**They score:** genuine sustainability impact.

**Hook:** "We grade fruit at the moment it is picked, which is exactly where the
waste happens."

**60-second script:**
> "Apples and bananas are two of the most-consumed fruits on earth, and a banana's
> ripe window is only a few days. Miss the grading step at harvest and it is gone.
> Today that grading is manual and slow. Our robot reads ripeness on the arm and
> routes each fruit: unripe can still ship and ripen, ripe goes to sell now, and
> the over-ripe tail, the part that becomes waste, is what catching this early
> prevents. And we do not just claim impact, we measure it: this widget counts
> real picks and computes kilograms kept out of the loss pile and CO2e avoided,
> live, as the robot works. Roughly 400 graded fruit an hour, unattended, on a
> battery, in the field."

**Show this:** the live impact widget incrementing during a real pick. "Measured,
not slideware" wins this table.

**If asked "where do these numbers come from?":** point to `IMPACT.md`. We
under-claim on purpose: successful picks times conservative USDA mass (apple
0.18 kg, banana 0.12 kg), CO2e via the FAO blended factor (2.5 kg/kg, stated as a
conservative proxy, not fruit-specific precision). Context stats (one-third of
food lost, ~13% post-harvest) are the size of the gap, not our yield.

**Research-backed ammo (cited, see Stat Bank):** the sharpest single stat for
"this is exactly what we attack" is FAO's **13.8% of food lost between farm and
retail** (SOFA 2019), the post-harvest window a picking-and-sorting robot sits
in. And the labor half of "Battery, not Blood" is the most defensible part of the
whole pitch: harvest **labor is up to 38% of production cost** on US fruit farms
(USDA ERS), **42% of hired US crop farmworkers are undocumented**, and in 2025 an
Oregon grower lost **about a quarter of a 125-acre cherry harvest, roughly
$250k, purely because ~50% of workers did not show up**. Use that last one as a
vivid illustration of structural harvest-labor fragility (say "cherries, but the
same fragility hits every hand-picked crop"), not as an apple/banana statistic.

---

## 3. Qualcomm - Arduino UNO Q

**They score:** an INTENTIONAL MPU/MCU split and GENUINE on-device AI, no cloud.
Show the boundary, do not just claim it.

**Hook:** "The UNO Q has two brains, and we split the robot on the line that
actually matters: safety and latency."

**60-second script:**
> "The Linux side, a Qualcomm chip at about 5 watts, does all the seeing: camera,
> fruit-type detection, ripeness classification, and planning. The quantized model
> runs on the board, the camera frames never leave it, there is no cloud call.
> The real-time MCU owns motion and safety on its own: an ultrasonic reflex stop
> in under 10 milliseconds and a watchdog that kills all motion if the Linux side
> goes quiet for half a second. The two talk over a defined RPC bridge. Proof:
> pull the network cable, and it still sees, still picks, still stops. Seeing and
> safety are physically separate, which is the whole point of a two-processor
> board."

**Show this:** the architecture slide (name what runs on which core), measured
on-device FPS from `QUALCOMM.md`, and if possible the cable-pull demo.

**If asked "is inference really on-device?":** yes, quantized model on the
Qualcomm MPU. Show the FPS measured on the board, not the laptop. No frame leaves
the device.

**Research-backed refinements (cited):**
- Qualcomm's own Edge AI hackathon rubric weights **Technical Implementation
  40/100** and has a dedicated **15-point Local Processing and Privacy** category,
  and Phase-1 gates on whether the use case genuinely suits edge (on-device,
  real-time, low-power) rather than cloud. Translation: the no-cloud, on-device,
  low-latency story IS the score. Lead with it, do not bury it.
- **Name-drop the precedent.** At MIT Reality Hack 2026, "Best Use of Edge AI"
  went to SoundSense, which ran a **pruned and quantized** Whisper model fully on
  a UNO Q with no cloud. Mirror that exact recipe out loud: our ripeness model is
  a quantized int8 ONNX/TFLite net running entirely on the board. Judges reward
  the pattern they already picked a winner for.
- **Do not oversell the silicon.** The QRB2210 is entry-tier for AI (no
  high-TOPS NPU). Frame it as "efficient, on-device, no-cloud, low-latency," NOT
  "huge NPU throughput." Claiming TOPS you do not have is how you lose a technical
  judge.
- **Honesty flag on FarmHand.** If the LLM does not actually run on the UNO Q at
  demo latency, do NOT imply it does. For this track, the on-device claim is the
  VISION model (ripeness/type). Say "the perception model runs on-device on the
  Qualcomm chip"; keep FarmHand's hosting a separate sentence. A judge who catches
  an inflated on-device claim discounts everything else.

---

## 4. Deloitte - AI for Green

**They score:** AI applied to sustainability WITH measurable impact. Stacks the
Environmental story with a Green-AI angle.

**Hook:** "Green AI twice over: the AI reduces food waste, and the AI itself runs
green."

**60-second script:**
> "Two dimensions. One, measurable impact: the dashboard shows kilograms of fruit
> kept in the supply chain and CO2e avoided, computed live from real picks,
> roughly 400 fruit an hour per arm. Two, the model itself is efficient: it runs
> on a 5-watt edge device with no datacenter GPU and no per-frame network egress.
> The recurring energy and carbon of serving a vision model in the cloud is
> essentially eliminated at run time, and 5 watts means it runs all day on a
> battery where the labor gap actually is."

**Show this:** the impact widget (measurable) plus the architecture slide (5 W,
on-device). Both dimensions in one breath.

**If asked "how much energy does the model actually save?":** be honest, per the
`IMPACT.md` guardrail. The defensible claims are structural: zero cloud/datacenter
dependency at inference, battery-operable in the field, no per-frame data
transfer. We do not inflate a per-inference kWh figure.

**Research-backed refinements (cited):** Deloitte's published definition of Green
AI is "reducing AI's environmental footprint across the entire value chain, from
clean energy to hardware improvements," and it explicitly calls for **efficient
AI plus reporting transparency plus an ecosystems approach**. Hit all three in
one breath: (1) efficient = 5 W on-device edge inference instead of cloud GPU;
(2) transparency = the dashboard openly reports kg waste avoided and CO2e with a
stated methodology (`IMPACT.md`); (3) measurable impact = the live picked-and-
sorted kilograms. Green AI that does green work, and reports it honestly.

---

## 5. Freesolo - Best Model Trained (FarmHand)

**They score:** a model you actually trained (SFT/RL/distillation) and its
quality. Emphasize training methodology and the safety wrapper.

**Hook:** "We trained a language model so you can run this robot in plain English,
and bad output physically cannot reach the arm."

**60-second script:**
> "FarmHand is a small model we fine-tuned on Freesolo. We generated over 1,500
> synthetic pairs of natural-language commands mapped to structured action JSON,
> with varied phrasing, typos, and multi-turn clarification dialogs, then trained
> and evaluated on a held-out set. Watch: 'pick all ripe apples' becomes a
> validated command the robot executes. The safety catch is the key part: anything
> the model outputs that is not a valid, in-schema command is rejected and never
> reaches the robot. Type garbage, it is refused. Ask ambiguously, say just 'pick
> the fruit,' and it asks which fruit instead of guessing. On our held-out test
> set it is 93 percent accurate, and 100 percent safe, because invalid output
> cannot drive the arm."

**Show this:** a working NL command, then a rejected garbage command (red badge),
then an ambiguous command triggering a clarification. The reject beat shows
engineering judgment, not just a model. With two fruits, the clarification ("apple
or banana?") is a natural, honest demo.

**If asked "how big, how trained?":** small model, SFT on ~1.5k synthetic pairs,
held-out eval. Teammate owns training on Freesolo; dataset + eval methodology in
`ml/freesolo-agent/`.

**Research-backed refinements (cited):** Freesolo's own thesis is
**"Specialization beats the frontier": a sub-10B model tuned on your data beats a
frontier model on your task, cheap and fast enough to retrain on the fly.** Pitch
FarmHand as the textbook case: a narrow, well-scoped task (NL to schema-valid
action JSON) with a clean numeric eval. The winning move is a **head-to-head
number: our small tuned model versus a frontier baseline on the SAME held-out
eval**, where the small one wins on accuracy AND latency AND cost. Also stress
ownership: Freesolo returns exportable weights, so say "our weights, our model, it
ships on the robot," which doubles as the no-cloud story. If you only have time
for one chart on this track, make it "tuned model beats frontier on our eval."

---

## 6. MLH - MongoDB Atlas

**They score:** meaningful use of Atlas. It is our primary datastore, not a
bolt-on.

**Hook:** "Atlas is the memory of the robot."

**30-second script:**
> "Every pick event, the telemetry time series, and the ripeness stats live in
> MongoDB Atlas. The impact widget you saw is not hardcoded, it is an Atlas
> aggregation over real pick data: counts by fruit and ripeness, success rate,
> kilograms avoided. The dashboard reads it live."

**Show this:** the analytics view, and for a technical judge, the aggregation
pipeline in `web/server/db/`. It degrades to in-memory if Atlas is unreachable, so
the demo never blocks.

---

## 7. MLH - Auth0

**They score:** real auth integration. Frame it as operator safety, not a
checkbox.

**Hook:** "A robot arm is dangerous, so control is behind a login."

**30-second script:**
> "The control dashboard, teleop and the pick commands, is gated by Auth0. Only an
> authenticated operator can drive the arm or issue commands. Viewing telemetry is
> open, commanding the machine is not. For a physical robot that is a genuine
> safety boundary, not just a login screen."

**Show this:** the Auth0 login gating the teleop page; logged-out users can watch
but cannot command.

---

## 8. Base44 - Orchard OS (Venture Builder)

**They score:** a real product built on base44.com. A separate companion SaaS, fed
by the robot.

**Hook:** "The robot is the hardware; Orchard OS is the business around it."

**30-second script:**
> "Orchard OS is a SaaS layer built on Base44 where an orchard operator books
> robotic harvest runs and watches live ROI. It is fed by a real webhook from our
> robot's server: every pick event flows in and updates the ROI dashboard,
> kilograms harvested, labor saved, percent of the robot paid off. It is the
> commercial story on top of the demo."

**Show this:** Orchard OS updating from a live pick via the webhook. Build brief in
`BASE44.md`.

**Research-backed refinements (cited):** Base44-run tracks judge a **real product
with validated demand**, not a prototype. Across Base44-branded events the winner
factors are: problem clarity and importance, target audience and feature
usefulness, a Base44 **landing page with a clear value proposition**, **idea
validation via an actual user survey or feedback form (often mandatory)**, and a
**working live link**. Two concrete to-dos that cheaply score points here: (1)
put a real feedback or waitlist form on the Orchard OS landing page and collect a
few responses before judging, even from other hackers, so you can say "we
validated with N growers/operators"; (2) keep a live deployed Base44 link ready to
open. "Polish is not the metric, traction is" is the recurring Base44 message.

---

## 9. People's Choice (automatic, crowd-driven)

**They score:** crowd appeal. Let people command it.

**Play:** hand a bystander the controller, or let them type "pick a ripe banana"
or "grab the apple" into the NL box and watch it happen. Two recognizable fruits
plus a satisfying sort is the best booth magnet in the room.

---

## One-line cheat sheet (tape this to the laptop)

| Table | Lead with | Physical proof to show |
|---|---|---|
| Overall | full custom loop + 4-bin type/ripeness sort | apple then banana into different bins |
| Environmental | ripe-window waste + live measured impact | impact widget incrementing |
| Qualcomm | 5 W on-device seeing, MCU owns safety | architecture slide + cable pull |
| Deloitte | impact numbers + Green AI edge model | widget + 5 W slide |
| Freesolo | NL to validated action, invalid is rejected | good cmd, garbage rejected, clarify |
| MongoDB | Atlas is the live datastore | analytics from aggregation |
| Auth0 | login gates control of a real arm | teleop behind login |
| Base44 | Orchard OS SaaS fed by real webhook | ROI updating from a pick |
| People's Choice | let them command it | bystander runs a pick |

## How to actually deliver it (pitch mechanics, cited)

Verified best practice from judges and hackathon guides:

- **Open on the pain, not the tech.** Judges must "share your frustration"
  before they care about your build. First ~20 seconds: "Battery, not Blood" plus
  one labor or waste stat. Only then the robot.
- **Show something working within ~90 seconds.** Do not spend two minutes on
  architecture before anything moves. Get a pick on screen fast.
- **Always have a pre-recorded backup video cued**, and a backup presenter.
  Live robot demos fail; a cued clip is treated as normal risk management, not a
  cop-out. (This matches `PITCH.md`'s sim panic-switch plan.)
- **One narrative, not every feature.** The most common demo failure is showing
  too much. Pick the loop (detect, pick, sort, log impact) and drive it clean.
- **Structure for a 2 to 3 minute slot:** ~20-30s problem, ~60-90s live demo,
  ~30s quantified impact and close. `PITCH.md` already times this out.

## Pitch craft: make it stick (research-backed, cited)

Judges see 30 to 50 demos and score presentation and storytelling as a real,
weighted component, not fluff. These are the levers that make FarmHand stick.

**Do this:**
- **Lead with the human problem, let the stats reinforce it.** Open on the
  stoop-labor / rotting-harvest pain so a judge feels it, THEN drop a number as
  validation. Data reinforces a story, it does not replace it (Harvard i-lab).
- **Pass the Grandma Test: one airtight sentence, no jargon.** Lock this line
  and have everyone say it the same way: "A robot that picks fruit AND sorts it by
  ripeness right at the point of harvest, so less of it rots before it reaches
  you." If you cannot explain it in a sentence, judges read it as too complex
  (Devpost).
- **Translate specs into felt benefits (beat the Curse of Knowledge).** Experts
  wildly overestimate how well others follow specs (the tapper/listener study:
  tappers expected 50% understood, only 2% did). Say it in human terms:
  - "5 watts" becomes "the whole AI runs on about the power of a phone charger."
  - "on-device, no cloud" becomes "the camera never sends a picture anywhere, it
    all happens on the robot, so it works with the network cable pulled."
  - "MPU/MCU split" becomes "two brains: one sees, one keeps it safe, so it stops
    in less than a blink even if everything else freezes."
  - "quantized int8 model" becomes "we shrank the AI to run on a tiny chip."
- **Name the hard thing to signal difficulty.** For technical and sponsor
  judges, say plainly: "the genuinely hard part is running real AI vision fully
  on-device on the UNO Q, with a separate real-time safety brain." That is the
  difficulty and sponsor-fit score, stated out loud. (Lead simple for the story,
  then layer this named depth. Do not dumb the whole pitch down, and do not bury
  the story in specs.)
- **Show cause and effect: close the loop on screen.** State the problem up
  front, then let the judge SEE the fruit land in the correct bin as the
  resolution. Set-the-scene, working demo, one-line impact (Devpost 4-part).
- **Visible passion + a novel angle + concise delivery.** The novel angle is
  "picks AND grades at the point of harvest, eye-in-hand edge AI." Rehearse until
  enthusiasm reads as genuine.

**Do NOT (these were explicitly voted down in the research):**
- Do not open cold with a personal "why I built this" monologue.
- Do not force impressive metrics into the first 40 seconds; earn them.
- Do not assume a rigid problem to solution to tech-stack to demo order in the
  video; open with the elevator pitch and a hero shot instead.
- Do not assume a pretty UI is what gets scored first; completeness across all
  three criteria (creativity, implementation, impact) is what wins, and judges
  penalize over-indexing on one leg. A slick dashboard will not rescue a thin
  impact story.

## Tough Q&A: anticipate and disarm

Rehearse these. A confident, honest answer to the skeptical question often scores
more than the demo. Keep answers short, lead with the direct answer, then one
supporting line. (Authored from the project + sponsor findings; the research pass
flagged Q&A scripts as a gap.)

- **"Why not just run the AI in the cloud?"** Because a picking robot cannot wait
  on a round trip and a field has no reliable connectivity. The safety reflex
  fires in under 10 milliseconds locally, and no camera frame ever leaves the
  device. Edge is the requirement, not a shortcut.
- **"How does this generalize beyond 3D-printed fruit?"** The props are the
  hackathon stand-in. The vision model trains on real apple and banana datasets,
  and our capture-and-retrain loop re-tunes it on real fruit in about 30 minutes.
  The arm, the sort logic, and the on-device inference are identical either way.
  (Say this honestly, do not claim we tested on a real orchard.)
- **"Does the language model also run on-device?"** Be straight: the perception
  model (ripeness and type) runs on-device on the Qualcomm chip. FarmHand, the
  language model, runs [state exactly where it runs]. Do not imply on-device if it
  is not.
- **"Isn't automated fruit picking already a thing?"** Existing ag robots are
  six-figure, single-crop, and do not grade. Ours is low-cost, picks AND sorts by
  type and ripeness at the point of harvest, and takes plain-English commands.
  That combination at this price is the novelty.
- **"How do you know it actually works / what is the accuracy?"** The command
  model is 93% on a held-out set, invalid commands are rejected, and you just
  watched a live pick. We report success rate honestly on the dashboard.
- **"Is the impact number real or invented?"** It is computed live from actual
  successful picks times a conservative USDA per-fruit mass, converted with a
  conservative FAO CO2e factor. Methodology is written down in IMPACT.md and we
  deliberately under-claim.
- **"What if it grabs the wrong fruit or drops it?"** A mis-sort just goes to the
  wrong bin and is recoverable. On a fault the arm holds position with torque, it
  does not go limp and drop, and an e-stop plus a 500 ms watchdog kill motion.
- **"What does it cost?"** That is the point: a low-cost robot (aim for the
  low hundreds of dollars) versus six-figure ag equipment is exactly what makes
  picking-plus-grading deployable where the labor gap actually is.

## If the live pick fails: recovery choreography

Live robotics fails; a smooth recovery is not penalized, silence and panic are.

- **Never stand in silence.** The story speaker keeps talking about the why while
  the operator recovers. The narration does not change.
- **Pre-decide the cutover trigger.** If the arm stalls for more than ~5 seconds,
  the operator triggers the scripted canned-pick replay. If the robot is dead,
  flip the sim panic-switch (`DEPLOY.md`) and the demo runs on simulated
  telemetry with the SAME script. Backup demo video is one click away.
- **Frame it as normal.** "That is live robotics for you, here is the same run we
  filmed this morning" is an accepted, judgment-free move. Judges expect a cued
  backup.
- This matches `PITCH.md`'s roles (A story, B tech, OP silent operator) and its
  pre-flight checklist. Rehearse the failure path at least once.

## Stat Bank (verified, cite-ready, do not drift)

Every number below survived 3-vote adversarial verification. Sources in the next
section. Match these exactly on stage and in Devpost.

| Stat | Number | Use it for |
|---|---|---|
| Food lost or wasted globally (whole chain) | ~1/3, ~1.3 billion tonnes/yr (FAO 2011) | Opening scale of the problem |
| Food lost **farm to retail** (post-harvest, pre-retail) | **13.8%** (FAO SOFA 2019) | "The exact slice we attack" |
| Harvest labor as share of production cost, US fruit/tree-nut farms | up to **38%** (USDA ERS) | "Battery, not Blood" economics |
| Hired US crop farmworkers who are undocumented | **42%** (another 26% naturalized/permanent) | Labor fragility, human stakes |
| Oregon 2025 cherry harvest lost to worker no-show | **~25% of 125 acres, ~$250k**, from ~50% no-show | Vivid labor-shortage illustration |
| Edge inference power envelope (UNO Q class) | ~**5 W** | Qualcomm + Deloitte Green AI |
| FarmHand held-out command accuracy | **93%** (our eval) | Freesolo, keep it honest to our number |

Scope discipline (say the caveat if pressed): the 1/3 figure is 2011 whole-chain
loss-plus-waste; a newer UNEP waste-only figure (1.05 B tonnes, 19%) is a
different scope, not a contradiction. The Oregon example is cherries and driven by
immigration-enforcement no-shows, so frame it as illustrative of structural
harvest-labor fragility, not an apple/banana number.

## Sources (primary unless noted)

- Qualcomm Edge AI Developer Hackathon, Official Rules (judging rubric):
  Technical Implementation 40, Use-Case/Innovation 25, Local Processing and
  Privacy 15, Deployment 10, Presentation 10.
- Qualcomm Developer Blog, "MIT Hack Recap 2026" (SoundSense won Best Use of Edge
  AI, quantized Whisper fully on UNO Q, no cloud).
- Qualcomm Developer Blog, "The Arduino UNO Q Board: Dual-Brain Power" + Arduino
  UNO Q docs (QRB2210 Debian MPU for inference; STM32U585 MCU for real-time
  control).
- Deloitte Global, "Powering AI" (Green AI definition: efficiency + transparency
  + ecosystems across the value chain).
- FAO 2011, "Global Food Losses and Food Waste" (1/3, 1.3 B tonnes) via ReliefWeb.
- FAO SOFA 2019 via WWF FoodForward (13.8% farm-to-retail loss).
- USDA ERS, 2022, "U.S. Fruit and Vegetable Industries... Rising Labor Costs"
  (labor up to 38% of production cost; 42% undocumented).
- CNN, Aug 2025, Oregon cherry harvest worker shortage (~25% loss, ~50% no-show).
- Freesolo (freesolo.co): "Specialization beats the frontier"; sub-10B tuned
  model beats frontier on your task; owned/exportable weights.
- NIAT x Base44 rules + Megathon (Base44 values: validated demand, live link,
  landing page value prop, mandatory feedback form).
- JetBrains "Notes from the Judging Table," AngelHack, Taikai (pitch mechanics:
  lead with pain, working demo in ~90s, backup video, one narrative).
- Harvard Innovation Labs, "The Power of Storytelling in Pitching" (data
  reinforces, does not replace, the story).
- CSULB "Typical Judge Questions" + Devpost "Understanding Judging Criteria"
  (Grandma Test, explain in one or two sentences, signal technical sophistication
  and correct sponsor-tech use).
- "Made to Stick" (Heath) via summary (Curse of Knowledge, tapper/listener study,
  "1,000 songs in your pocket"; translate specs into felt benefits).
- Devpost "Hackathon Judging Tips" (Richard Moot, Square): completeness beats
  over-indexing on one criterion; presentation and storytelling are scored.
- Devpost "How to Present a Successful Hackathon Demo" + "6 Tips for a Demo
  Video" (set-scene / demo / impact structure; video under 3 min, open with the
  elevator pitch; video is a judge's first proxy for effort).
- Robotics Knowledge Base, "Demo Day" (keep it under ~5 min, bring a curated
  controlled sandbox, pre-stage assets, skip mundane setup).

## Caveats and open questions (know these before the floor)

- **Proxy rubrics, not the literal HT6 rubric.** The Qualcomm 40/15-point rubric
  is from Qualcomm's own Edge AI hackathon, and the Base44 five-factor list is
  from other Base44 events. Treat both as reliable signals of what each sponsor
  values, not as the exact Hack the 6ix scoring. **Get the real HT6 track rules
  if published and reconcile.**
- **Does the QRB2210 run BOTH the vision model and FarmHand on-device at demo
  latency?** If not, the honest Qualcomm story is vision on-device, FarmHand
  hosted separately. Confirm before claiming a fully on-device pipeline.
- **We still lack an apple/banana-specific post-harvest-loss number** to replace
  the cherry example. If a teammate finds a cited banana cold-chain or apple
  storage loss figure, add it to the Stat Bank and lead with it on the
  Environmental table.

## Reconciliation notes (fruit strategy)

`PITCH.md` and `DEVPOST.md` are currently apple-only. To match the apple + banana
strategy, add banana as the second class rather than replacing apple: keep the
apple as the reliable hero pick, and add one banana beat (type sort into a
different bin, plus the banana ripeness-window line in the environmental hook).
The impact math already supports both (apple 0.18 kg, banana 0.12 kg in
`IMPACT.md`). If time is tight on the sort mechanism, demo two bins by type and
say the four-bin ripeness split is the same mechanism scaled up.
