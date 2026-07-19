# deploy — status log

## [22:05] DONE — vercel.json created, build verified
- web/vercel.json: Vite framework config, SPA rewrite (everything except /assets/* → index.html), immutable caching for hashed assets, no-cache for HTML.
- `npm run build` in web/ passes clean (vite 8.1.5, 191 kB js / 60 kB gz).
- Next: initial prod deploy via vercel CLI to verify the pipeline, then docs/DEPLOY.md.

## [22:06] DONE — initial prod deploy live
- Deployed via `vercel deploy --prod --yes` from web/. **Prod URL: https://hack-the-6ix-chi.vercel.app** (also https://hack-the-6ix-daniel-w-lius-projects.vercel.app).
- ⚠️ NOTE: plain `hack-the-6ix.vercel.app` is someone ELSE'S project (a CRA app) — do not put that URL on slides/devpost; use the -chi one.
- Verified: SPA rewrite (/teleop → 200 index.html), asset caching headers, our Vite bundle served.
- FYI web-frontend: index.html `<title>` is still "web" — worth branding when you touch it (your file, not mine).
- Next: docs/DEPLOY.md runbook + VITE_SERVER_URL env story.

## [22:06] DONE — docs/DEPLOY.md runbook written
- Covers: deploy commands, rollback, VITE_SERVER_URL (build-time!) procedure, venue networking + judges-phone plan, day-of checklist.
- Key gotcha documented: Vercel is HTTPS → mixed-content blocks ws:// to http://laptop:3001. Plan A = cloudflared/ngrok tunnel on the laptop, set VITE_SERVER_URL to tunnel URL, redeploy (~2 min). Plan B = judges on hotspot hit laptop directly over http.
- server-core: please include https://hack-the-6ix-chi.vercel.app in CORS allowed origins (or reflect origin).

## [22:06] BLOCKED (partial) — VITE_SERVER_URL prod value
- Cannot set until venue: needs laptop hotspot IP or tunnel URL (exists only day-of). Procedure fully documented in docs/DEPLOY.md §Env vars. No env vars currently set on Vercel (verified via vercel env ls); frontend defaults to localhost:3001 which is correct for now.
- Now on standby: polling web-frontend status → will build-verify + redeploy prod at each frontend milestone.

## [22:07] DONE — CI build check + runbook tuned to installed tools
- .github/workflows/web-build.yml: on push/PR touching web/** → npm ci, lint, build (Node 22). Lint verified exit 0 locally (warnings only), build green — CI will pass on first push.
- DEPLOY.md updated: ngrok (installed) is the tunnel plan; cloudflared is not on this laptop.
- All 4 assigned tasks done or blocked-on-venue. Standing by: watching web-frontend status → build-verify + `vercel deploy --prod --yes` at each milestone. Prod: https://hack-the-6ix-chi.vercel.app

## [restart] WIP — resuming after crash; frontend milestone detected, redeploying
- Restarted worker deploy. Re-read assignments + BROADCAST (phase-2 has no new deploy directive; VITE_SERVER_URL still venue-deferred as before). No long-running processes owned by me (build+deploy role) — nothing to restart.
- Vercel authed (danielwliu07), project linked. `npm run build` passes clean (vite 8.1.5).
- Frontend has advanced since my last prod deploy (22:06 was 191 kB single chunk; now 339 kB main + code-split 902 kB LidarView chunk = lidar/three.js + teleop landed). Redeploying prod now.

## [restart+] DONE — prod redeployed with latest frontend, verified
- `vercel deploy --prod --yes` → dpl_273r3ra3WgmejrYgUbWa24EA9Xj9, READY, target production. Remote build clean.
- Verified prod alias **https://hack-the-6ix-chi.vercel.app** resolves to that deployment (vercel inspect). `/` → 200, `/teleop` SPA rewrite → 200, our Vite bundle served. (Bundle hash differs from local build — Vercel builds remotely, expected.)
- VITE_SERVER_URL still venue-deferred (no env vars set; localhost:3001 default correct until day-of tunnel/hotspot IP). Back on standby: will build-verify + redeploy at each further frontend milestone.

## [restart++] DONE — r3f hero ship handled by master; stood down, resumed milestone-watch
- Human-priority standby was for web-frontend flipping `USE_R3F_HERO=true`. Flag flipped (App.jsx:17), I build-verified clean (OrchardHero 4.7KB gz chunk + Gltf 254KB gz three/GLB chunk, no breakage) and was deploy-ready, holding on their status-DONE gate.
- Master shipped it directly before the gate landed. Human told me to stand down. Verified prod alias **https://hack-the-6ix-chi.vercel.app** now serves dpl_BXiBrTZjBtFoFHgTrbD7F4SsAV8C (master's r3f-hero deploy). No redundant deploy from me.
- Resumed normal milestone-watch (baseline web-frontend.md = 63 lines). Will build-verify + redeploy at the next frontend milestone.

## [restart+++] WIP — reconciled deploy state; DEFERRING landing deploys to master (human call)
- web-frontend itself crashed+recovered and rewrote its status (newest-first). Heavy landing churn now resolved: landing = OrchardHero ONLY (sky dome + meadow + FOV 25), world.glb overlay in LidarView. All entries DONE; tree builds clean.
- Prod alias → dpl_APi4WzjLnzqGL2nB1 (deployed 23:29:06) already carries master's `[landing-final]` ship (App.jsx 23:27, world.glb 23:23). One later edit `OrchardHero.jsx` @23:31:21 postdates that deploy with NO status DONE backing it → prod is ~1 substantive edit behind.
- **Master has self-deployed all landing changes (4 prod deploys/40min); human directed me to DEFER to master (hold), not race.** So I did NOT redeploy. Per decision: only ship NON-landing frontend milestones going forward; master owns landing/hero deploys.
- My earlier line-count watchers false-tripped on this actively-appended file. Replaced with a robust DONE-heading-set diff watcher that ignores landing/hero/orchard/scene entries.

## [03:29] DONE - og/social meta tags + painterly card + unfurl verified + redeployed
- Task from BROADCAST make-it-better round: og/social meta in index.html + verify unfurl + redeploy.
- Edited web/index.html (master-directed; web-frontend normally owns it, heads-up: I touched only the head meta, no body/script changes). Added Open Graph (type, site_name, title, description, url, image + type/width/height/alt) and Twitter (summary_large_image, title, description, image). Fixed the title em dash to a colon per the new style rule; scanned the file clean of emoji/em dash/arrows/ellipsis.
- Card image: web/public/og-card.png, 1200x630 png, cropped from web-frontend's OrchardHero landing capture (painterly apple tree + meadow). Matches what the live landing shows.
- Redeployed prod: dpl_HAQ3geS97iqpG51JSXZoArkoyU3t, READY. Alias hack-the-6ix-chi.vercel.app resolves to it.
- Verified unfurl: fetched prod HTML as facebookexternalhit, all og+twitter tags present; og:image (absolute URL) returns 200 image/png 722846 bytes at 1200x630; title correct. Definitive human check: paste the URL into Slack/iMessage to eyeball the rendered card.
- Note: og:image is 722 KB (well under scraper caps). VITE_SERVER_URL still empty in prod (localhost fallback, venue tunnel step unchanged).

## [21:41] DONE - LIVE DATA WIRED: prod pulls real robot data via Tailscale Funnel
- Set up the public tunnel: Tailscale Funnel (open-source brew tailscale, daemon started via sudo brew services, human enabled Funnel in admin console). Command: tailscale funnel --bg 3001 (persistent background).
- Public URL: https://daniels-macbook-pro.tailaa0f4f.ts.net proxies to hub :3001. Verified from the Vercel origin via the public ingress IP: /api/health 200, socket.io handshake 200. CORS already reflects the vercel origin (server-core origin:true).
- Set VITE_SERVER_URL to that funnel URL in Vercel prod (vercel env pull mis-reports it as empty, IGNORE - the remote build injected it correctly). Redeployed: dpl_HMwrcTF131gy2oHoj4LsLZa74x1V READY. Confirmed the funnel host is baked into the prod bundle (grep of assets/index-*.js).
- Result: anyone opening https://hack-the-6ix-chi.vercel.app gets live telemetry/detections/lidar (hub broadcasts to all ui clients).
- CAVEATS: (1) keep-alive - funnel survives closing the terminal but NOT laptop sleep/reboot or tailscaled stop; re-run tailscale funnel --bg 3001 if it drops. Hub :3001 + robot node must stay running. (2) THIS laptop's local DNS returns NXDOMAIN for ts.net, so testing prod live-data from this same laptop's browser may fail; test from a phone (cellular) where public DNS resolves. (3) 2D C1 lidar needs the Pi online + its client pointed at the hub (rpi was offline); phone-lidar world.glb is already deployed static. (4) teleop stays Auth0-gated.

## [18:07] WIP - prod healthy but stale; HOLDING per human (defer to master)
- Deployment check: prod dpl_CNtbXiRRYQ5fKgvh5tkrUF475J2d Ready, serving fine (routes 200, real app bundle loads, og meta + card intact). Last deploy 10:38 (~7.5h ago).
- Working tree is ~72 frontend files ahead of prod (new pages Harvest/Swarm, FarmHandChat, RobotPOV/MonkeyStage/tv-intro, reworked Analytics/Teleop/LidarView, new assets). Tree builds clean (658 modules).
- Frontend workers editing live (newest change 27s ago). Human decision: HOLD, defer landing/scene/stage deploys to master. Did NOT redeploy.
- Prod remains fully functional as a static + sim demo; a redeploy is a clean ~40s op whenever master/human wants the pending work live.
