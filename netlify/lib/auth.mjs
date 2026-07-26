import {
  BOOTSTRAP_TOKEN_SHA256,
  PLANS,
  ROLES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  STORES,
} from "./constants.mjs";
import {
  hashPassword,
  randomCode,
  randomId,
  randomToken,
  secureEqual,
  sha256,
  verifyPassword,
} from "./crypto.mjs";
import { deleteJSON, getJSON, listJSON, setJSON } from "./storage.mjs";
import { HttpError, normalizeEmail, parseCookies } from "./http.mjs";

const userKey = (id) => `users/id/${id}`;
const userEmailKey = (email) => `users/email/${sha256(normalizeEmail(email))}`;
const sessionKey = (token) => `sessions/${sha256(token)}`;
const inviteKey = (code) => `invites/${sha256(String(code).toUpperCase())}`;

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export function effectiveEntitlements(user) {
  const plan = PLANS[user?.planId] || PLANS.beta;
  const billingActive = !plan.billingRequired || ["active", "trialing", "sandbox"].includes(user?.subscriptionStatus);
  return {
    ...plan,
    active: user?.status === "active" && billingActive,
    subscriptionStatus: user?.subscriptionStatus || (plan.billingRequired ? "inactive" : "beta"),
  };
}

export async function getUserById(id) {
  if (!id) return null;
  return getJSON(STORES.auth, userKey(id));
}

export async function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const pointer = await getJSON(STORES.auth, userEmailKey(normalized));
  return pointer?.userId ? getUserById(pointer.userId) : null;
}

export async function createUser({ email, password, name, role = "member", planId = "beta", invitedBy = null }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) throw new HttpError(400, "A valid email address is required.");
  if (!ROLES.includes(role)) throw new HttpError(400, "Invalid role.");
  if (!PLANS[planId]) throw new HttpError(400, "Invalid plan.");

  const id = randomId("usr");
  const createdAt = new Date().toISOString();
  const pointerWrite = await setJSON(STORES.auth, userEmailKey(normalized), { userId: id }, { onlyIfNew: true });
  if (!pointerWrite.modified) throw new HttpError(409, "An account already exists for that email address.");

  try {
    const user = {
      id,
      email: normalized,
      name: String(name || normalized.split("@")[0]).trim().slice(0, 80),
      passwordHash: await hashPassword(password),
      role,
      planId,
      subscriptionStatus: planId === "beta" ? "beta" : "inactive",
      status: "active",
      invitedBy,
      createdAt,
      updatedAt: createdAt,
    };
    await setJSON(STORES.auth, userKey(id), user);
    await writeAudit({ actorId: id, action: "user.created", targetId: id, metadata: { role, planId } });
    return user;
  } catch (error) {
    await deleteJSON(STORES.auth, userEmailKey(normalized));
    throw error;
  }
}

export async function bootstrapStatus() {
  const complete = await getJSON(STORES.auth, "bootstrap/complete");
  return { setupRequired: !complete, completedAt: complete?.completedAt || null };
}

export async function bootstrapOwner({ token, email, password, name }) {
  const status = await bootstrapStatus();
  if (!status.setupRequired) throw new HttpError(409, "Owner setup has already been completed.");
  if (!secureEqual(sha256(String(token || "")), BOOTSTRAP_TOKEN_SHA256)) {
    throw new HttpError(403, "Invalid one-time owner setup token.");
  }

  const claim = await setJSON(STORES.auth, "bootstrap/claim", {
    claimedAt: new Date().toISOString(),
    nonce: randomToken(8),
  }, { onlyIfNew: true });
  if (!claim.modified) throw new HttpError(409, "Owner setup is already in progress.");

  try {
    const user = await createUser({ email, password, name, role: "owner", planId: "beta" });
    await setJSON(STORES.auth, "bootstrap/complete", { userId: user.id, completedAt: new Date().toISOString() }, { onlyIfNew: true });
    return user;
  } catch (error) {
    await deleteJSON(STORES.auth, "bootstrap/claim");
    throw error;
  }
}

export async function issueSession(user, metadata = {}) {
  const token = randomToken(32);
  const now = Date.now();
  await setJSON(STORES.auth, sessionKey(token), {
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    ...metadata,
  });
  return token;
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function login({ email, password }, metadata = {}) {
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
    throw new HttpError(401, "Incorrect email or password.");
  }
  if (user.status !== "active") throw new HttpError(403, "This account is not active.");
  const token = await issueSession(user, metadata);
  await writeAudit({ actorId: user.id, action: "auth.login", targetId: user.id, metadata });
  return { user, token };
}

export async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = await getJSON(STORES.auth, sessionKey(token));
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await deleteJSON(STORES.auth, sessionKey(token));
    return null;
  }
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return { user, session, token };
}

export async function logout(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await deleteJSON(STORES.auth, sessionKey(token));
}

export async function requireUser(req) {
  const auth = await getSessionUser(req);
  if (!auth) throw new HttpError(401, "Sign in is required.");
  return auth.user;
}

export async function requireRole(req, allowed) {
  const user = await requireUser(req);
  if (!allowed.includes(user.role)) throw new HttpError(403, "You do not have permission to perform this action.");
  return user;
}

export async function createInvite(actor, { email, role = "member", planId = "beta", expiresHours = 72, maxUses = 1 }) {
  if (!ROLES.includes(role) || role === "owner") throw new HttpError(400, "Invalid invitation role.");
  if (!PLANS[planId]) throw new HttpError(400, "Invalid invitation plan.");
  const code = randomCode(10);
  const now = Date.now();
  const invite = {
    id: randomId("inv"),
    codeHash: sha256(code),
    email: email ? normalizeEmail(email) : null,
    role,
    planId,
    maxUses: Math.max(1, Math.min(25, Number(maxUses) || 1)),
    uses: 0,
    createdBy: actor.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(1, Math.min(720, Number(expiresHours) || 72)) * 60 * 60 * 1000).toISOString(),
  };
  await setJSON(STORES.auth, inviteKey(code), invite, { onlyIfNew: true });
  await writeAudit({ actorId: actor.id, action: "invite.created", targetId: invite.id, metadata: { role, planId } });
  return { ...invite, code };
}

export async function listInvites() {
  const rows = await listJSON(STORES.auth, "invites/");
  return rows.map(({ value }) => ({
    id: value.id,
    email: value.email,
    role: value.role,
    planId: value.planId,
    uses: value.uses,
    maxUses: value.maxUses,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    expired: Date.parse(value.expiresAt) <= Date.now(),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function registerWithInvite({ code, email, password, name }, metadata = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const invite = await getJSON(STORES.auth, inviteKey(normalizedCode));
  if (!invite) throw new HttpError(404, "Invitation not found.");
  if (Date.parse(invite.expiresAt) <= Date.now()) throw new HttpError(410, "This invitation has expired.");
  if (invite.uses >= invite.maxUses) throw new HttpError(409, "This invitation has already been used.");
  const normalizedEmail = normalizeEmail(email);
  if (invite.email && invite.email !== normalizedEmail) throw new HttpError(403, "This invitation was issued to another email address.");

  const user = await createUser({
    email: normalizedEmail,
    password,
    name,
    role: invite.role,
    planId: invite.planId,
    invitedBy: invite.createdBy,
  });
  invite.uses += 1;
  invite.lastUsedAt = new Date().toISOString();
  await setJSON(STORES.auth, inviteKey(normalizedCode), invite);
  const token = await issueSession(user, metadata);
  return { user, token };
}

export async function updateUser(userId, patch) {
  const user = await getUserById(userId);
  if (!user) throw new HttpError(404, "User not found.");
  const allowed = ["name", "role", "planId", "subscriptionStatus", "status", "stripeCustomerId", "stripeSubscriptionId"];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === "role" && !ROLES.includes(patch[key])) throw new HttpError(400, "Invalid role.");
    if (key === "planId" && !PLANS[patch[key]]) throw new HttpError(400, "Invalid plan.");
    if (key === "status" && !["active", "suspended"].includes(patch[key])) throw new HttpError(400, "Invalid account status.");
    user[key] = patch[key];
  }
  user.updatedAt = new Date().toISOString();
  await setJSON(STORES.auth, userKey(userId), user);
  return user;
}

export async function listUsers() {
  const rows = await listJSON(STORES.auth, "users/id/");
  return rows.map(({ value }) => ({ ...publicUser(value), entitlements: effectiveEntitlements(value) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function writeAudit({ actorId, action, targetId, metadata = {} }) {
  const at = new Date().toISOString();
  const entry = { id: randomId("aud"), actorId, action, targetId, metadata, at };
  await setJSON(STORES.auth, `audit/${at}/${entry.id}`, entry);
  return entry;
}
