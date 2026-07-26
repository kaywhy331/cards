import { EVENT_TYPES, GAMES, PRODUCT_TYPES, STORES, VENDORS } from "./constants.mjs";
import { normalizeText } from "./catalog.mjs";
import { randomId } from "./crypto.mjs";
import { HttpError } from "./http.mjs";
import { deleteJSON, listJSON, setJSON } from "./storage.mjs";

const FIELDS = new Set(["gameId", "collectionId", "productTypeId", "vendorId", "eventType"]);

export async function listAliases() {
  const rows = await listJSON(STORES.data, "aliases/");
  return rows.map(({ value }) => value).sort((a, b) => b.phrase.length - a.phrase.length || b.createdAt.localeCompare(a.createdAt));
}

export async function createAlias(actor, input) {
  const phrase = normalizeText(input.phrase);
  const field = String(input.field || "");
  const value = String(input.value || "").trim();
  if (phrase.length < 2 || phrase.length > 160) throw new HttpError(400, "Alias phrase must contain 2–160 characters.");
  if (!FIELDS.has(field)) throw new HttpError(400, "Invalid alias field.");
  if (!value || value.length > 160) throw new HttpError(400, "Alias value is required.");
  if (field === "eventType" && !EVENT_TYPES.includes(value)) throw new HttpError(400, "Invalid event type alias.");
  if (field === "gameId" && !GAMES.some((item) => item.id === value)) throw new HttpError(400, "Invalid game alias value.");
  if (field === "productTypeId" && !PRODUCT_TYPES.some((item) => item.id === value)) throw new HttpError(400, "Invalid product type alias value.");
  if (field === "vendorId" && !VENDORS.some((item) => item.id === value)) throw new HttpError(400, "Invalid vendor alias value.");
  if (field === "collectionId" && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(value)) throw new HttpError(400, "Collection alias values must be stable lowercase slugs.");
  const id = randomId("alias");
  const alias = {
    id,
    phrase,
    field,
    value,
    source: input.source ? String(input.source).trim().slice(0, 80) : null,
    force: Boolean(input.force),
    createdBy: actor.id,
    createdAt: new Date().toISOString(),
  };
  await setJSON(STORES.data, `aliases/${id}`, alias, { onlyIfNew: true });
  return alias;
}

export async function deleteAlias(actor, id) {
  const aliases = await listAliases();
  const alias = aliases.find((item) => item.id === id);
  if (!alias) throw new HttpError(404, "Alias not found.");
  if (actor.role === "curator" && alias.createdBy !== actor.id) throw new HttpError(403, "Curators can delete only aliases they created.");
  await deleteJSON(STORES.data, `aliases/${id}`);
}

export async function applyLearnedAliases(classification, text, source) {
  const normalized = normalizeText(text);
  const aliases = await listAliases();
  const applied = [];
  for (const alias of aliases) {
    if (alias.source && alias.source !== source) continue;
    if (!normalized.includes(alias.phrase)) continue;
    if (classification[alias.field] && !alias.force) continue;
    classification[alias.field] = alias.value;
    classification.evidence = classification.evidence || [];
    classification.evidence.push({ field: alias.field, source: "learned_alias", value: alias.value, score: 0.12, aliasId: alias.id });
    classification.confidence = Math.min(0.99, Number((Number(classification.confidence || 0) + 0.12).toFixed(3)));
    applied.push(alias.id);
  }
  classification.appliedAliasIds = applied;
  classification.reviewRequired = classification.confidence < 0.72 || !classification.gameId || !classification.vendorId || classification.eventType === "unknown";
  classification.actionable = Boolean(classification.actionUrl) && ["live_restock", "scheduled_drop", "presale_open"].includes(classification.eventType) && classification.confidence >= 0.72;
  return classification;
}
