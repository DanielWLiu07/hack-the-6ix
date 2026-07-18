// Base44 "Orchard OS" webhook forwarder (docs/BASE44.md -> Integration).
// On every real pick_event, POST a PickReport to the Base44 app's webhook so a
// pick on stage shows up in Orchard OS seconds later (ROI ticks up live).
//
// Fully env-gated: with BASE44_WEBHOOK_URL unset this is a no-op, so the hub
// runs identically when the Base44 build isn't wired yet.
//   BASE44_WEBHOOK_URL  - the automation/endpoint URL (unset => disabled)
//   BASE44_SECRET       - shared secret, sent as X-Base44-Secret header
//   BASE44_JOB_ID       - optional HarvestJob id to tag reports with
//   BASE44_TIMEOUT_MS   - per-request timeout (default 4000)

const URL_ENV = () => process.env.BASE44_WEBHOOK_URL;
const SECRET = () => process.env.BASE44_SECRET;
const JOB_ID = () => process.env.BASE44_JOB_ID;
const TIMEOUT_MS = () => Number(process.env.BASE44_TIMEOUT_MS) || 4000;

export function base44Enabled() {
  return Boolean(URL_ENV());
}

let warnedNoSecret = false;
let lastErrLog = 0;

// Map our root-schema pick_event -> Base44 webhook body (prompt 5):
// { job_id, fruit, ripeness, bin, success, ts }
function toReport(pick) {
  const body = {
    fruit: pick.fruit,
    ripeness: pick.ripeness,
    bin: pick.bin,
    success: pick.success,
    ts: pick.ts,
  };
  const job = JOB_ID();
  if (job) body.job_id = job;
  return body;
}

// Fire-and-forget: never throws into the hub, never blocks event relay.
export async function forwardPickEvent(pick) {
  const url = URL_ENV();
  if (!url) return; // disabled
  const secret = SECRET();
  if (!secret && !warnedNoSecret) {
    warnedNoSecret = true;
    console.warn('[base44] BASE44_WEBHOOK_URL set without BASE44_SECRET - sending without secret header');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS());
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Base44-Secret': secret } : {}),
      },
      body: JSON.stringify(toReport(pick)),
      signal: controller.signal,
    });
    if (!res.ok) throwLater(`HTTP ${res.status}`);
  } catch (err) {
    throwLater(err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS()}ms` : err.message);
  } finally {
    clearTimeout(timer);
  }
}

// Rate-limited error log so a down webhook can't spam the console mid-demo.
function throwLater(msg) {
  const now = Date.now();
  if (now - lastErrLog > 10000) {
    lastErrLog = now;
    console.warn('[base44] pick_event forward failed:', msg);
  }
}
