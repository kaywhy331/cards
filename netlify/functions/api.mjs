import { APP_NAME, APP_VERSION } from "../lib/constants.mjs";
import { catalogPayload } from "../lib/catalog.mjs";
import {
  bootstrapOwner,
  bootstrapStatus,
  createInvite,
  effectiveEntitlements,
  expiredSessionCookie,
  getSessionUser,
  issueSession,
  listInvites,
  listUsers,
  login,
  logout,
  publicUser,
  registerWithInvite,
  updateUser,
  requireRole,
  requireUser,
  sessionCookie,
} from "../lib/auth.mjs";
import {
  activateSandboxMembership,
  configureStripe,
  configureTelegram,
  configureX,
  createBillingPortalSession,
  createCheckoutSession,
  getIntegrationStatuses,
  getTelegramWebhookSecret,
  processStripeWebhook,
} from "../lib/billing.mjs";
import {
  authenticateDevice,
  claimPairing,
  createDemoJob,
  createPairing,
  heartbeatDevice,
  listDeviceJobs,
  listDevices,
  revokeDevice,
  updateJobStatus,
} from "../lib/devices.mjs";
import { createRule, deleteRule, listRules, updateRule } from "../lib/rules.mjs";
import { createAlias, deleteAlias, listAliases } from "../lib/aliases.mjs";
import { ingestObservation, ingestTelegramUpdate, listEvents, listObservations, updateEvent } from "../lib/signals.mjs";
import { runSystemVerification } from "../lib/system.mjs";
import { storageBackendName } from "../lib/storage.mjs";
import { dispatchSignalWorker } from "../lib/internal.mjs";
import { secureEqual } from "../lib/crypto.mjs";
import {
  assertMethod,
  cleanString,
  empty,
  errorResponse,
  HttpError,
  json,
  readJSON,
  requestIp,
  routePath,
} from "../lib/http.mjs";

async function ensureDefaultRule(user) {
  const rules = await listRules(user.id);
  if (rules.length) return rules[0];
  return createRule(user, {
    name: "Pokémon premium products",
    gameIds: ["pokemon"],
    productTypeIds: ["etb", "upc", "booster-bundle"],
    vendorIds: ["target", "pokemon-center", "best-buy", "retailer-lab"],
    eventTypes: ["live_restock", "scheduled_drop", "presale_open"],
    action: "queue_assist",
    priority: 100,
  });
}

function originOf(req) {
  return new URL(req.url).origin;
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return empty(req);
  const path = routePath(req);
  const origin = originOf(req);
  try {
    if (path === "/health") {
      assertMethod(req, ["GET"]);
      const bootstrap = await bootstrapStatus();
      return json(req, {
        ok: true,
        app: APP_NAME,
        version: APP_VERSION,
        environment: context?.deploy?.context || process.env.CONTEXT || "unknown",
        storage: storageBackendName(),
        setupRequired: bootstrap.setupRequired,
        time: new Date().toISOString(),
      });
    }

    if (path === "/bootstrap") {
      if (req.method === "GET") return json(req, { ok: true, ...(await bootstrapStatus()) });
      assertMethod(req, ["POST"]);
      const body = await readJSON(req);
      const user = await bootstrapOwner(body);
      await ensureDefaultRule(user);
      const token = await issueSession(user, { ip: requestIp(req, context), userAgent: req.headers.get("user-agent") });
      return json(req, { ok: true, user: publicUser(user), entitlements: effectiveEntitlements(user) }, 201, { "set-cookie": sessionCookie(token) });
    }

    if (path === "/auth/register") {
      assertMethod(req, ["POST"]);
      const body = await readJSON(req);
      const { user, token } = await registerWithInvite(body, { ip: requestIp(req, context), userAgent: req.headers.get("user-agent") });
      await ensureDefaultRule(user);
      return json(req, { ok: true, user: publicUser(user), entitlements: effectiveEntitlements(user) }, 201, { "set-cookie": sessionCookie(token) });
    }

    if (path === "/auth/login") {
      assertMethod(req, ["POST"]);
      const body = await readJSON(req);
      const { user, token } = await login(body, { ip: requestIp(req, context), userAgent: req.headers.get("user-agent") });
      return json(req, { ok: true, user: publicUser(user), entitlements: effectiveEntitlements(user) }, 200, { "set-cookie": sessionCookie(token) });
    }

    if (path === "/auth/logout") {
      assertMethod(req, ["POST"]);
      await logout(req);
      return json(req, { ok: true }, 200, { "set-cookie": expiredSessionCookie() });
    }

    if (path === "/auth/me") {
      assertMethod(req, ["GET"]);
      const auth = await getSessionUser(req);
      if (!auth) return json(req, { ok: true, authenticated: false });
      return json(req, {
        ok: true,
        authenticated: true,
        user: publicUser(auth.user),
        entitlements: effectiveEntitlements(auth.user),
        integrations: ["owner", "admin", "curator"].includes(auth.user.role) ? await getIntegrationStatuses() : undefined,
      });
    }

    if (path === "/catalog") {
      assertMethod(req, ["GET"]);
      await requireUser(req);
      return json(req, { ok: true, ...catalogPayload() });
    }

    if (path === "/aliases") {
      const actor = await requireRole(req, ["owner", "admin", "curator"]);
      if (req.method === "GET") return json(req, { ok: true, aliases: await listAliases() });
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, alias: await createAlias(actor, await readJSON(req)) }, 201);
    }

    const aliasMatch = path.match(/^\/aliases\/([^/]+)$/);
    if (aliasMatch) {
      assertMethod(req, ["DELETE"]);
      const actor = await requireRole(req, ["owner", "admin", "curator"]);
      await deleteAlias(actor, aliasMatch[1]);
      return json(req, { ok: true });
    }

    if (path === "/invites") {
      const actor = await requireRole(req, ["owner", "admin"]);
      if (req.method === "GET") return json(req, { ok: true, invites: await listInvites() });
      assertMethod(req, ["POST"]);
      const invite = await createInvite(actor, await readJSON(req));
      return json(req, { ok: true, invite, inviteUrl: `${origin}/#register?invite=${invite.code}` }, 201);
    }

    if (path === "/users") {
      assertMethod(req, ["GET"]);
      await requireRole(req, ["owner", "admin"]);
      return json(req, { ok: true, users: await listUsers() });
    }

    const userAdminMatch = path.match(/^\/users\/([^/]+)$/);
    if (userAdminMatch) {
      assertMethod(req, ["PATCH"]);
      const actor = await requireRole(req, ["owner", "admin"]);
      const targetUsers = await listUsers();
      const target = targetUsers.find((candidate) => candidate.id === userAdminMatch[1]);
      if (!target) throw new HttpError(404, "User not found.");
      const patch = await readJSON(req);
      if (target.role === "owner" && actor.role !== "owner") throw new HttpError(403, "Only the owner can modify the owner account.");
      if (patch.role === "owner" && actor.role !== "owner") throw new HttpError(403, "Only the owner can assign the owner role.");
      const updated = await updateUser(target.id, patch);
      return json(req, { ok: true, user: publicUser(updated), entitlements: effectiveEntitlements(updated) });
    }

    if (path === "/rules") {
      const user = await requireUser(req);
      if (req.method === "GET") return json(req, { ok: true, rules: await listRules(user.id) });
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, rule: await createRule(user, await readJSON(req)) }, 201);
    }

    const ruleMatch = path.match(/^\/rules\/([^/]+)$/);
    if (ruleMatch) {
      const user = await requireUser(req);
      if (req.method === "PUT" || req.method === "PATCH") return json(req, { ok: true, rule: await updateRule(user, ruleMatch[1], await readJSON(req)) });
      if (req.method === "DELETE") {
        await deleteRule(user, ruleMatch[1]);
        return json(req, { ok: true });
      }
      throw new HttpError(405, "Method not allowed.");
    }

    if (path === "/signals") {
      const user = await requireUser(req);
      if (req.method === "GET") {
        const admin = ["owner", "admin", "curator"].includes(user.role);
        return json(req, { ok: true, events: await listEvents(), observations: admin ? await listObservations() : [] });
      }
      if (!["owner", "admin", "curator"].includes(user.role)) throw new HttpError(403, "Curator access is required to submit signals.");
      assertMethod(req, ["POST"]);
      const body = await readJSON(req);
      const result = await ingestObservation({
        source: cleanString(body.source || "manual", 40),
        sourceId: cleanString(body.sourceId, 200) || null,
        text: cleanString(body.text, 8000),
        links: Array.isArray(body.links) ? body.links.slice(0, 20) : [],
        postedAt: body.postedAt || new Date().toISOString(),
      }, { origin, context });
      return json(req, { ok: true, ...result }, result.duplicate ? 200 : 202);
    }

    const signalEventMatch = path.match(/^\/signals\/events\/([^/]+)$/);
    if (signalEventMatch) {
      assertMethod(req, ["PATCH"]);
      await requireRole(req, ["owner", "admin", "curator"]);
      return json(req, { ok: true, ...(await updateEvent(signalEventMatch[1], await readJSON(req), { origin })) });
    }

    if (path === "/telegram-webhook") {
      assertMethod(req, ["POST"]);
      const configuredSecret = await getTelegramWebhookSecret();
      if (!configuredSecret) throw new HttpError(409, "Telegram is not configured.");
      const provided = req.headers.get("x-telegram-bot-api-secret-token");
      const body = await readJSON(req, 512_000);
      const result = await ingestTelegramUpdate(body, {
        secretValid: Boolean(provided) && secureEqual(provided, configuredSecret),
        origin,
        defer: (observationId) => dispatchSignalWorker(observationId, origin),
      });
      return json(req, { ok: true, ...result }, result.duplicate ? 200 : 202);
    }

    if (path === "/devices") {
      const user = await requireUser(req);
      assertMethod(req, ["GET"]);
      return json(req, { ok: true, devices: await listDevices(user.id) });
    }

    if (path === "/devices/pair") {
      const user = await requireUser(req);
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, pairing: await createPairing(user) }, 201);
    }

    if (path === "/devices/claim") {
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, ...(await claimPairing(await readJSON(req))) }, 201);
    }

    if (path === "/devices/heartbeat") {
      assertMethod(req, ["POST"]);
      const device = await authenticateDevice(req);
      return json(req, { ok: true, device: await heartbeatDevice(device, await readJSON(req)) });
    }

    if (path === "/devices/jobs") {
      assertMethod(req, ["GET"]);
      const device = await authenticateDevice(req);
      await heartbeatDevice(device);
      return json(req, { ok: true, deviceId: device.id, jobs: await listDeviceJobs(device) });
    }

    const jobMatch = path.match(/^\/devices\/jobs\/([^/]+)\/status$/);
    if (jobMatch) {
      assertMethod(req, ["POST"]);
      const device = await authenticateDevice(req);
      const body = await readJSON(req);
      return json(req, { ok: true, job: await updateJobStatus(device, jobMatch[1], body.status, body.metadata) });
    }

    const revokeMatch = path.match(/^\/devices\/([^/]+)\/revoke$/);
    if (revokeMatch) {
      assertMethod(req, ["POST"]);
      const user = await requireUser(req);
      return json(req, { ok: true, device: await revokeDevice(user, revokeMatch[1]) });
    }

    if (path === "/devices/demo-job") {
      assertMethod(req, ["POST"]);
      const user = await requireUser(req);
      return json(req, { ok: true, job: await createDemoJob(user, origin) }, 201);
    }

    if (path === "/membership") {
      assertMethod(req, ["GET"]);
      const user = await requireUser(req);
      return json(req, { ok: true, user: publicUser(user), entitlements: effectiveEntitlements(user), integrations: await getIntegrationStatuses() });
    }

    if (path === "/membership/sandbox") {
      assertMethod(req, ["POST"]);
      const user = await requireUser(req);
      const updated = await activateSandboxMembership(user, (await readJSON(req)).planId);
      return json(req, { ok: true, user: publicUser(updated), entitlements: effectiveEntitlements(updated) });
    }

    if (path === "/membership/checkout") {
      assertMethod(req, ["POST"]);
      const user = await requireUser(req);
      const checkout = await createCheckoutSession(user, (await readJSON(req)).planId, origin);
      return json(req, { ok: true, checkout });
    }


    if (path === "/membership/portal") {
      assertMethod(req, ["POST"]);
      const user = await requireUser(req);
      const portal = await createBillingPortalSession(user, origin);
      return json(req, { ok: true, portal });
    }

    if (path === "/stripe-webhook") {
      assertMethod(req, ["POST"]);
      const rawBody = await req.text();
      const result = await processStripeWebhook(rawBody, req.headers.get("stripe-signature"));
      return json(req, { ok: true, ...result });
    }

    if (path === "/admin/integrations") {
      await requireRole(req, ["owner", "admin", "curator"]);
      assertMethod(req, ["GET"]);
      return json(req, { ok: true, integrations: await getIntegrationStatuses() });
    }

    if (path === "/admin/integrations/telegram") {
      await requireRole(req, ["owner"]);
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, integration: await configureTelegram({ ...(await readJSON(req)), origin }) });
    }

    if (path === "/admin/integrations/x") {
      await requireRole(req, ["owner"]);
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, integration: await configureX(await readJSON(req)) });
    }

    if (path === "/admin/integrations/stripe") {
      await requireRole(req, ["owner"]);
      assertMethod(req, ["POST"]);
      return json(req, { ok: true, integration: await configureStripe(await readJSON(req)) });
    }

    if (path === "/system/verify") {
      await requireRole(req, ["owner", "admin"]);
      assertMethod(req, ["POST"]);
      const verification = await runSystemVerification(origin);
      return json(req, verification, verification.ok ? 200 : 500);
    }

    throw new HttpError(404, "API route not found.");
  } catch (error) {
    return errorResponse(req, error);
  }
};

export const config = {
  path: "/api/*",
  rateLimit: {
    windowLimit: 600,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
