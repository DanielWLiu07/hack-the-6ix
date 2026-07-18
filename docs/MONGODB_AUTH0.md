# Winning the MongoDB Atlas + Auth0 tracks

**Goal:** not "we have a database and a login button" (what most teams show) but a
**tight synergy** where the two sponsors reinforce each other and a real product
need. Owner of the DB side: worker `db`. Auth0 UI/gating: web-frontend +
server-core.

## The one-sentence synergy (lead with this to judges)

> **Auth0 authenticates and authorizes every operator; MongoDB Atlas stores what
> each authenticated operator did.** You can't let an anonymous stranger drive a
> physical robot arm - so Auth0 gates control with role-based access, and every
> pick, drive, and natural-language command is attributed to that operator's
> identity and written to Atlas as a live, queryable audit trail.

That single story checks *both* rubrics: meaningful auth (RBAC on a real
safety-critical action) **and** meaningful data (attributed, aggregated,
purpose-built collections) - not bolted-on.

---

## MongoDB Atlas - how we use it *well* (not just as a bucket)

| Feature | Where | Status |
|---|---|---|
| **Time Series collection** | `telemetry` is a native Atlas Time Series collection (timeField `time`, `seconds` granularity, 1 h TTL) - purpose-built for the robot's 1 Hz sensor stream, not a plain collection | live on `ht6` (verify: `db.getCollectionInfos({name:'telemetry'})[0].type === 'timeseries'`) |
| **Aggregation pipelines** | `/api/stats` = one `$facet` (totals/by-fruit/by-ripeness/by-bin + window); `/api/timeseries` = `$mod` time-bucketing + `$switch` kg; detection stats = `$group` | `web/server/db/mongo.js` |
| **Operator-attributed audit** | optional `operator` (Auth0 `sub`/email) on `pick_events` + `commands`, sparse-indexed; `getPicks({operator})` / `getCommands({operator})` | db layer (needs server-core to stamp it - see below) |
| **Impact aggregation** | waste-avoided / CO₂e / throughput computed in-DB + app layer from real picks | `docs/IMPACT.md` |
| **Atlas Charts** (recommended) | embed a live Atlas Chart (picks/hr, yield) in the dashboard - visible "powered by Atlas" proof judges love | web-frontend: create a chart on `ht6.pick_events`, embed the iframe |
| **Atlas Search** (stretch) | full-text index on `commands.text` -> "search everything anyone asked the robot" | optional |

**Why Time Series is the flagship:** it's the clearest signal we chose Atlas
*on purpose*. Robot telemetry (battery, state, arm, drive at 1 Hz) is textbook
time-series data; the native collection gives automatic time-bucketing, columnar
compression, and TTL expiry that a plain collection can't. Talking point:
*"telemetry lives in an Atlas Time Series collection; analytics come from
aggregation pipelines; nothing is computed in the app that Atlas can do better."*

### Demo / judging checklist (Mongo)
- [ ] Show the Atlas UI: `ht6` cluster, the **Time Series** `telemetry` collection, `pick_events` growing live during a pick.
- [ ] Show an aggregation result (`/api/stats`) and note it's a single `$facet` pipeline.
- [ ] (If done) show an embedded Atlas Chart ticking up as the robot picks.
- [ ] Mention scale: capped/TTL + downsampling keep us safe on M0's 512 MB.

---

## Auth0 - from "login wall" to a *winning* integration

Today: `web/src/main.jsx` + `pages/Teleop.jsx` gate teleop behind Auth0 login
(dev-bypass without creds). That's the baseline every team has. To win, add:

1. **RBAC - `operator` vs `viewer`** (biggest win, real safety story). A viewer
   sees the read-only dashboard; only an `operator` can drive / pick / e-stop a
   *physical* robot. Configure an Auth0 Action to add a `role` (and
   `https://ht6/roles`) custom claim to the ID/access token.
2. **Server-side enforcement (not just hidden UI).** The hub must **verify the
   Auth0 JWT** on control events (`drive`/`arm_pose`/`pick`/`estop`/`nl_command`)
   and reject non-operators - hiding a button isn't security. (server-core: verify
   the RS256 JWT against the Auth0 JWKS on the socket handshake; attach the
   verified identity to the socket.)
3. **Identity -> Atlas attribution.** From the verified token, stamp
   `operator: <sub or email>` onto every `pick_event` and `command` before
   `store.record*`. This is the bridge to the Mongo track (already supported +
   queryable).
4. **Custom claims / Organizations** (stretch): an Auth0 Organization per farm ->
   maps to the Base44 "Orchard OS" multi-tenant story.

### Demo / judging checklist (Auth0)
- [ ] Log in as a **viewer** -> teleop controls disabled/hidden, dashboard visible.
- [ ] Log in as an **operator** -> controls enabled; drive the robot.
- [ ] Show the hub **rejecting** a forged/absent token on a control event (server-side).
- [ ] Show the dashboard's **per-operator audit**: "operator jane@farm did 12 picks / 3 commands" - data straight from Atlas via `getPicks({operator})` / `getCommands({operator})`.

---

## Ownership split

- **db (me) - DONE:** Time Series telemetry, aggregation pipelines, `operator`
  attribution fields + sparse indexes + `getPicks/getCommands({operator})`,
  `recordCommand`. Live on `ht6`, tested both backends.
- **server-core:** verify Auth0 JWT on the socket handshake + control events;
  stamp `operator` onto `pick_event`/`command` before storing; wire the new REST
  routes (`/api/activity`, `/api/timeseries`, `/api/sessions`, `/api/commands`).
- **web-frontend:** RBAC-aware UI (operator vs viewer), pass the Auth0 access
  token on the socket handshake, per-operator audit panel, embed an Atlas Chart.
- **master:** add `operator` as an OPTIONAL field to the root `pick_event`/`command`
  schemas (additive, nullable - db already supports it).

## Hackathon posture (decided)

Login is **real and required**, but we **do not restrict data** - every
logged-in user sees the same shared dashboard. Auth0 identity is used only to
**attribute** actions (`operator` on picks/commands -> Atlas audit trail). So
**roles/RBAC are optional** - skip them for now; the win is "real auth + every
action attributed and stored in Atlas."

## Step-by-step setup (do this once)

**In the Auth0 dashboard (manage.auth0.com):**
1. **Create Application** -> type **Single Page Application**. In its Settings add
   (comma-separated) to *Allowed Callback URLs*, *Logout URLs*, and *Web Origins*:
   `http://localhost:5173, https://<your-vercel-domain>`. Note the **Domain** +
   **Client ID**.
2. **Create API** (Applications -> APIs -> Create API): Identifier =
   `https://ht6-api` (any URI-like string; needn't resolve), Signing = **RS256**.
   The Identifier is the **audience**.
3. **Create a user** (User Management -> Users) with an email + password to log in
   with (or turn on Google social login). One user is enough - no roles needed.

**Send me these 3 values:** Domain, Client ID, API Identifier (audience).

**Where they go (I'll place them / confirm):**
- Frontend `web/.env.local`: `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`,
  `VITE_AUTH0_AUDIENCE` (audience is REQUIRED so Auth0 returns a verifiable JWT,
  not an opaque token).
- Hub `web/server/.env`: `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` (already stubbed).

**Code wired for the credentials:**
- Hub JWT verification + operator attribution - **done** (`web/server/auth.js`;
  handshake middleware + picks/commands stamped in `index.js`).
- Frontend: the Auth0 provider requests the API `audience`; after login it
  obtains a token with `getAccessTokenSilently` and sends it on the Socket.IO
  handshake (`web/src/main.jsx` -> `src/lib/robot.jsx`).
- Dashboard: a small "who did what" audit panel from `/api/commands` +
  `/api/picks` (both return `operator`).

- Mongo: already live (`web/server/.env` -> `MONGODB_URI`), telemetry is a Time
  Series collection. Atlas Charts (optional visual win): enable in the Atlas UI
  on the `hack-the-6ix` project and embed the chart iframe in the dashboard.
