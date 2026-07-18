// Base44 "Orchard OS" webhook forwarder tests (web/server/base44.js).
//
// forwardPickEvent() is env-gated and fire-and-forget, so we test it directly
// (no hub needed) against a throwaway local HTTP server that captures what the
// forwarder POSTs. This is the deterministic way to prove the PickReport body,
// the shared-secret header, and the "disabled unless configured" contract from
// docs/BASE44.md - without ever touching the real Orchard OS endpoint.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { forwardPickEvent, base44Enabled } from "../base44.js";
import { SAMPLES, sleep } from "./helpers.js";

// env keys this module reads - snapshot & restore so tests don't leak into each
// other or into whatever launched `npm test`.
const ENV_KEYS = ["BASE44_WEBHOOK_URL", "BASE44_SECRET", "BASE44_JOB_ID", "BASE44_TIMEOUT_MS"];
const saved = {};

let server, url;
let received; // { headers, body } of the last POST the mock got
let respond;  // (req,res) => void - per-test override of the mock's reply

before(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      received = { method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      if (respond) return respond(req, res);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/webhook`;
});

after(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  received = undefined;
  respond = null;
  for (const k of ENV_KEYS) delete process.env[k];
});

test("disabled when BASE44_WEBHOOK_URL is unset (no POST, base44Enabled false)", async () => {
  assert.equal(base44Enabled(), false);
  await forwardPickEvent(SAMPLES.pick_event);
  await sleep(100);
  assert.equal(received, undefined, "forwarder must not POST when disabled");
});

test("enabled forwards a PickReport with the documented body shape", async () => {
  process.env.BASE44_WEBHOOK_URL = url;
  process.env.BASE44_SECRET = "s3cr3t";
  assert.equal(base44Enabled(), true);

  await forwardPickEvent(SAMPLES.pick_event);
  await sleep(150);

  assert.ok(received, "forwarder did not POST to the webhook");
  assert.equal(received.method, "POST");
  assert.equal(received.headers["content-type"], "application/json");
  assert.equal(received.headers["x-base44-secret"], "s3cr3t", "shared secret header missing/wrong");
  // docs/BASE44.md prompt 5: {job_id, fruit, ripeness, bin, success, ts}
  assert.deepEqual(received.body, {
    fruit: SAMPLES.pick_event.fruit,
    ripeness: SAMPLES.pick_event.ripeness,
    bin: SAMPLES.pick_event.bin,
    success: SAMPLES.pick_event.success,
    ts: SAMPLES.pick_event.ts,
  }, "PickReport body drifted from the docs/BASE44.md contract");
  assert.ok(!("duration_ms" in received.body), "internal-only fields must not leak to Base44");
});

test("tags the report with BASE44_JOB_ID when set", async () => {
  process.env.BASE44_WEBHOOK_URL = url;
  process.env.BASE44_JOB_ID = "job-42";
  await forwardPickEvent(SAMPLES.pick_event);
  await sleep(150);
  assert.ok(received);
  assert.equal(received.body.job_id, "job-42");
});

test("omits the secret header when BASE44_SECRET is unset", async () => {
  process.env.BASE44_WEBHOOK_URL = url;
  await forwardPickEvent(SAMPLES.pick_event);
  await sleep(150);
  assert.ok(received);
  assert.ok(!("x-base44-secret" in received.headers), "no secret header should be sent when unset");
});

test("a failing webhook (500) never throws into the caller", async () => {
  process.env.BASE44_WEBHOOK_URL = url;
  respond = (_req, res) => { res.writeHead(500); res.end("boom"); };
  // must resolve, not reject - the forwarder is fire-and-forget by contract
  await forwardPickEvent(SAMPLES.pick_event);
  assert.ok(true);
});

test("an unreachable webhook never throws into the caller", async () => {
  // nothing is listening on this port
  process.env.BASE44_WEBHOOK_URL = "http://127.0.0.1:1/webhook";
  await forwardPickEvent(SAMPLES.pick_event);
  assert.ok(true);
});

test("a slow webhook is abandoned via timeout without throwing", async () => {
  process.env.BASE44_WEBHOOK_URL = url;
  process.env.BASE44_TIMEOUT_MS = "200";
  respond = (_req, _res) => { /* hang, never respond */ };
  const started = Date.now();
  await forwardPickEvent(SAMPLES.pick_event);
  assert.ok(Date.now() - started < 3000, "forwarder should give up promptly on a hung webhook");
});
