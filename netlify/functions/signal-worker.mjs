import { processObservation } from "../lib/signals.mjs";
import { verifyWorkerEnvelope } from "../lib/internal.mjs";

export default async (req) => {
  const payload = await req.json().catch(() => null);
  const valid = await verifyWorkerEnvelope(payload, req.headers.get("x-ezcards-internal-signature"), req.url);
  if (!valid) {
    console.warn("Rejected invalid EZ Cards signal worker envelope.");
    return;
  }
  await processObservation(payload.observationId, { origin: payload.origin });
};

export const config = {
  path: "/api-worker/process-signal",
  background: true,
  method: "POST",
};
