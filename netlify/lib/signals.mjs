import { EVENT_TYPES, GAMES, LIVE_EVENT_MERGE_MS, PRODUCT_TYPES, STORES, VENDORS } from "./constants.mjs";
import { randomId, sha256 } from "./crypto.mjs";
import { HttpError } from "./http.mjs";
import { assertSafePublicUrl, classifySignal, eventFamily, extractTelegramMessage, listingFingerprint, resolveUrl, signalFingerprint } from "./classifier.mjs";
import { listJSON, getJSON, setJSON } from "./storage.mjs";
import { findMatches } from "./rules.mjs";
import { dispatchMatches } from "./devices.mjs";
import { applyLearnedAliases } from "./aliases.mjs";
import { enrichXSource } from "./x.mjs";

export async function ingestObservation(input, { origin, defer } = {}) {
  const id = input.id || randomId("obs");
  const receivedAt = new Date().toISOString();
  const observation = {
    id,
    source: String(input.source || "manual").slice(0, 40),
    sourceId: input.sourceId ? String(input.sourceId).slice(0, 200) : null,
    externalSourceId: input.externalSourceId ? String(input.externalSourceId).slice(0, 300) : null,
    text: String(input.text || "").slice(0, 8000),
    links: [...new Set((input.links || []).map(String).filter(Boolean))].slice(0, 20),
    raw: input.raw || null,
    receivedAt,
    postedAt: input.postedAt || receivedAt,
    editedAt: input.editedAt || null,
    status: "RECEIVED",
    eventId: null,
  };
  if (!observation.text.trim() && !observation.links.length) throw new HttpError(400, "A signal needs text or at least one URL.");
  if (Number.isNaN(Date.parse(observation.postedAt))) throw new HttpError(400, "Signal postedAt is invalid.");
  observation.postedAt = new Date(observation.postedAt).toISOString();

  const identityKey = observation.sourceId ? `source-identity/${observation.source}/${sha256(observation.sourceId)}` : null;
  const priorIdentity = identityKey ? await getJSON(STORES.signals, identityKey) : null;
  const priorObservation = priorIdentity?.observationId ? await getJSON(STORES.signals, `observations/${priorIdentity.observationId}`) : null;
  const sameSourceContent = priorObservation
    && priorObservation.text === observation.text
    && JSON.stringify(priorObservation.links || []) === JSON.stringify(observation.links || []);
  if (sameSourceContent) return { observation: priorObservation, duplicate: true, duplicateKind: "source_identity" };

  let externalKey = null;
  if (observation.externalSourceId && !priorIdentity) {
    externalKey = `external-source-dedupe/${sha256(observation.externalSourceId)}`;
    const externalClaim = await setJSON(STORES.signals, externalKey, { observationId: id, externalSourceId: observation.externalSourceId, receivedAt }, { onlyIfNew: true });
    if (!externalClaim.modified) {
      const existing = await getJSON(STORES.signals, externalKey);
      return { observation: existing?.observationId ? await getJSON(STORES.signals, `observations/${existing.observationId}`) : null, duplicate: true, duplicateKind: "external_source" };
    }
  }

  const sourceFingerprint = sha256(`${observation.source}|${observation.sourceId || ""}|${observation.text}|${observation.links.join("|")}`);
  const claim = await setJSON(STORES.signals, `observation-dedupe/${sourceFingerprint}`, { observationId: id, receivedAt }, { onlyIfNew: true });
  if (!claim.modified) {
    const existing = await getJSON(STORES.signals, `observation-dedupe/${sourceFingerprint}`);
    if (externalKey && existing?.observationId) await setJSON(STORES.signals, externalKey, { observationId: existing.observationId, externalSourceId: observation.externalSourceId, receivedAt });
    return { observation: existing?.observationId ? await getJSON(STORES.signals, `observations/${existing.observationId}`) : null, duplicate: true, duplicateKind: "content" };
  }

  observation.version = Number(priorIdentity?.version || 0) + 1;
  observation.previousObservationId = priorIdentity?.observationId || null;
  await setJSON(STORES.signals, `observations/${id}`, observation, { onlyIfNew: true });
  if (identityKey) await setJSON(STORES.signals, identityKey, { observationId: id, version: observation.version, updatedAt: receivedAt });
  if (observation.externalSourceId && priorIdentity) {
    externalKey = `external-source-dedupe/${sha256(observation.externalSourceId)}`;
    await setJSON(STORES.signals, externalKey, { observationId: id, externalSourceId: observation.externalSourceId, receivedAt });
  }

  if (defer) {
    try {
      await defer(id);
    } catch (error) {
      observation.backgroundDispatchError = String(error.message || error).slice(0, 300);
      await setJSON(STORES.signals, `observations/${id}`, observation);
      await processObservation(id, { origin });
    }
  } else {
    await processObservation(id, { origin });
  }
  return { observation: await getJSON(STORES.signals, `observations/${id}`), duplicate: false, deferred: Boolean(defer) };
}

async function resolveOne(link) {
  const cacheKey = `url-resolution/${sha256(link)}`;
  const cached = await getJSON(STORES.signals, cacheKey);
  if (cached && Date.now() - Date.parse(cached.resolvedAt) < 7 * 24 * 60 * 60 * 1000) return cached;
  try {
    const result = { ...(await resolveUrl(link)), resolvedAt: new Date().toISOString() };
    await setJSON(STORES.signals, cacheKey, result);
    return result;
  } catch (error) {
    const failed = { originalUrl: link, error: error.message, resolvedAt: new Date().toISOString(), role: "unknown" };
    await setJSON(STORES.signals, cacheKey, failed);
    return failed;
  }
}

async function resolveLinks(links) {
  const resolved = [];
  const seen = new Set();
  for (const link of links.slice(0, 8)) {
    if (seen.has(link)) continue;
    seen.add(link);
    const result = await resolveOne(link);
    resolved.push(result);
    if (result.role !== "social_source") continue;
    const enrichment = await enrichXSource(result.finalUrl || link).catch((error) => ({ error: error.message, urls: [] }));
    if (enrichment?.text) result.title = enrichment.text;
    result.xEnrichment = enrichment ? { statusId: enrichment.statusId, configured: enrichment.configured, error: enrichment.error || null } : null;
    for (const outbound of (enrichment?.urls || []).slice(0, 6)) {
      if (seen.has(outbound) || /(?:x|twitter)\.com\//i.test(outbound)) continue;
      seen.add(outbound);
      const outboundResult = await resolveOne(outbound);
      outboundResult.discoveredFrom = result.finalUrl || link;
      outboundResult.title = enrichment.text || null;
      resolved.push(outboundResult);
    }
  }
  return resolved;
}

export async function processObservation(id, { origin = "https://ezcards.netlify.app" } = {}) {
  const key = `observations/${id}`;
  const observation = await getJSON(STORES.signals, key);
  if (!observation || observation.status === "PROCESSED") return observation;
  observation.status = "PROCESSING";
  observation.processingStartedAt = new Date().toISOString();
  await setJSON(STORES.signals, key, observation);

  const resolvedLinks = await resolveLinks(observation.links);
  const classification = await applyLearnedAliases(classifySignal({
    text: observation.text,
    links: observation.links,
    resolvedLinks,
    source: observation.source,
  }), observation.text, observation.source);
  const fingerprint = signalFingerprint(classification, new Date(observation.postedAt));
  const identity = listingFingerprint(classification);
  const family = eventFamily(classification.eventType);
  const pointerKey = `event-dedupe/${fingerprint}`;
  const identityPointerKey = `event-latest/${identity}/${family}`;
  const exactPointer = await getJSON(STORES.signals, pointerKey);
  const latestPointer = await getJSON(STORES.signals, identityPointerKey);
  let event = exactPointer?.eventId ? await getJSON(STORES.signals, `events/${exactPointer.eventId}`) : null;
  if (!event && latestPointer?.eventId) event = await getJSON(STORES.signals, `events/${latestPointer.eventId}`);
  const now = new Date().toISOString();

  if (event && family === "live_restock" && Date.now() - Date.parse(event.lastSeenAt) > LIVE_EVENT_MERGE_MS) event = null;
  if (event && ["SCHEDULED", "LIVE", "REVIEW"].includes(event.status) === false) event = null;

  if (!event) {
    event = {
      id: randomId("evt"),
      ...classification,
      fingerprint,
      listingFingerprint: identity,
      eventFamily: family,
      status: classification.reviewRequired ? "REVIEW" : classification.scheduledAt && Date.parse(classification.scheduledAt) > Date.now() ? "SCHEDULED" : "LIVE",
      observationCount: 0,
      observationIds: [],
      createdAt: now,
      firstSeenAt: observation.postedAt,
      lastSeenAt: observation.postedAt,
      updatedAt: now,
    };
    await setJSON(STORES.signals, pointerKey, { eventId: event.id, createdAt: now });
    await setJSON(STORES.signals, identityPointerKey, { eventId: event.id, updatedAt: now });
  }

  if (!event.observationIds.includes(id)) {
    event.observationIds.push(id);
    event.observationCount += 1;
  }
  event.lastSeenAt = observation.postedAt > event.lastSeenAt ? observation.postedAt : event.lastSeenAt;
  event.updatedAt = now;
  await setJSON(STORES.signals, identityPointerKey, { eventId: event.id, updatedAt: now });
  event.confidence = Math.min(0.99, Number((Math.max(event.confidence || 0, classification.confidence) + Math.min(0.08, (event.observationCount - 1) * 0.02)).toFixed(3)));
  if (classification.eventType === "sold_out") event.status = "ENDED";
  await setJSON(STORES.signals, `events/${event.id}`, event);

  observation.status = "PROCESSED";
  observation.eventId = event.id;
  observation.classification = classification;
  observation.resolvedLinks = resolvedLinks;
  observation.processedAt = now;
  await setJSON(STORES.signals, key, observation);
  await setJSON(STORES.signals, `event-observations/${event.id}/${id}`, { eventId: event.id, observationId: id, at: now });

  let matches = [];
  let jobs = [];
  if (!["REVIEW", "ENDED"].includes(event.status)) {
    matches = await findMatches(event);
    jobs = await dispatchMatches(event, matches, origin);
  }
  return { observation, event, matches, jobs };
}

export async function ingestTelegramUpdate(update, { secretValid, origin, defer }) {
  if (!secretValid) throw new Error("Invalid Telegram webhook secret.");
  const updateId = String(update?.update_id ?? "");
  if (!updateId) throw new Error("Telegram update_id is required.");
  const claim = await setJSON(STORES.signals, `telegram-updates/${updateId}`, { receivedAt: new Date().toISOString() }, { onlyIfNew: true });
  if (!claim.modified) return { duplicate: true, updateId };
  const parsed = extractTelegramMessage(update);
  if (!parsed) return { ignored: true, updateId };
  const forwarded = parsed.forwardOrigin;
  const forwardedSource = forwarded?.chat?.id && forwarded?.message_id
    ? `telegram:${forwarded.chat.id}:${forwarded.message_id}`
    : null;
  const xStatus = parsed.links.map((link) => String(link).match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i)?.[1]).find(Boolean);
  return ingestObservation({
    source: "telegram",
    sourceId: `${parsed.chatId}:${parsed.messageId}`,
    externalSourceId: forwardedSource || (xStatus ? `x:${xStatus}` : null),
    text: parsed.text,
    links: parsed.links,
    postedAt: parsed.postedAt,
    editedAt: parsed.editedAt,
    raw: {
      updateId: parsed.updateId,
      kind: parsed.kind,
      chatId: parsed.chatId,
      chatTitle: parsed.chatTitle,
      messageId: parsed.messageId,
      mediaGroupId: parsed.mediaGroupId,
      forwardOrigin: parsed.forwardOrigin,
    },
  }, { origin, defer });
}

export async function listEvents(limit = 100) {
  const rows = await listJSON(STORES.signals, "events/");
  return rows.map(({ value }) => value).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, limit);
}

export async function listObservations(limit = 100) {
  const rows = await listJSON(STORES.signals, "observations/");
  return rows.map(({ value }) => value).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
}

export async function updateEvent(eventId, patch, { origin = "https://ezcards.netlify.app" } = {}) {
  const key = `events/${eventId}`;
  const event = await getJSON(STORES.signals, key);
  if (!event) throw new HttpError(404, "Event not found.");

  const cleanId = (value, max = 200) => String(value || "").trim().slice(0, max) || null;
  if (patch.gameId !== undefined) {
    const value = cleanId(patch.gameId);
    if (value && !GAMES.some((item) => item.id === value)) throw new HttpError(400, "Invalid game ID.");
    event.gameId = value;
  }
  if (patch.productTypeId !== undefined) {
    const value = cleanId(patch.productTypeId);
    if (value && !PRODUCT_TYPES.some((item) => item.id === value)) throw new HttpError(400, "Invalid product type ID.");
    event.productTypeId = value;
  }
  if (patch.vendorId !== undefined) {
    const value = cleanId(patch.vendorId);
    if (value && !VENDORS.some((item) => item.id === value)) throw new HttpError(400, "Invalid vendor ID.");
    event.vendorId = value;
  }
  if (patch.eventType !== undefined) {
    const value = cleanId(patch.eventType);
    if (!EVENT_TYPES.includes(value)) throw new HttpError(400, "Invalid event type.");
    event.eventType = value;
    event.eventFamily = eventFamily(value);
  }
  if (patch.collectionId !== undefined) {
    const value = cleanId(patch.collectionId, 80);
    if (value && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(value)) throw new HttpError(400, "Collection IDs must be lowercase slugs.");
    event.collectionId = value;
  }
  if (patch.productName !== undefined) event.productName = cleanId(patch.productName, 200);
  if (patch.vendorSku !== undefined) event.vendorSku = cleanId(patch.vendorSku, 120);
  if (patch.scheduledAt !== undefined) {
    const value = cleanId(patch.scheduledAt, 80);
    if (value && Number.isNaN(Date.parse(value))) throw new HttpError(400, "Invalid scheduled timestamp.");
    event.scheduledAt = value ? new Date(value).toISOString() : null;
  }
  if (patch.actionUrl !== undefined) {
    const value = cleanId(patch.actionUrl, 2000);
    if (value) {
      const safe = await assertSafePublicUrl(value);
      event.actionUrl = safe.toString();
    } else event.actionUrl = null;
  }
  if (patch.status !== undefined) event.status = cleanId(patch.status, 20);
  if (!["REVIEW", "SCHEDULED", "LIVE", "ENDED", "CANCELLED"].includes(event.status)) throw new HttpError(400, "Invalid event status.");

  event.reviewedAt = new Date().toISOString();
  event.updatedAt = event.reviewedAt;
  event.reviewRequired = event.status === "REVIEW";
  await setJSON(STORES.signals, key, event);
  let matches = [];
  let jobs = [];
  if (["LIVE", "SCHEDULED"].includes(event.status)) {
    matches = await findMatches(event);
    jobs = await dispatchMatches(event, matches, origin);
  }
  return { event, matches, jobs };
}
