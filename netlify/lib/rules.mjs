import { STORES } from "./constants.mjs";
import { randomId } from "./crypto.mjs";
import { HttpError } from "./http.mjs";
import { effectiveEntitlements, getUserById } from "./auth.mjs";
import { deleteJSON, listJSON, setJSON } from "./storage.mjs";

function cleanArray(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, max);
}

function normalizeRule(input, existing = {}) {
  return {
    ...existing,
    name: String(input.name || existing.name || "Watch rule").trim().slice(0, 100),
    enabled: input.enabled !== false,
    gameIds: cleanArray(input.gameIds ?? existing.gameIds),
    collectionIds: cleanArray(input.collectionIds ?? existing.collectionIds),
    productTypeIds: cleanArray(input.productTypeIds ?? existing.productTypeIds),
    vendorIds: cleanArray(input.vendorIds ?? existing.vendorIds),
    eventTypes: cleanArray(input.eventTypes ?? existing.eventTypes),
    productIds: cleanArray(input.productIds ?? existing.productIds),
    tags: cleanArray(input.tags ?? existing.tags),
    excludeCollectionIds: cleanArray(input.excludeCollectionIds ?? existing.excludeCollectionIds),
    excludeProductTypeIds: cleanArray(input.excludeProductTypeIds ?? existing.excludeProductTypeIds),
    excludeVendorIds: cleanArray(input.excludeVendorIds ?? existing.excludeVendorIds),
    action: ["notify_only", "open_page", "queue_assist"].includes(input.action) ? input.action : existing.action || "queue_assist",
    priority: Math.max(0, Math.min(1000, Number(input.priority ?? existing.priority ?? 100))),
    updatedAt: new Date().toISOString(),
  };
}

export async function listRules(userId) {
  const rows = await listJSON(STORES.data, `rules/${userId}/`);
  return rows.map(({ value }) => value).sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt));
}

export async function createRule(user, input) {
  const entitlement = effectiveEntitlements(user);
  if (!entitlement.active) throw new HttpError(402, "An active membership is required to create watch rules.");
  const current = await listRules(user.id);
  if (current.length >= entitlement.maxRules) throw new HttpError(409, `Your plan supports up to ${entitlement.maxRules} watch rules.`);
  const id = randomId("rule");
  const createdAt = new Date().toISOString();
  const rule = normalizeRule(input, { id, userId: user.id, createdAt });
  await setJSON(STORES.data, `rules/${user.id}/${id}`, rule, { onlyIfNew: true });
  return rule;
}

export async function updateRule(user, id, input) {
  const rows = await listRules(user.id);
  const existing = rows.find((rule) => rule.id === id);
  if (!existing) throw new HttpError(404, "Watch rule not found.");
  const rule = normalizeRule(input, existing);
  await setJSON(STORES.data, `rules/${user.id}/${id}`, rule);
  return rule;
}

export async function deleteRule(user, id) {
  await deleteJSON(STORES.data, `rules/${user.id}/${id}`);
}

function matchesList(values, actual) {
  return !values?.length || (actual && values.includes(actual));
}

export function evaluateRule(rule, event) {
  if (!rule.enabled) return { matched: false, reasons: ["Rule disabled"] };
  const failures = [];
  if (!matchesList(rule.gameIds, event.gameId)) failures.push("Game did not match");
  if (!matchesList(rule.collectionIds, event.collectionId)) failures.push("Collection did not match");
  if (!matchesList(rule.productTypeIds, event.productTypeId)) failures.push("Product type did not match");
  if (!matchesList(rule.vendorIds, event.vendorId)) failures.push("Vendor did not match");
  if (!matchesList(rule.eventTypes, event.eventType)) failures.push("Event type did not match");
  if (rule.excludeCollectionIds?.includes(event.collectionId)) failures.push("Collection excluded");
  if (rule.excludeProductTypeIds?.includes(event.productTypeId)) failures.push("Product type excluded");
  if (rule.excludeVendorIds?.includes(event.vendorId)) failures.push("Vendor excluded");
  return {
    matched: failures.length === 0,
    reasons: failures.length ? failures : [
      event.gameId ? `Game: ${event.gameId}` : "Any game",
      event.collectionId ? `Collection: ${event.collectionId}` : "Any collection",
      event.productTypeId ? `Product: ${event.productTypeId}` : "Any product type",
      event.vendorId ? `Vendor: ${event.vendorId}` : "Any vendor",
    ],
  };
}

export async function findMatches(event) {
  const rows = await listJSON(STORES.data, "rules/");
  const matchesByUser = new Map();
  for (const { value: rule } of rows) {
    const evaluation = evaluateRule(rule, event);
    if (!evaluation.matched) continue;
    const current = matchesByUser.get(rule.userId);
    if (!current || rule.priority > current.rule.priority) {
      matchesByUser.set(rule.userId, { rule, evaluation });
    }
  }

  const matches = [];
  for (const [userId, candidate] of matchesByUser.entries()) {
    const user = await getUserById(userId);
    if (!user || !effectiveEntitlements(user).active) continue;
    const match = {
      id: randomId("match"),
      userId,
      eventId: event.id,
      ruleId: candidate.rule.id,
      action: candidate.rule.action,
      priority: candidate.rule.priority,
      reasons: candidate.evaluation.reasons,
      createdAt: new Date().toISOString(),
    };
    await setJSON(STORES.data, `matches/${userId}/${event.id}`, match);
    matches.push(match);
  }
  return matches;
}
