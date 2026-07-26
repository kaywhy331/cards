import { getXBearerToken } from "./billing.mjs";

export function extractXStatusId(input) {
  return String(input || "").match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i)?.[1] || null;
}

export async function enrichXSource(input) {
  const statusId = extractXStatusId(input);
  if (!statusId) return null;
  const token = await getXBearerToken();
  if (!token) return { statusId, configured: false, text: null, urls: [] };
  const endpoint = new URL(`https://api.x.com/2/tweets/${statusId}`);
  endpoint.searchParams.set("tweet.fields", "entities,text,created_at");
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.data) return { statusId, configured: true, error: payload.detail || payload.title || `X API ${response.status}`, text: null, urls: [] };
  const urls = (payload.data.entities?.urls || []).map((entity) => entity.unwound_url || entity.expanded_url || entity.url).filter(Boolean);
  return { statusId, configured: true, text: payload.data.text || null, createdAt: payload.data.created_at || null, urls: [...new Set(urls)] };
}
