import { STORES } from "./constants.mjs";

const memoryRoot = globalThis.__EZCARDS_MEMORY_STORES ?? new Map();
globalThis.__EZCARDS_MEMORY_STORES = memoryRoot;

function useMemory() {
  return process.env.EZCARDS_MEMORY_STORE === "1" || process.env.NODE_ENV === "test";
}

function useSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function memoryStore(name) {
  if (!memoryRoot.has(name)) memoryRoot.set(name, new Map());
  const map = memoryRoot.get(name);
  return {
    async get(key) { return map.has(key) ? structuredClone(map.get(key)) : null; },
    async set(key, value, options = {}) {
      if (options.onlyIfNew && map.has(key)) return { modified: false };
      map.set(key, structuredClone(value));
      return { modified: true, etag: `mem-${Date.now()}` };
    },
    async delete(key) { map.delete(key); },
    async list(prefix = "") { return [...map.keys()].filter((key) => key.startsWith(prefix)).sort(); },
    async clear() { map.clear(); },
  };
}

function supabaseHeaders(prefer = null) {
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

function supabaseStore(name) {
  const base = `${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/ezcards_kv`;
  const queryUrl = (params) => `${base}?${new URLSearchParams(params).toString()}`;
  return {
    async get(key) {
      const response = await fetch(queryUrl({ select: "value", store: `eq.${name}`, key: `eq.${key}`, limit: "1" }), { headers: supabaseHeaders() });
      if (!response.ok) throw new Error(`Supabase read failed (${response.status}).`);
      const rows = await response.json();
      return rows[0]?.value ?? null;
    },
    async set(key, value, options = {}) {
      const response = await fetch(base, {
        method: "POST",
        headers: supabaseHeaders(options.onlyIfNew ? "resolution=ignore-duplicates,return=representation" : "resolution=merge-duplicates,return=representation"),
        body: JSON.stringify({ store: name, key, value, updated_at: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(`Supabase write failed (${response.status}).`);
      const rows = await response.json();
      return { modified: rows.length > 0, etag: rows[0]?.updated_at || null };
    },
    async delete(key) {
      const response = await fetch(queryUrl({ store: `eq.${name}`, key: `eq.${key}` }), { method: "DELETE", headers: supabaseHeaders() });
      if (!response.ok) throw new Error(`Supabase delete failed (${response.status}).`);
    },
    async list(prefix = "") {
      const params = { select: "key", store: `eq.${name}`, order: "key.asc", limit: "1000" };
      if (prefix) params.key = `like.${prefix}*`;
      const response = await fetch(queryUrl(params), { headers: supabaseHeaders() });
      if (!response.ok) throw new Error(`Supabase list failed (${response.status}).`);
      return (await response.json()).map((row) => row.key);
    },
    async clear() {
      const response = await fetch(queryUrl({ store: `eq.${name}` }), { method: "DELETE", headers: supabaseHeaders() });
      if (!response.ok) throw new Error(`Supabase clear failed (${response.status}).`);
    },
  };
}

async function blobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name, consistency: "strong" });
  return {
    async get(key) { return store.get(key, { type: "json" }); },
    async set(key, value, options = {}) {
      return store.setJSON(key, value, {
        onlyIfNew: options.onlyIfNew,
        onlyIfMatch: options.onlyIfMatch,
        metadata: options.metadata,
      });
    },
    async delete(key) { return store.delete(key); },
    async list(prefix = "") {
      const keys = [];
      let cursor;
      do {
        const page = await store.list({ prefix, cursor });
        keys.push(...page.blobs.map((entry) => entry.key));
        cursor = page.next_cursor || page.nextCursor || null;
      } while (cursor);
      return keys.sort();
    },
    async clear() { return store.deleteAll(); },
  };
}

export function storageBackendName() {
  if (useMemory()) return "memory-test";
  if (useSupabase()) return "supabase-postgres";
  return "netlify-blobs";
}

export async function getStoreAdapter(name) {
  if (!Object.values(STORES).includes(name) && !name.startsWith("ezcards-")) throw new Error(`Unrecognized store: ${name}`);
  if (useMemory()) return memoryStore(name);
  if (useSupabase()) return supabaseStore(name);
  return blobStore(name);
}

export async function getJSON(storeName, key) { return (await getStoreAdapter(storeName)).get(key); }
export async function setJSON(storeName, key, value, options = {}) { return (await getStoreAdapter(storeName)).set(key, value, options); }
export async function deleteJSON(storeName, key) { return (await getStoreAdapter(storeName)).delete(key); }
export async function listJSON(storeName, prefix = "") {
  const store = await getStoreAdapter(storeName);
  const keys = await store.list(prefix);
  const rows = await Promise.all(keys.map(async (key) => ({ key, value: await store.get(key) })));
  return rows.filter((entry) => entry.value !== null);
}
export async function resetMemoryStores() { for (const store of memoryRoot.values()) store.clear(); }
