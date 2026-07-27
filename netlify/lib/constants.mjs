export const APP_VERSION = "0.5.1";
export const APP_NAME = "EZ Cards";
export const SESSION_COOKIE = "ezcards_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const PAIRING_TTL_MS = 1000 * 60 * 10;
export const JOB_TTL_MS = 1000 * 60 * 10;
export const LIVE_EVENT_MERGE_MS = 1000 * 60 * 20;
export const BOOTSTRAP_TOKEN_SHA256 = "a965fbf3be158d4e0d76c889f9c82e8622d28a2c379680534fdc07df687fbea6";

export const STORES = Object.freeze({
  auth: "ezcards-auth-v1",
  data: "ezcards-data-v1",
  signals: "ezcards-signals-v1",
  config: "ezcards-config-v1",
  billing: "ezcards-billing-v1",
  tests: "ezcards-tests-v1",
});

export const ROLES = Object.freeze(["owner", "admin", "curator", "member"]);
export const PLANS = Object.freeze({
  beta: {
    id: "beta",
    name: "Beta Member",
    maxRules: 25,
    maxDevices: 2,
    familySeats: 1,
    queueAssist: true,
    telegramSignals: true,
    billingRequired: false,
  },
  individual: {
    id: "individual",
    name: "Individual",
    maxRules: 50,
    maxDevices: 2,
    familySeats: 1,
    queueAssist: true,
    telegramSignals: true,
    billingRequired: true,
  },
  family: {
    id: "family",
    name: "Family",
    maxRules: 100,
    maxDevices: 10,
    familySeats: 6,
    queueAssist: true,
    telegramSignals: true,
    billingRequired: true,
  },
});

export const GAMES = Object.freeze([
  { id: "pokemon", name: "Pokémon", aliases: ["pokemon", "pokémon", "pkmn"] },
  { id: "one-piece", name: "One Piece", aliases: ["one piece", "onepiece", "opcg"] },
  { id: "magic", name: "Magic: The Gathering", aliases: ["magic", "mtg", "magic the gathering"] },
  { id: "lorcana", name: "Disney Lorcana", aliases: ["lorcana", "disney lorcana"] },
  { id: "gundam", name: "Gundam Card Game", aliases: ["gundam", "newtype"] },
  { id: "dragon-ball", name: "Dragon Ball", aliases: ["dragon ball", "dragonball", "dbz", "fusion world"] },
]);

export const PRODUCT_TYPES = Object.freeze([
  { id: "etb", name: "Elite Trainer Box", aliases: ["elite trainer box", "etb"] },
  { id: "upc", name: "Ultra-Premium Collection", aliases: ["ultra premium collection", "ultra-premium collection", "upc"] },
  { id: "booster-box", name: "Booster Box", aliases: ["booster box", "display box"] },
  { id: "booster-bundle", name: "Booster Bundle", aliases: ["booster bundle"] },
  { id: "booster-pack", name: "Booster Pack", aliases: ["booster pack", "sleeved booster", "blister"] },
  { id: "tin", name: "Tin", aliases: ["tin", "mini tin"] },
  { id: "collection-box", name: "Collection Box", aliases: ["collection box", "ex box", "premium collection"] },
  { id: "promo-set", name: "Promo Card Set", aliases: ["promo set", "promo card", "card set"] },
  { id: "starter-deck", name: "Starter Deck", aliases: ["starter deck", "starter decks", "structure deck"] },
  { id: "accessories", name: "Accessories", aliases: ["accessories", "playmat", "deck box", "sleeves"] },
]);

export const VENDORS = Object.freeze([
  { id: "target", name: "Target", domains: ["target.com"] },
  { id: "walmart", name: "Walmart", domains: ["walmart.com"] },
  { id: "best-buy", name: "Best Buy", domains: ["bestbuy.com"] },
  { id: "pokemon-center", name: "Pokémon Center", domains: ["pokemoncenter.com", "pokemoncenter.ca", "pokemoncenter.com/en-gb"] },
  { id: "costco", name: "Costco", domains: ["costco.com"] },
  { id: "sams-club", name: "Sam's Club", domains: ["samsclub.com"] },
  { id: "gamestop", name: "GameStop", domains: ["gamestop.com"] },
  { id: "amazon", name: "Amazon", domains: ["amazon.com"] },
  { id: "card-shop", name: "Independent Card Shop", domains: [] },
  { id: "retailer-lab", name: "CardForge Local Lab", domains: ["ezcards.netlify.app", "localhost", "127.0.0.1"] },
]);

export const EVENT_TYPES = Object.freeze([
  "live_restock",
  "scheduled_drop",
  "presale_open",
  "preorder_deadline",
  "announcement",
  "status_update",
  "sold_out",
  "unknown",
]);

export const LAB_ALLOWED_PATHS = Object.freeze([
  "/local-retailer",
  "/retailer-lab.html",
  "/retailer-lab",
]);
