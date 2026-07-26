import { randomToken, signObject, verifyObjectSignature } from "./crypto.mjs";
import { STORES } from "./constants.mjs";
import { getJSON, setJSON } from "./storage.mjs";

async function internalSecret() {
  if (process.env.EZCARDS_INTERNAL_SECRET) return process.env.EZCARDS_INTERNAL_SECRET;
  const key = "internal/worker-secret";
  const existing = await getJSON(STORES.config, key);
  if (existing?.value) return existing.value;
  const value = randomToken(32);
  const write = await setJSON(STORES.config, key, { value, createdAt: new Date().toISOString() }, { onlyIfNew: true });
  return write.modified ? value : (await getJSON(STORES.config, key)).value;
}

export async function createWorkerEnvelope(observationId, origin) {
  const now = Date.now();
  const payload = {
    observationId: String(observationId),
    origin: new URL(origin).origin,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
  };
  return { payload, signature: signObject(await internalSecret(), payload) };
}

export async function verifyWorkerEnvelope(payload, signature, requestOrigin) {
  if (!payload?.observationId || !payload?.origin || !payload?.expiresAt || !payload?.issuedAt) return false;
  if (new URL(payload.origin).origin !== new URL(requestOrigin).origin) return false;
  if (Date.parse(payload.expiresAt) <= Date.now() || Date.parse(payload.issuedAt) > Date.now() + 60_000) return false;
  return verifyObjectSignature(await internalSecret(), payload, signature);
}

export async function dispatchSignalWorker(observationId, origin) {
  const { payload, signature } = await createWorkerEnvelope(observationId, origin);
  const response = await fetch(`${new URL(origin).origin}/api-worker/process-signal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ezcards-internal-signature": signature,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 202) throw new Error(`Background signal worker dispatch failed (${response.status}).`);
  return { accepted: true, status: response.status };
}
