import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { EVENT_TYPES } from "./constants.mjs";
import {
  canonicalizeVendorUrl,
  findGame,
  findProductType,
  findVendorFromText,
  normalizeText,
} from "./catalog.mjs";
import { sha256 } from "./crypto.mjs";

const monthNumbers = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

export function extractTelegramMessage(update) {
  const message = update?.channel_post || update?.edited_channel_post || update?.message || update?.edited_message;
  if (!message) return null;
  const text = message.text || message.caption || "";
  const entities = message.entities || message.caption_entities || [];
  const links = [];
  for (const entity of entities) {
    if (entity.type === "text_link" && entity.url) links.push(entity.url);
    if (entity.type === "url") links.push(text.slice(entity.offset, entity.offset + entity.length));
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gi)) links.push(match[0].replace(/[.,!?]+$/, ""));
  return {
    updateId: update.update_id,
    kind: update.channel_post ? "channel_post" : update.edited_channel_post ? "edited_channel_post" : update.message ? "message" : "edited_message",
    chatId: String(message.chat?.id || "unknown"),
    chatTitle: message.chat?.title || message.chat?.username || null,
    messageId: message.message_id,
    postedAt: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    editedAt: message.edit_date ? new Date(message.edit_date * 1000).toISOString() : null,
    text,
    links: [...new Set(links)],
    mediaGroupId: message.media_group_id || null,
    forwardOrigin: message.forward_origin || null,
  };
}

function privateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224;
}

function privateIPv6(ip) {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export async function assertSafePublicUrl(input) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported URL protocol.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not accepted.");
  const host = url.hostname.toLowerCase();
  if (["localhost", "0.0.0.0"].includes(host) || host.endsWith(".local")) throw new Error("Local destinations are blocked.");
  const literal = isIP(host);
  if (literal === 4 && privateIPv4(host)) throw new Error("Private destinations are blocked.");
  if (literal === 6 && privateIPv6(host)) throw new Error("Private destinations are blocked.");
  if (!literal) {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length) throw new Error("Destination did not resolve.");
    for (const { address, family } of addresses) {
      if ((family === 4 && privateIPv4(address)) || (family === 6 && privateIPv6(address))) {
        throw new Error("Destination resolves to a private network.");
      }
    }
  }
  return url;
}

export async function resolveUrl(input, { maxRedirects = 5, timeoutMs = 5000 } = {}) {
  let current = await assertSafePublicUrl(input);
  const chain = [current.toString()];
  let statusCode = null;
  for (let index = 0; index <= maxRedirects; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "EZCards-SignalResolver/1.0" },
      });
      if ([405, 403].includes(response.status)) {
        response = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "EZCards-SignalResolver/1.0", range: "bytes=0-2048" },
        });
      }
    } finally {
      clearTimeout(timeout);
    }
    statusCode = response.status;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      current = await assertSafePublicUrl(new URL(location, current).toString());
      chain.push(current.toString());
      continue;
    }
    break;
  }
  const canonical = canonicalizeVendorUrl(current.toString());
  return {
    originalUrl: input,
    redirectChain: chain,
    finalUrl: current.toString(),
    finalDomain: current.hostname.toLowerCase(),
    statusCode,
    vendorId: canonical.vendor?.id || null,
    vendorSku: canonical.vendorSku,
    canonicalUrl: canonical.canonicalUrl,
    role: canonical.vendor ? "merchant_action" : /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(current.hostname) ? "social_source" : "unknown",
  };
}

export function inferEventType(text) {
  const normalized = normalizeText(text);
  const scores = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]));
  const add = (type, points, phrases) => {
    if (phrases.some((phrase) => normalized.includes(phrase))) scores[type] += points;
  };
  add("sold_out", 5, ["sold out", "oos", "gone", "window gone", "dead link"]);
  add("preorder_deadline", 5, ["preorder deadline", "pre order deadline", "window closes", "preorder closes", "ends at", "closes at"]);
  add("presale_open", 5, ["presale", "pre sale", "preorder live", "pre order live", "preorder is live", "pre order is live"]);
  add("live_restock", 4, ["back up", "restock", "in stock", "available now", "live now", "seeing success", "stock live"]);
  add("status_update", 3, ["still seeing", "still live", "more success", "queue moving"]);
  add("scheduled_drop", 4, ["drops at", "dropping at", "releases at", "launches at", "release schedule"]);
  add("announcement", 3, ["first look", "coming soon", "releasing", "announced", "preview"]);
  if (/\b(today|tomorrow|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(normalized)) scores.scheduled_drop += 1;
  if (/\b(now|live|back)\b/.test(normalized)) scores.live_restock += 1;
  const [eventType, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { eventType: score > 0 ? eventType : "unknown", score, scores };
}

export function extractCollection(text) {
  const normalized = normalizeText(text);
  const known = [
    ["pitch-black", ["pitch black"]],
    ["storm-esmeralda", ["storm esmeralda"]],
    ["pokemon-30th", ["30th anniversary", "30th year"]],
    ["one-piece-st-31-36", ["st 31", "st-31", "st31", "st 36", "st-36", "st36"]],
  ];
  for (const [id, aliases] of known) if (aliases.some((alias) => normalized.includes(alias))) return id;
  return null;
}

export function extractSchedule(text, now = new Date()) {
  const normalized = normalizeText(text);
  const dateMatch = normalized.match(new RegExp(`\\b(${Object.keys(monthNumbers).join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[, ]+(\\d{4}))?`));
  const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!dateMatch && !timeMatch) return { scheduledAt: null, dateText: null };
  const date = new Date(now);
  date.setSeconds(0, 0);
  if (dateMatch) {
    const year = dateMatch[3] ? Number(dateMatch[3]) : now.getUTCFullYear();
    date.setUTCFullYear(year, monthNumbers[dateMatch[1]], Number(dateMatch[2]));
  }
  if (timeMatch) {
    let hour = Number(timeMatch[1]) % 12;
    if (timeMatch[3] === "pm") hour += 12;
    date.setUTCHours(hour, Number(timeMatch[2] || 0), 0, 0);
  } else {
    date.setUTCHours(16, 0, 0, 0);
  }
  return { scheduledAt: date.toISOString(), dateText: [dateMatch?.[0], timeMatch?.[0]].filter(Boolean).join(" ") };
}

export function classifySignal({ text, links = [], resolvedLinks = [], source = "manual" }) {
  const mergedText = `${text || ""} ${resolvedLinks.map((link) => link.title || "").join(" ")}`;
  const game = findGame(mergedText);
  const productType = findProductType(mergedText);
  const merchant = resolvedLinks.find((link) => link.vendorId) || null;
  const vendor = merchant ? { id: merchant.vendorId } : findVendorFromText(mergedText);
  const intent = inferEventType(mergedText);
  const collectionId = extractCollection(mergedText);
  const schedule = extractSchedule(mergedText);
  const sourceUrl = links.find((url) => /(?:x|twitter)\.com\//i.test(url)) || null;
  const actionUrl = merchant?.canonicalUrl || null;

  let confidence = 0.18;
  const evidence = [];
  const addEvidence = (field, kind, value, score) => {
    if (!value) return;
    confidence += score;
    evidence.push({ field, source: kind, value: String(value), score });
  };
  addEvidence("gameId", "message_text", game?.id, 0.18);
  addEvidence("productTypeId", "message_text", productType?.id, 0.15);
  addEvidence("vendorId", merchant ? "vendor_url" : "message_text", vendor?.id, merchant ? 0.22 : 0.1);
  addEvidence("eventType", "message_text", intent.eventType !== "unknown" ? intent.eventType : null, Math.min(0.2, intent.score * 0.035));
  addEvidence("collectionId", "catalog", collectionId, 0.08);
  addEvidence("actionUrl", "vendor_url", actionUrl, actionUrl ? 0.12 : 0);
  confidence = Math.max(0, Math.min(0.99, confidence));

  const eventType = intent.eventType;
  const actionable = Boolean(actionUrl) && ["live_restock", "scheduled_drop", "presale_open"].includes(eventType) && confidence >= 0.72;
  return {
    source,
    eventType,
    gameId: game?.id || null,
    collectionId,
    productTypeId: productType?.id || null,
    productName: deriveProductName(text, game?.name, productType?.name, collectionId),
    vendorId: vendor?.id || null,
    vendorSku: merchant?.vendorSku || null,
    actionUrl,
    sourceUrl,
    scheduledAt: schedule.scheduledAt,
    confidence: Number(confidence.toFixed(3)),
    evidence,
    actionable,
    reviewRequired: confidence < 0.72 || !game || !vendor || eventType === "unknown",
  };
}

function deriveProductName(text, gameName, productTypeName, collectionId) {
  const clean = String(text || "").replace(/https?:\/\/\S+/g, "").replace(/[#🔥👉✅🚨📅]/gu, " ").replace(/\s+/g, " ").trim();
  if (clean.length >= 5 && clean.length <= 120) return clean;
  const collection = collectionId ? collectionId.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") : null;
  return [gameName, collection, productTypeName].filter(Boolean).join(" ") || "Unclassified TCG product";
}

export function eventFamily(eventType) {
  if (["live_restock", "status_update", "sold_out"].includes(eventType)) return "live_restock";
  return eventType;
}

export function listingFingerprint(classification) {
  return sha256([
    classification.vendorId || "unknown-vendor",
    classification.vendorSku || classification.actionUrl || "unknown-listing",
    classification.gameId || "unknown-game",
    classification.collectionId || "unknown-collection",
    classification.productTypeId || "unknown-product-type",
  ].join("|"));
}

export function signalFingerprint(classification, observedAt = new Date()) {
  const family = eventFamily(classification.eventType);
  const bucketMs = family === "live_restock" ? 20 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const anchor = classification.scheduledAt ? Date.parse(classification.scheduledAt) : observedAt.getTime();
  const bucket = Math.floor(anchor / bucketMs);
  return sha256([listingFingerprint(classification), family, bucket].join("|"));
}
