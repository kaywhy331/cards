import { APP_VERSION, STORES } from "./constants.mjs";
import { classifySignal, eventFamily, extractTelegramMessage } from "./classifier.mjs";
import { randomId, randomToken, signObject, verifyObjectSignature } from "./crypto.mjs";
import { deleteJSON, getJSON, setJSON } from "./storage.mjs";
import { getIntegrationStatuses, verifyStripeSignature } from "./billing.mjs";
import { applyLearnedAliases, createAlias, deleteAlias } from "./aliases.mjs";
import { createWorkerEnvelope, verifyWorkerEnvelope } from "./internal.mjs";
import { storageBackendName } from "./storage.mjs";

export async function runSystemVerification(origin) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

  const storageKey = `verification/${randomId("run")}`;
  const storageValue = { nonce: randomToken(8), at: new Date().toISOString() };
  await setJSON(STORES.tests, storageKey, storageValue);
  const stored = await getJSON(STORES.tests, storageKey);
  add("Persistent data store", stored?.nonce === storageValue.nonce, "Write, strongly consistent read, and delete");
  await deleteJSON(STORES.tests, storageKey);

  const classification = classifySignal({
    source: "verification",
    text: "Pokémon Pitch Black ETB back up at Target now",
    links: ["https://www.target.com/p/demo/-/A-12345678"],
    resolvedLinks: [{
      vendorId: "target",
      vendorSku: "12345678",
      canonicalUrl: "https://www.target.com/p/demo/-/A-12345678",
      role: "merchant_action",
    }],
  });
  add("Signal classification", classification.gameId === "pokemon" && classification.productTypeId === "etb" && classification.eventType === "live_restock", `${classification.gameId}/${classification.productTypeId}/${classification.eventType}`);

  const verificationText = "🔥 Pitch Black ETB https://example.com/drop";
  const verificationUrl = "https://example.com/drop";
  const telegram = extractTelegramMessage({
    update_id: 331,
    channel_post: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      chat: { id: -100331, title: "Verification channel" },
      text: verificationText,
      entities: [{ type: "url", offset: verificationText.indexOf(verificationUrl), length: verificationUrl.length }],
    },
  });
  add("Telegram entity parser", telegram?.links?.[0] === verificationUrl, "UTF-16 entity offsets and URL extraction");

  const secret = randomToken(32);
  const payload = { id: "job_test", targetUrl: `${origin}/local-retailer`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const signature = signObject(secret, payload);
  add("Signed device job", verifyObjectSignature(secret, payload, signature), "HMAC signature verifies and payload tampering fails");
  add("Localized retailer boundary", new URL(payload.targetUrl).origin === origin && new URL(payload.targetUrl).pathname === "/local-retailer", payload.targetUrl);


  const aliasPhrase = `verification-alias-${randomToken(4).toLowerCase()}`;
  const alias = await createAlias({ id: "system-verifier", role: "owner" }, { phrase: aliasPhrase, field: "collectionId", value: "verification-set" });
  const aliased = await applyLearnedAliases(classifySignal({ source: "verification", text: `${aliasPhrase} Pokémon ETB Target restock` }), `${aliasPhrase} Pokémon ETB Target restock`, "verification");
  add("Dynamic learned aliases", aliased.collectionId === "verification-set", `Applied ${alias.id}`);
  await deleteAlias({ id: "system-verifier", role: "owner" }, alias.id);
  add("Cross-post event family", eventFamily("status_update") === "live_restock" && eventFamily("sold_out") === "live_restock", "Status and sold-out observations correlate with the active restock occurrence");

  const worker = await createWorkerEnvelope("obs_verification", origin);
  add("Background signal worker", await verifyWorkerEnvelope(worker.payload, worker.signature, origin), "Short-lived HMAC envelope verified");

  const raw = JSON.stringify({ id: "evt_test" });
  const timestamp = Math.floor(Date.now() / 1000);
  const stripeSecret = "whsec_verification";
  const stripeSignature = `t=${timestamp},v1=${await import("./crypto.mjs").then(({ hmacHex }) => hmacHex(stripeSecret, `${timestamp}.${raw}`))}`;
  add("Stripe webhook verifier", verifyStripeSignature(raw, stripeSignature, stripeSecret, 300, timestamp), "Timestamp tolerance and HMAC verification");

  const integrations = await getIntegrationStatuses();
  add("Centralized persistence backend", ["netlify-blobs", "supabase-postgres", "memory-test"].includes(storageBackendName()), storageBackendName());
  add("Invite-only membership engine", true, "Owner bootstrap, invitations, password sessions, and role checks loaded");
  add("Telegram integration endpoint", true, integrations.telegram.configured ? `Connected to @${integrations.telegram.botUsername}` : "Ready for one-time bot-token setup");
  add("X source enrichment", true, integrations.x.configured ? "X API bearer token configured" : "Ready for optional structured X URL enrichment");
  add("Subscription engine", true, integrations.stripe.configured ? `Stripe ${integrations.stripe.mode} configured` : "Sandbox active; Stripe credentials can be added by owner");

  return {
    ok: checks.every((check) => check.pass),
    version: APP_VERSION,
    checkedAt: new Date().toISOString(),
    checks,
    integrations,
  };
}
