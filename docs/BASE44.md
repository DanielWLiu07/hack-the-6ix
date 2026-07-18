# Base44 Venture Builder Challenge - "Orchard OS"

**Prize: $2,000 CAD (winner) / $1,000 CAD (runner-up).** Judged on execution IN Base44 - this is a SEPARATE build on base44.com (50 free credits at the event), not our React app. One teammate owns it (~4–6 focused hours). This doc is the complete build brief: paste the prompts in order.

## The venture (one sentence)

**Orchard OS** - the SaaS layer on top of our harvest robot: small orchard operators book robotic harvest runs, watch live yield/ripeness analytics from the field, and see exactly what the robot paid for itself this season.

Why this wins the rubric: we're the only team whose Base44 "venture" is powered by a REAL product (the robot in the demo room). Supply = our rover; Orchard OS = how customers buy and manage it. That's Problem Clarity + Venture Potential + Storytelling locked.

## Rubric mapping (100 pts)

- **Problem & Market (20)**: labor shortage -> 30–40% post-harvest loss; target = small/mid orchards (<50 ha) that can't afford industrial automation. Named user: "Maria, 20-ha apple orchard, can't hire pickers."
- **Product & Innovation (20)**: robotics-as-a-service booking + live field telemetry - not another generic dashboard.
- **UX & Workflow (20)**: 3-step booking flow; one glanceable operator dashboard.
- **Execution in Base44 (20)**: full data model, auth, charts, and a REAL webhook ingesting pick data from our robot's server (see Integration below).
- **Venture Potential (10)**: per-hectare subscription + per-kg pick fee; expansion: berries, vineyards.
- **Demo & Storytelling (10)**: script at the bottom.

## Build prompts - credit-optimized, Base44-feature-maximizing

Rules of engagement: **each message ≈ 1 credit, so consolidate hard** (few rich prompts, not many small ones). Spend credits ONLY on things that score their rubric: Base44-native features (in-app AI agent, integrations, auth, styling-by-reference), personality, and the live-robot moment. Anything the machine got 80% right, leave it - polish costs credits and their judges explicitly don't want perfect.

**P1 - mega-skeleton (1 credit).** One consolidated prompt:
"Build a SaaS app called **Orchard OS** - small orchard operators book autonomous robot harvest runs and watch the robot pay for itself. Personality: warm, farmer-first, tagline 'Battery, not Blood.' Entities: Farm (name, location, hectares, crops), Field (farm, crop, ripeness_window), HarvestJob (field, date, status requested/scheduled/in_progress/complete, est_yield_kg), Robot (name, status, battery, current_job), PickReport (job, fruit_type apple/banana, ripeness ripe/unripe, bin, timestamp, success). Users belong to a Farm; include login. Pages: (a) landing with the problem - 30–40% of food never makes it from harvest to shelf - and a Book Demo CTA; (b) a 3-step 'Book a Harvest' wizard (field -> date window -> confirm with est. cost at $0.12/kg and est. waste avoided) creating a requested HarvestJob; (c) operator dashboard: active job card, today's PickReports grouped by fruit+ripeness as a bar chart, success rate, season kg total, and an ROI widget - (kg × $2.10/kg apples, $1.40/kg bananas) minus subscription - phrased as 'your robot has paid for X% of itself'; (d) admin fleet page: robots w/ battery + assign requested jobs. Seed 2 farms, 4 fields, 1 complete job with 120 PickReports over 2 hours, 1 in_progress job."

**P2 - webhook ingest (1 credit).** "Add an API endpoint that accepts POST {job_id, fruit, ripeness, bin, success, ts} with a shared-secret header check and creates a PickReport live on the dashboard." -> paste resulting URL+secret into `web/server/.env` (`BASE44_WEBHOOK_URL`, `BASE44_SECRET`) - our forwarder is already built and tested; this is the live-robot judging moment.

**P3 - native AI agent (1 credit, their signature feature).** "Make me an agent called **FarmHand Advisor** on the dashboard: it answers operator questions from the app's own data ('when should I harvest field 3?', 'why was Tuesday's success rate low?', 'is it worth adding a second robot?') in plain farmer-friendly language, always citing the numbers it used." (Elsa literally told hackers to use this - using it well = 'execution in Base44' points.)

**P4 - integration flourish (1 credit + integration credits).** "When a HarvestJob completes, email the farm owner a harvest report: kg picked, ripe/unripe split, waste avoided, one warm sentence from FarmHand Advisor." (Their 100 integration credits exist to be used - an unused feature is a lost point.)

**P5 - styling by reference (1 credit, their other signature trick).** "Make the app look and feel like <our Vercel URL> - painterly paper background (#dcd6c4), soft greens, red apple accents, hand-drawn warmth. Keep it readable." -> one brand across robot dashboard + Orchard OS.

**P6+ - reserve (~19 credits/day).** Fix only what breaks the demo path: booking flow end-to-end, dashboard renders, webhook->dashboard latency, agent answers sensibly. Ignore cosmetic nits.

**Do NOT build in Base44** (zero rubric value, pure credit burn): teleop, lidar/3D views, robot internals, auth beyond the built-in, any duplicate of our React dashboard's engineering features. Orchard OS is the *business*; the robot app is the *product*. Keep the boundary crisp - judges reward focus.

## Integration with our robot (the killer demo)

Our Express server (`web/server/`) forwards every real `pick_event` to Orchard OS's webhook (env: `BASE44_WEBHOOK_URL`, `BASE44_SECRET`). During judging: robot picks a fruit on stage -> PickReport appears in Orchard OS seconds later -> ROI ticks up. server-core has this as a queued task (see BROADCAST).

## Demo script (2 min)

1. "Maria has 20 hectares and no pickers." (10 s problem stats)
2. Book a harvest in 3 clicks. (30 s)
3. Cut to the REAL robot picking a fruit -> the PickReport lands live in the dashboard. (40 s)
4. ROI widget: "this robot paid for 34% of itself this season." (20 s)
5. Vision: berries, vineyards, per-hectare pricing. (20 s)

## Credits & support (from event Discord)

- Free plan = **25 daily message credits + 100 integration credits** - Base44's own rep says an amazing submission fits in 25 daily credits. Each prompt = ~1 message credit, so our 6-prompt build + iteration is comfortable. **Don't pay for anything.**
- If you run out: promo code **`BOSTON50`** (confirmed working). Backups: `May50ER`, `June26ER50` (some codes may only apply after the free 25 are used).
- **Elsa from Base44** is on the event Discord all weekend for build help - tag her if stuck.
- Platform tips from Base44: you can literally type *"make me an agent that does _"* to add an AI agent, and *"make my app look and feel like [site with great UX]"* for styling - use that to match Orchard OS to our landing's painterly paper-and-green aesthetic.
- **Judging culture note**: their last hackathon winner was a poop-tracker for a student with IBS. They explicitly want personality - something that makes them "laugh, cry, feel inspired" - over a perfect app. So lead Orchard OS with the *"Battery, not Blood"* voice, farmer-first warmth, and the live robot feed; don't sand the character off it.

## Checklist

- [ ] Base44 account created (free plan is enough; `BOSTON50` if credits run dry)
- [ ] Prompts 1–6 executed, flows manually tested
- [ ] Webhook secret shared with server-core via .env (never in git)
- [ ] Devpost: select Base44 track; screenshots + this narrative
