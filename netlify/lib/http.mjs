export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function corsHeaders(req) {
  const origin = req.headers.get("origin");
  const currentOrigin = new URL(req.url).origin;
  const allowOrigin = origin?.startsWith("chrome-extension://") || origin?.startsWith("moz-extension://")
    ? origin
    : currentOrigin;
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, authorization, x-device-token, x-telegram-bot-api-secret-token, stripe-signature",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "vary": "origin",
  };
}

export function json(req, value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
      ...headers,
    },
  });
}

export function empty(req, status = 204, headers = {}) {
  return new Response(null, { status, headers: { ...corsHeaders(req), ...headers } });
}

export async function readJSON(req, maxBytes = 128_000) {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > maxBytes) throw new HttpError(413, "Request payload is too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request payload is too large.");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Invalid JSON payload."); }
}

export function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function requestIp(req, context) {
  return context?.ip || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function assertMethod(req, methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, "Method not allowed.");
}

export function cleanString(value, max = 200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function normalizeEmail(value) {
  return cleanString(value, 320).toLowerCase();
}

export function routePath(req) {
  const pathname = new URL(req.url).pathname;
  return pathname.startsWith("/api/") ? pathname.slice(4) || "/" : pathname;
}

export function errorResponse(req, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const payload = {
    ok: false,
    error: status === 500 ? "Internal server error." : error.message,
  };
  if (error instanceof HttpError && error.details !== undefined) payload.details = error.details;
  if (status === 500) console.error(error);
  return json(req, payload, status);
}
