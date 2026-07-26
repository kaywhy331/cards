import { JOB_TTL_MS, LAB_ALLOWED_PATHS, PAIRING_TTL_MS, STORES } from "./constants.mjs";
import { effectiveEntitlements } from "./auth.mjs";
import { hmacHex, randomCode, randomId, randomToken, secureEqual, signObject, sha256 } from "./crypto.mjs";
import { HttpError } from "./http.mjs";
import { deleteJSON, getJSON, listJSON, setJSON } from "./storage.mjs";

function devicePublic(device) {
  if (!device) return null;
  const { tokenHash, signingSecret, ...safe } = device;
  return safe;
}

export async function listDevices(userId) {
  const rows = await listJSON(STORES.data, `devices/user/${userId}/`);
  const devices = [];
  for (const { value: pointer } of rows) {
    const device = await getJSON(STORES.data, `devices/id/${pointer.deviceId}`);
    if (device) devices.push(devicePublic(device));
  }
  return devices.sort((a, b) => (b.lastSeenAt || b.createdAt).localeCompare(a.lastSeenAt || a.createdAt));
}

export async function createPairing(user) {
  const entitlement = effectiveEntitlements(user);
  const current = await listDevices(user.id);
  if (current.filter((device) => !device.revokedAt).length >= entitlement.maxDevices) {
    throw new HttpError(409, `Your plan supports up to ${entitlement.maxDevices} paired devices.`);
  }
  const code = randomCode(6);
  const now = Date.now();
  const pairing = {
    id: randomId("pair"),
    code,
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
    usedAt: null,
  };
  await setJSON(STORES.data, `pairings/${code}`, pairing, { onlyIfNew: true });
  return pairing;
}

export async function claimPairing({ code, name, platform, browser, extensionVersion }) {
  const normalized = String(code || "").trim().toUpperCase();
  const pairing = await getJSON(STORES.data, `pairings/${normalized}`);
  if (!pairing) throw new HttpError(404, "Pairing code not found.");
  if (pairing.usedAt) throw new HttpError(409, "Pairing code has already been used.");
  if (Date.parse(pairing.expiresAt) <= Date.now()) throw new HttpError(410, "Pairing code has expired.");

  const id = randomId("dev");
  const authToken = randomToken(32);
  const signingSecret = randomToken(32);
  const now = new Date().toISOString();
  const device = {
    id,
    userId: pairing.userId,
    name: String(name || "Browser extension").trim().slice(0, 80),
    platform: String(platform || "unknown").slice(0, 40),
    browser: String(browser || "unknown").slice(0, 40),
    extensionVersion: String(extensionVersion || "0.0.0").slice(0, 20),
    tokenHash: sha256(authToken),
    signingSecret,
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  await setJSON(STORES.data, `devices/id/${id}`, device, { onlyIfNew: true });
  await setJSON(STORES.data, `devices/user/${pairing.userId}/${id}`, { deviceId: id, createdAt: now });
  pairing.usedAt = now;
  pairing.deviceId = id;
  await setJSON(STORES.data, `pairings/${normalized}`, pairing);
  return { device: devicePublic(device), authToken, signingSecret };
}

export async function authenticateDevice(req) {
  const token = req.headers.get("x-device-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const deviceId = req.headers.get("x-device-id") || new URL(req.url).searchParams.get("deviceId");
  if (!token || !deviceId) throw new HttpError(401, "Device authentication is required.");
  const device = await getJSON(STORES.data, `devices/id/${deviceId}`);
  if (!device || device.revokedAt || !secureEqual(device.tokenHash, sha256(token))) {
    throw new HttpError(401, "Device credentials are invalid.");
  }
  return device;
}

export async function heartbeatDevice(device, patch = {}) {
  device.lastSeenAt = new Date().toISOString();
  if (patch.extensionVersion) device.extensionVersion = String(patch.extensionVersion).slice(0, 20);
  if (patch.capabilities) device.capabilities = patch.capabilities;
  await setJSON(STORES.data, `devices/id/${device.id}`, device);
  return devicePublic(device);
}

export async function revokeDevice(user, deviceId) {
  const device = await getJSON(STORES.data, `devices/id/${deviceId}`);
  if (!device || device.userId !== user.id) throw new HttpError(404, "Device not found.");
  device.revokedAt = new Date().toISOString();
  await setJSON(STORES.data, `devices/id/${deviceId}`, device);
  return devicePublic(device);
}

function labUrl(origin, jobId, eventId) {
  const base = new URL(origin);
  base.pathname = LAB_ALLOWED_PATHS[0];
  base.search = new URLSearchParams({ job: jobId, event: eventId }).toString();
  base.hash = "";
  return base.toString();
}

export function buildSignedJob(device, { event, match, origin, existingVersion = 0 }) {
  const now = Date.now();
  const jobId = randomId("job");
  const payload = {
    jobId,
    planVersion: existingVersion + 1,
    userId: match.userId,
    deviceId: device.id,
    eventId: event.id,
    action: match.action === "notify_only" ? "NOTIFY_ONLY" : "OPEN_RETAILER_LAB",
    title: event.productName || "TCG drop",
    vendorId: event.vendorId || "retailer-lab",
    sourceActionUrl: event.actionUrl || null,
    targetUrl: match.action === "notify_only" ? null : labUrl(origin, jobId, event.id),
    notBefore: new Date(Math.max(now, event.scheduledAt ? Date.parse(event.scheduledAt) - 60_000 : now)).toISOString(),
    expiresAt: new Date(Math.max(now + JOB_TTL_MS, event.scheduledAt ? Date.parse(event.scheduledAt) + JOB_TTL_MS : 0)).toISOString(),
    policy: {
      allowlistedPaths: LAB_ALLOWED_PATHS,
      maxTabs: 1,
      reuseExistingTab: true,
      allowReload: false,
      humanCheckoutRequired: true,
    },
  };
  return { ...payload, signature: signObject(device.signingSecret, payload) };
}

export async function dispatchMatches(event, matches, origin) {
  const jobs = [];
  for (const match of matches) {
    const devices = await listDevices(match.userId);
    const active = devices.find((device) => !device.revokedAt) || null;
    if (!active) continue;
    const device = await getJSON(STORES.data, `devices/id/${active.id}`);
    const dedupeKey = `job-dedupe/${match.userId}/${event.id}`;
    const existingPointer = await getJSON(STORES.data, dedupeKey);
    if (existingPointer) {
      const existing = await getJSON(STORES.data, `jobs/${device.id}/${existingPointer.jobId}`);
      if (existing && !["CANCELLED", "EXPIRED"].includes(existing.status)) {
        existing.eventConfirmationCount = event.observationCount;
        existing.updatedAt = new Date().toISOString();
        await setJSON(STORES.data, `jobs/${device.id}/${existing.jobId}`, existing);
        jobs.push(existing);
        continue;
      }
    }
    const signed = buildSignedJob(device, { event, match, origin });
    const job = {
      ...signed,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      eventConfirmationCount: event.observationCount,
    };
    await setJSON(STORES.data, `jobs/${device.id}/${job.jobId}`, job, { onlyIfNew: true });
    await setJSON(STORES.data, dedupeKey, { jobId: job.jobId, deviceId: device.id, createdAt: job.createdAt });
    jobs.push(job);
  }
  return jobs;
}

export async function listDeviceJobs(device) {
  const rows = await listJSON(STORES.data, `jobs/${device.id}/`);
  const now = Date.now();
  const jobs = [];
  for (const { key, value: job } of rows) {
    if (Date.parse(job.expiresAt) <= now && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(job.status)) {
      job.status = "EXPIRED";
      job.updatedAt = new Date().toISOString();
      await setJSON(STORES.data, key, job);
    }
    if (!["COMPLETED", "CANCELLED", "EXPIRED"].includes(job.status)) jobs.push(job);
  }
  return jobs.sort((a, b) => a.notBefore.localeCompare(b.notBefore));
}

export async function updateJobStatus(device, jobId, status, metadata = {}) {
  const allowed = ["DELIVERED", "OPENED", "QUEUED", "CAPTCHA", "READY", "COMPLETED", "FAILED", "CANCELLED"];
  if (!allowed.includes(status)) throw new HttpError(400, "Invalid job status.");
  const key = `jobs/${device.id}/${jobId}`;
  const job = await getJSON(STORES.data, key);
  if (!job) throw new HttpError(404, "Execution job not found.");
  job.status = status;
  job.updatedAt = new Date().toISOString();
  job.lastMetadata = {
    pageState: metadata.pageState ? String(metadata.pageState).slice(0, 40) : null,
    path: metadata.path && LAB_ALLOWED_PATHS.includes(metadata.path) ? metadata.path : null,
    note: metadata.note ? String(metadata.note).slice(0, 200) : null,
  };
  await setJSON(STORES.data, key, job);
  await setJSON(STORES.data, `job-events/${jobId}/${job.updatedAt}`, {
    id: randomId("jev"), jobId, deviceId: device.id, status, metadata: job.lastMetadata, at: job.updatedAt,
  });
  return job;
}

export async function createDemoJob(user, origin) {
  const devices = await listDevices(user.id);
  const active = devices.find((device) => !device.revokedAt);
  if (!active) throw new HttpError(409, "Pair a browser extension before sending a test job.");
  const event = {
    id: randomId("evt_demo"),
    productName: "Pitch Black Elite Trainer Box — Local Demo",
    vendorId: "retailer-lab",
    eventType: "scheduled_drop",
    actionUrl: null,
    scheduledAt: new Date(Date.now() + 3000).toISOString(),
    observationCount: 1,
  };
  const match = { userId: user.id, action: "queue_assist" };
  return (await dispatchMatches(event, [match], origin))[0];
}
