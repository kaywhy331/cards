import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.NODE_ENV = "test";
process.env.EZCARDS_MEMORY_STORE = "1";

const storage = await import("../netlify/lib/storage.mjs");
const auth = await import("../netlify/lib/auth.mjs");
const classifier = await import("../netlify/lib/classifier.mjs");
const rules = await import("../netlify/lib/rules.mjs");
const devices = await import("../netlify/lib/devices.mjs");
const cryptoLib = await import("../netlify/lib/crypto.mjs");
const signals = await import("../netlify/lib/signals.mjs");
const billing = await import("../netlify/lib/billing.mjs");
const system = await import("../netlify/lib/system.mjs");
const aliases = await import("../netlify/lib/aliases.mjs");
const internal = await import("../netlify/lib/internal.mjs");
const apiHandler = (await import("../netlify/functions/api.mjs")).default;
const signalWorker = (await import("../netlify/functions/signal-worker.mjs")).default;

async function clean() { await storage.resetMemoryStores(); }

test("Telegram parser honors emoji/UTF-16 entity offsets", async () => {
  await clean();
  const text = "🔥 Pitch Black ETB https://example.com/drop";
  const url = "https://example.com/drop";
  const parsed = classifier.extractTelegramMessage({
    update_id: 1,
    channel_post: {
      message_id: 9,
      date: 1_800_000_000,
      chat: { id: -1001, title: "Owned relay" },
      text,
      entities: [{ type: "url", offset: text.indexOf(url), length: url.length }],
    },
  });
  assert.deepEqual(parsed.links, [url]);
  assert.equal(parsed.kind, "channel_post");
});

test("classifier recognizes live Target Pokémon ETB and canonical merchant evidence", () => {
  const result = classifier.classifySignal({
    source: "test",
    text: "Pokémon Pitch Black ETB back up at Target now",
    links: ["https://www.target.com/p/demo/-/A-12345678"],
    resolvedLinks: [{
      vendorId: "target",
      vendorSku: "12345678",
      canonicalUrl: "https://www.target.com/p/demo/-/A-12345678",
      role: "merchant_action",
    }],
  });
  assert.equal(result.gameId, "pokemon");
  assert.equal(result.productTypeId, "etb");
  assert.equal(result.vendorId, "target");
  assert.equal(result.eventType, "live_restock");
  assert.equal(result.actionable, true);
  assert.ok(result.confidence >= 0.72);
});

test("status confirmations merge into one canonical live event", async () => {
  await clean();
  const first = await signals.ingestObservation({
    source: "telegram",
    sourceId: "relay:1",
    text: "Pokémon Pitch Black ETB back up at Target now",
    postedAt: new Date().toISOString(),
  }, { origin: "https://ezcards.netlify.app" });
  assert.equal(first.duplicate, false);
  const second = await signals.ingestObservation({
    source: "telegram",
    sourceId: "relay:2",
    text: "Still seeing success on Pokémon Pitch Black ETBs at Target",
    postedAt: new Date(Date.now() + 5_000).toISOString(),
  }, { origin: "https://ezcards.netlify.app" });
  assert.equal(second.duplicate, false);
  const events = await signals.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].observationCount, 2);
  assert.equal(events[0].eventFamily, "live_restock");
});

test("same external X source is deduplicated across relay messages", async () => {
  await clean();
  const first = await signals.ingestObservation({ source: "telegram", sourceId: "a:1", externalSourceId: "x:331", text: "Pokémon ETB at Target" }, { origin: "https://ezcards.netlify.app" });
  const second = await signals.ingestObservation({ source: "telegram", sourceId: "b:2", externalSourceId: "x:331", text: "Forwarded Pokémon ETB at Target" }, { origin: "https://ezcards.netlify.app" });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.duplicateKind, "external_source");
  assert.equal((await signals.listObservations()).length, 1);
});



test("edited Telegram source identities create a new version without duplicate event fan-out", async () => {
  await clean();
  const first = await signals.ingestObservation({
    source: "telegram", sourceId: "-100331:44", externalSourceId: "x:9001",
    text: "Pokémon Pitch Black ETB at Target announcement", postedAt: new Date().toISOString(),
  }, { origin: "https://ezcards.netlify.app" });
  const edited = await signals.ingestObservation({
    source: "telegram", sourceId: "-100331:44", externalSourceId: "x:9001",
    text: "Pokémon Pitch Black ETB back up at Target now", postedAt: new Date(Date.now() + 1_000).toISOString(), editedAt: new Date().toISOString(),
  }, { origin: "https://ezcards.netlify.app" });
  assert.equal(first.duplicate, false);
  assert.equal(edited.duplicate, false);
  assert.equal(edited.observation.version, 2);
  assert.equal(edited.observation.previousObservationId, first.observation.id);
  assert.equal((await signals.listObservations()).length, 2);
});

test("curator event review validates taxonomy and republishes a canonical event", async () => {
  await clean();
  await signals.ingestObservation({ source: "manual", sourceId: "review:1", text: "mystery drop coming soon" }, { origin: "https://ezcards.netlify.app" });
  const event = (await signals.listEvents())[0];
  await assert.rejects(() => signals.updateEvent(event.id, { gameId: "invented" }), /Invalid game ID/);
  const reviewed = await signals.updateEvent(event.id, {
    gameId: "pokemon", collectionId: "pitch-black", productTypeId: "etb", vendorId: "retailer-lab",
    eventType: "scheduled_drop", status: "SCHEDULED", productName: "Pitch Black ETB Local Review",
  }, { origin: "https://ezcards.netlify.app" });
  assert.equal(reviewed.event.status, "SCHEDULED");
  assert.equal(reviewed.event.reviewRequired, false);
});

test("watch rules use AND across categories, OR within a category, and exclusions override", () => {
  const rule = {
    enabled: true,
    gameIds: ["pokemon", "one-piece"],
    collectionIds: [],
    productTypeIds: ["etb", "upc"],
    vendorIds: ["target", "pokemon-center"],
    eventTypes: ["live_restock"],
    excludeCollectionIds: ["blocked-set"],
    excludeProductTypeIds: [],
    excludeVendorIds: [],
  };
  assert.equal(rules.evaluateRule(rule, { gameId: "pokemon", collectionId: "pitch-black", productTypeId: "etb", vendorId: "target", eventType: "live_restock" }).matched, true);
  assert.equal(rules.evaluateRule(rule, { gameId: "pokemon", collectionId: "pitch-black", productTypeId: "booster-box", vendorId: "target", eventType: "live_restock" }).matched, false);
  assert.equal(rules.evaluateRule(rule, { gameId: "pokemon", collectionId: "blocked-set", productTypeId: "etb", vendorId: "target", eventType: "live_restock" }).matched, false);
});

test("invite-only account, password session, rule, device pairing, and signed local job work end-to-end", async () => {
  await clean();
  const owner = await auth.createUser({ email: "owner@example.test", password: "owner-password-331", name: "Owner", role: "owner", planId: "beta" });
  const invite = await auth.createInvite(owner, { email: "member@example.test", role: "member", planId: "beta" });
  const registered = await auth.registerWithInvite({ code: invite.code, email: "member@example.test", password: "member-password-331", name: "Member" });
  assert.equal(registered.user.role, "member");
  const loggedIn = await auth.login({ email: "member@example.test", password: "member-password-331" });
  assert.equal(loggedIn.user.id, registered.user.id);
  const rule = await rules.createRule(registered.user, { name: "Local lab", gameIds: ["pokemon"], productTypeIds: ["etb"], vendorIds: ["retailer-lab"], eventTypes: ["scheduled_drop"], action: "queue_assist" });
  assert.equal(rule.userId, registered.user.id);
  const pairing = await devices.createPairing(registered.user);
  const claimed = await devices.claimPairing({ code: pairing.code, name: "Test Chrome", platform: "test", browser: "Chromium", extensionVersion: "0.4.0" });
  const job = await devices.createDemoJob(registered.user, "https://ezcards.netlify.app");
  const { signature, status, createdAt, updatedAt, eventConfirmationCount, ...payload } = job;
  assert.equal(cryptoLib.verifyObjectSignature(claimed.signingSecret, payload, signature), true);
  assert.equal(new URL(job.targetUrl).pathname, "/local-retailer");
  assert.equal(status, "PENDING");
});

test("Stripe webhook signature verifier rejects tampering", () => {
  const raw = JSON.stringify({ id: "evt_331", data: { object: {} } });
  const secret = "whsec_test_331";
  const timestamp = 1_800_000_000;
  const signature = `t=${timestamp},v1=${cryptoLib.hmacHex(secret, `${timestamp}.${raw}`)}`;
  assert.equal(billing.verifyStripeSignature(raw, signature, secret, 300, timestamp), true);
  assert.equal(billing.verifyStripeSignature(`${raw} `, signature, secret, 300, timestamp), false);
});

test("system completion verification passes in isolated memory mode", async () => {
  await clean();
  const result = await system.runSystemVerification("https://ezcards.netlify.app");
  assert.equal(result.ok, true);
  assert.ok(result.checks.length >= 12);
  assert.equal(result.checks.every((check) => check.pass), true);
});



test("learned aliases dynamically correct a classification and validate canonical values", async () => {
  await clean();
  const actor = { id: "curator-test", role: "curator" };
  const alias = await aliases.createAlias(actor, { phrase: "black box drop", field: "collectionId", value: "pitch-black" });
  const initial = classifier.classifySignal({ source: "telegram", text: "Pokémon black box drop ETB at Target restock" });
  const applied = await aliases.applyLearnedAliases(initial, "Pokémon black box drop ETB at Target restock", "telegram");
  assert.equal(applied.collectionId, "pitch-black");
  assert.ok(applied.appliedAliasIds.includes(alias.id));
  await assert.rejects(() => aliases.createAlias(actor, { phrase: "bad game", field: "gameId", value: "invented-game" }), /Invalid game alias value/);
});

test("background worker envelopes are short-lived, signed, and origin-bound", async () => {
  await clean();
  const envelope = await internal.createWorkerEnvelope("obs_331", "https://ezcards.netlify.app");
  assert.equal(await internal.verifyWorkerEnvelope(envelope.payload, envelope.signature, "https://ezcards.netlify.app/api-worker/process-signal"), true);
  assert.equal(await internal.verifyWorkerEnvelope({ ...envelope.payload, observationId: "obs_tampered" }, envelope.signature, "https://ezcards.netlify.app"), false);
  assert.equal(await internal.verifyWorkerEnvelope(envelope.payload, envelope.signature, "https://example.test"), false);
});



test("signed background worker processes a deferred signal observation", async () => {
  await clean();
  let queuedId = null;
  const accepted = await signals.ingestObservation({ source: "telegram", sourceId: "worker:1", text: "Pokémon Pitch Black ETB restock at Target" }, {
    origin: "https://ezcards.netlify.app",
    defer: async (id) => { queuedId = id; },
  });
  assert.equal(accepted.deferred, true);
  assert.equal(accepted.observation.status, "RECEIVED");
  const envelope = await internal.createWorkerEnvelope(queuedId, "https://ezcards.netlify.app");
  await signalWorker(new Request("https://ezcards.netlify.app/api-worker/process-signal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ezcards-internal-signature": envelope.signature },
    body: JSON.stringify(envelope.payload),
  }));
  assert.equal((await signals.listObservations())[0].status, "PROCESSED");
  assert.equal((await signals.listEvents()).length, 1);
});

test("API membership flow covers sessions, invitations, rules, device pairing, signed jobs, and device status", async () => {
  await clean();
  const owner = await auth.createUser({ email: "api-owner@example.test", password: "owner-password-331", name: "API Owner", role: "owner", planId: "beta" });
  const ownerToken = await auth.issueSession(owner);
  const ownerCookie = auth.sessionCookie(ownerToken).split(";")[0];
  const request = (path, { method = "GET", body, cookie, headers = {} } = {}) => new Request(`https://ezcards.netlify.app/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const call = async (path, options) => {
    const response = await apiHandler(request(path, options), { deploy: { context: "test" }, ip: "127.0.0.1" });
    const payload = await response.json();
    assert.equal(payload.ok, true, payload.error || `${path} failed`);
    return { response, payload };
  };

  const invite = (await call("/invites", { method: "POST", cookie: ownerCookie, body: { email: "api-member@example.test", role: "member", planId: "beta" } })).payload.invite;
  const registration = await call("/auth/register", { method: "POST", body: { code: invite.code, email: "api-member@example.test", password: "member-password-331", name: "API Member" } });
  const memberCookie = registration.response.headers.get("set-cookie").split(";")[0];
  assert.equal(registration.payload.user.role, "member");

  const rulesResponse = await call("/rules", { cookie: memberCookie });
  assert.ok(rulesResponse.payload.rules.length >= 1);
  const pairing = (await call("/devices/pair", { method: "POST", cookie: memberCookie, body: {} })).payload.pairing;
  const claimed = (await call("/devices/claim", { method: "POST", body: { code: pairing.code, name: "API Chromium", platform: "test", browser: "Chromium", extensionVersion: "0.5.0" } })).payload;
  const demo = (await call("/devices/demo-job", { method: "POST", cookie: memberCookie, body: {} })).payload.job;
  assert.equal(new URL(demo.targetUrl).pathname, "/local-retailer");

  const jobs = await call("/devices/jobs", { headers: { "x-device-id": claimed.device.id, "x-device-token": claimed.authToken } });
  assert.equal(jobs.payload.jobs.length, 1);
  const status = await call(`/devices/jobs/${demo.jobId}/status`, { method: "POST", headers: { "x-device-id": claimed.device.id, "x-device-token": claimed.authToken }, body: { status: "OPENED", metadata: { pageState: "PRODUCT", path: "/local-retailer" } } });
  assert.equal(status.payload.job.status, "OPENED");
});

test("paid-plan sandbox activation is disabled for members after Stripe is configured", async () => {
  await clean();
  const member = await auth.createUser({ email: "billing-member@example.test", password: "member-password-331", name: "Billing Member", role: "member", planId: "beta" });
  await storage.setJSON("ezcards-config-v1", "integrations/stripe", { configured: true, mode: "test" });
  await assert.rejects(() => billing.activateSandboxMembership(member, "individual"), /disabled after Stripe is configured/);
});

test("localized retailer and AIO pages expose explicit safety/state markers", async () => {
  const retailer = await readFile(new URL("../retailer-lab.html", import.meta.url), "utf8");
  const lab = await readFile(new URL("../lab.html", import.meta.url), "utf8");
  assert.match(retailer, /LOCAL EDUCATION LAB/);
  assert.match(retailer, /data-ezcards-lab-state/);
  assert.match(lab, /LOCALIZED EDUCATION MODE/);
});
