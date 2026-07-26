import { GAMES, PRODUCT_TYPES, VENDORS } from "./constants.mjs";

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$&+:/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchAlias(text, entities) {
  const normalized = normalizeText(text);
  let best = null;
  for (const entity of entities) {
    for (const alias of entity.aliases || []) {
      const normalizedAlias = normalizeText(alias);
      const index = normalized.indexOf(normalizedAlias);
      if (index !== -1 && (!best || normalizedAlias.length > best.alias.length)) {
        best = { entity, alias: normalizedAlias, index };
      }
    }
  }
  return best?.entity || null;
}

export function findGame(text) {
  return matchAlias(text, GAMES);
}

export function findProductType(text) {
  return matchAlias(text, PRODUCT_TYPES);
}

export function findVendorFromText(text) {
  const aliases = VENDORS.flatMap((vendor) => [
    { ...vendor, aliases: [vendor.name, vendor.id.replaceAll("-", " ")] },
  ]);
  return matchAlias(text, aliases);
}

export function findVendorFromHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return VENDORS.find((vendor) => vendor.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) || null;
}

export function canonicalizeVendorUrl(input) {
  try {
    const url = new URL(input);
    const vendor = findVendorFromHostname(url.hostname);
    if (!vendor) return { vendor: null, canonicalUrl: url.toString(), vendorSku: null };

    const tracking = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "ref", "ref_", "source", "affiliate", "afid", "irclickid", "clickid",
      "fbclid", "gclid", "srsltid", "tag",
    ];
    for (const key of tracking) url.searchParams.delete(key);
    url.hash = "";

    let vendorSku = null;
    const path = url.pathname;
    if (vendor.id === "target") vendorSku = path.match(/\/-\/A-(\d+)/i)?.[1] || url.searchParams.get("preselect") || null;
    if (vendor.id === "walmart") vendorSku = path.match(/\/ip\/(?:[^/]+\/)?(\d+)/i)?.[1] || null;
    if (vendor.id === "best-buy") vendorSku = url.searchParams.get("skuId") || path.match(/\/(\d+)\.p/i)?.[1] || null;
    if (vendor.id === "amazon") vendorSku = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || null;
    if (vendor.id === "gamestop") vendorSku = path.match(/\/(\d+)\.html/i)?.[1] || null;
    if (vendor.id === "pokemon-center") vendorSku = path.split("/").filter(Boolean).at(-1) || null;

    url.searchParams.sort();
    return { vendor, canonicalUrl: url.toString(), vendorSku };
  } catch {
    return { vendor: null, canonicalUrl: null, vendorSku: null };
  }
}

export function catalogPayload() {
  return {
    games: GAMES.map(({ aliases, ...game }) => game),
    productTypes: PRODUCT_TYPES.map(({ aliases, ...type }) => type),
    vendors: VENDORS.map(({ domains, ...vendor }) => vendor),
    collections: [
      { id: "pitch-black", gameId: "pokemon", name: "Pitch Black" },
      { id: "storm-esmeralda", gameId: "pokemon", name: "Storm Esmeralda" },
      { id: "pokemon-30th", gameId: "pokemon", name: "30th Anniversary" },
      { id: "one-piece-st-31-36", gameId: "one-piece", name: "Starter Decks ST-31–ST-36" },
      { id: "generic-future", gameId: null, name: "Any future release" },
    ],
  };
}
