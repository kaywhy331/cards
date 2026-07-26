import { PLANS, STORES } from "./constants.mjs";
import {
  decryptString,
  encryptString,
  hmacHex,
  randomToken,
  secureEqual,
} from "./crypto.mjs";
import { HttpError } from "./http.mjs";
import { getJSON, setJSON, storageBackendName } from "./storage.mjs";
import { getUserById, listUsers, updateUser } from "./auth.mjs";

async function masterKey() {
  if (process.env.EZCARDS_MASTER_KEY) return process.env.EZCARDS_MASTER_KEY;
  const key = "vault/master-key";
  const existing = await getJSON(STORES.config, key);
  if (existing?.value) return existing.value;
  const value = randomToken(32);
  const created = await setJSON(STORES.config, key, { value, createdAt: new Date().toISOString() }, { onlyIfNew: true });
  if (created.modified) return value;
  return (await getJSON(STORES.config, key)).value;
}

async function encryptSecret(value) {
  return value ? encryptString(await masterKey(), value) : null;
}

async function decryptSecret(value) {
  return value ? decryptString(await masterKey(), value) : null;
}

export async function configureTelegram({ botToken, origin }) {
  const token = String(botToken || "").trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new HttpError(400, "The Telegram bot token format is invalid.");
  const secret = randomToken(24).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const webhookUrl = `${origin}/api/telegram-webhook`;
  const meResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const me = await meResponse.json();
  if (!me.ok) throw new HttpError(400, me.description || "Telegram rejected the bot token.");
  const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["channel_post", "edited_channel_post", "message", "edited_message"],
      drop_pending_updates: false,
    }),
  });
  const webhook = await webhookResponse.json();
  if (!webhook.ok) throw new HttpError(400, webhook.description || "Telegram webhook configuration failed.");
  const config = {
    configured: true,
    botId: me.result.id,
    botUsername: me.result.username,
    webhookUrl,
    webhookSecret: await encryptSecret(secret),
    configuredAt: new Date().toISOString(),
  };
  await setJSON(STORES.config, "integrations/telegram", config);
  return integrationStatus(config, "telegram");
}

export async function getTelegramWebhookSecret() {
  const config = await getJSON(STORES.config, "integrations/telegram");
  return config?.webhookSecret ? decryptSecret(config.webhookSecret) : null;
}


export async function configureX({ bearerToken }) {
  const token = String(bearerToken || "").trim();
  if (token.length < 20) throw new HttpError(400, "A valid X API bearer token is required.");
  const config = {
    configured: true,
    bearerToken: await encryptSecret(token),
    configuredAt: new Date().toISOString(),
  };
  await setJSON(STORES.config, "integrations/x", config);
  return integrationStatus(config, "x");
}

export async function getXBearerToken() {
  const config = await getJSON(STORES.config, "integrations/x");
  return config?.bearerToken ? decryptSecret(config.bearerToken) : null;
}

export async function configureStripe({ secretKey, webhookSecret, individualPriceId, familyPriceId, mode = "test" }) {
  const key = String(secretKey || "").trim();
  if (!/^sk_(test|live)_/.test(key)) throw new HttpError(400, "A valid Stripe secret key is required.");
  if (!String(webhookSecret || "").startsWith("whsec_")) throw new HttpError(400, "A valid Stripe webhook signing secret is required.");
  if (!String(individualPriceId || "").startsWith("price_") || !String(familyPriceId || "").startsWith("price_")) {
    throw new HttpError(400, "Stripe Price IDs are required for both paid plans.");
  }
  const config = {
    configured: true,
    mode: key.startsWith("sk_live_") ? "live" : mode === "live" ? "live" : "test",
    secretKey: await encryptSecret(key),
    webhookSecret: await encryptSecret(String(webhookSecret).trim()),
    prices: {
      individual: String(individualPriceId).trim(),
      family: String(familyPriceId).trim(),
    },
    configuredAt: new Date().toISOString(),
  };
  await setJSON(STORES.config, "integrations/stripe", config);
  return integrationStatus(config, "stripe");
}

function integrationStatus(config, name) {
  if (!config) return { name, configured: false };
  return {
    name,
    configured: Boolean(config.configured),
    mode: config.mode || null,
    botUsername: config.botUsername || null,
    webhookUrl: config.webhookUrl || null,
    prices: config.prices || null,
    configuredAt: config.configuredAt || null,
  };
}

export async function getIntegrationStatuses() {
  const telegram = await getJSON(STORES.config, "integrations/telegram");
  const stripe = await getJSON(STORES.config, "integrations/stripe");
  const x = await getJSON(STORES.config, "integrations/x");
  return {
    telegram: integrationStatus(telegram, "telegram"),
    x: integrationStatus(x, "x"),
    stripe: integrationStatus(stripe, "stripe"),
    storage: { name: storageBackendName(), configured: true },
  };
}

async function getStripeConfig() {
  const config = await getJSON(STORES.config, "integrations/stripe");
  if (!config?.configured) throw new HttpError(409, "Stripe has not been configured by an administrator.");
  return {
    ...config,
    secretKeyPlain: await decryptSecret(config.secretKey),
    webhookSecretPlain: await decryptSecret(config.webhookSecret),
  };
}

export async function createCheckoutSession(user, planId, origin) {
  if (!["individual", "family"].includes(planId)) throw new HttpError(400, "Choose an Individual or Family membership.");
  const config = await getStripeConfig();
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("line_items[0][price]", config.prices[planId]);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", `${origin}/#membership-success`);
  body.set("cancel_url", `${origin}/#membership`);
  body.set("client_reference_id", user.id);
  if (user.stripeCustomerId) body.set("customer", user.stripeCustomerId);
  else body.set("customer_email", user.email);
  body.set("metadata[user_id]", user.id);
  body.set("metadata[plan_id]", planId);
  body.set("subscription_data[metadata][user_id]", user.id);
  body.set("subscription_data[metadata][plan_id]", planId);
  body.set("allow_promotion_codes", "true");

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKeyPlain}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const session = await response.json();
  if (!response.ok || !session.url) throw new HttpError(502, session.error?.message || "Stripe Checkout session creation failed.");
  await setJSON(STORES.billing, `checkout-sessions/${session.id}`, {
    id: session.id,
    userId: user.id,
    planId,
    createdAt: new Date().toISOString(),
    mode: config.mode,
  });
  return { id: session.id, url: session.url, mode: config.mode };
}

export async function createBillingPortalSession(user, origin) {
  if (!user.stripeCustomerId) throw new HttpError(409, "No Stripe customer is associated with this membership yet.");
  const config = await getStripeConfig();
  const body = new URLSearchParams();
  body.set("customer", user.stripeCustomerId);
  body.set("return_url", `${origin}/#membership`);
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKeyPlain}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.url) throw new HttpError(502, session.error?.message || "Stripe customer portal creation failed.");
  return { id: session.id, url: session.url, mode: config.mode };
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map((item) => item.split("=", 2)).filter((pair) => pair.length === 2));
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  return secureEqual(hmacHex(secret, `${timestamp}.${rawBody}`), signature);
}

async function userFromStripeObject(object) {
  const userId = object?.metadata?.user_id || object?.client_reference_id || object?.subscription_details?.metadata?.user_id;
  if (userId) return getUserById(userId);
  const customerId = typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  if (!customerId) return null;
  return (await listUsers()).find((user) => user.stripeCustomerId === customerId) || null;
}

export async function processStripeWebhook(rawBody, signatureHeader) {
  const config = await getStripeConfig();
  if (!verifyStripeSignature(rawBody, signatureHeader, config.webhookSecretPlain)) {
    throw new HttpError(400, "Stripe webhook signature verification failed.");
  }
  let event;
  try { event = JSON.parse(rawBody); } catch { throw new HttpError(400, "Stripe webhook body is not valid JSON."); }
  if (!event?.id || !event?.type || !event?.data) throw new HttpError(400, "Stripe webhook event is incomplete.");
  const eventClaim = await setJSON(STORES.billing, `stripe-events/${event.id}`, { type: event.type, receivedAt: new Date().toISOString() }, { onlyIfNew: true });
  if (!eventClaim.modified) return { duplicate: true, eventId: event.id };
  const object = event.data?.object;
  const user = await userFromStripeObject(object);
  if (!user) return { processed: false, eventId: event.id, reason: "No matching user" };

  const planId = object?.metadata?.plan_id || user.planId || "individual";
  if (event.type === "checkout.session.completed") {
    await updateUser(user.id, {
      planId: PLANS[planId] ? planId : "individual",
      subscriptionStatus: "active",
      stripeCustomerId: typeof object.customer === "string" ? object.customer : object.customer?.id,
      stripeSubscriptionId: typeof object.subscription === "string" ? object.subscription : object.subscription?.id,
    });
  } else if (event.type.startsWith("customer.subscription.")) {
    const status = event.type === "customer.subscription.deleted" ? "canceled" : object.status || "active";
    await updateUser(user.id, {
      planId: PLANS[planId] ? planId : user.planId,
      subscriptionStatus: status,
      stripeCustomerId: typeof object.customer === "string" ? object.customer : object.customer?.id,
      stripeSubscriptionId: object.id,
    });
  } else if (event.type === "invoice.payment_failed") {
    await updateUser(user.id, { subscriptionStatus: "past_due" });
  }
  return { processed: true, eventId: event.id, userId: user.id, type: event.type };
}

export async function activateSandboxMembership(user, planId) {
  if (!["individual", "family", "beta"].includes(planId)) throw new HttpError(400, "Invalid sandbox membership.");
  const stripe = await getJSON(STORES.config, "integrations/stripe");
  if (stripe?.configured && !["owner", "admin"].includes(user.role)) {
    throw new HttpError(403, "Sandbox plan activation is disabled after Stripe is configured.");
  }
  return updateUser(user.id, {
    planId,
    subscriptionStatus: planId === "beta" ? "beta" : "sandbox",
  });
}
