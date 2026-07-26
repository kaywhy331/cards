const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_SERVICE = "https://ezcards.netlify.app";
const ALLOWED_SERVICE_ORIGINS = new Set([
  "https://ezcards.netlify.app",
  "http://localhost:8888",
  "http://127.0.0.1:8888",
]);
const ALLOWED_PATHS = new Set(["/local-retailer", "/retailer-lab.html", "/retailer-lab"]);
const JOB_PAYLOAD_KEYS = [
  "jobId", "planVersion", "userId", "deviceId", "eventId", "action", "title",
  "vendorId", "sourceActionUrl", "targetUrl", "notBefore", "expiresAt", "policy",
];

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

async function hmacHex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function safeServiceUrl(input) {
  const url = new URL(String(input || DEFAULT_SERVICE));
  const origin = url.origin;
  if (!ALLOWED_SERVICE_ORIGINS.has(origin)) throw new Error("Service URL is outside the EZ Cards deployment allowlist.");
  return origin;
}

function safeTargetUrl(input, serviceOrigin) {
  const url = new URL(String(input || ""));
  if (url.origin !== serviceOrigin || !ALLOWED_PATHS.has(url.pathname)) throw new Error("Job target is outside the localized retailer lab boundary.");
  return url.toString();
}

async function settings() {
  const data = await chrome.storage.local.get(["serviceUrl", "deviceId", "authToken", "signingSecret", "device", "processedJobs", "pendingJobs"]);
  return {
    serviceUrl: safeServiceUrl(data.serviceUrl || DEFAULT_SERVICE),
    deviceId: data.deviceId || null,
    authToken: data.authToken || null,
    signingSecret: data.signingSecret || null,
    device: data.device || null,
    processedJobs: data.processedJobs || {},
    pendingJobs: data.pendingJobs || {},
  };
}

async function api(path, options = {}) {
  const config = await settings();
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (config.deviceId && config.authToken) {
    headers["x-device-id"] = config.deviceId;
    headers["x-device-token"] = config.authToken;
  }
  const response = await fetch(`${config.serviceUrl}/api${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `EZ Cards API returned ${response.status}.`);
  return payload;
}

function signedPayload(job) {
  return Object.fromEntries(JOB_PAYLOAD_KEYS.map((key) => [key, job[key]]));
}

async function verifyJob(job, config) {
  if (!job?.signature || !config.signingSecret) return false;
  if (job.deviceId !== config.deviceId) return false;
  if (Date.parse(job.expiresAt) <= Date.now()) return false;
  if (job.targetUrl) safeTargetUrl(job.targetUrl, config.serviceUrl);
  const expected = await hmacHex(config.signingSecret, stableStringify(signedPayload(job)));
  return expected === job.signature;
}

async function updateJob(jobId, status, metadata = {}) {
  try {
    await api(`/devices/jobs/${encodeURIComponent(jobId)}/status`, {
      method: "POST",
      body: JSON.stringify({ status, metadata }),
    });
  } catch (error) {
    console.warn("EZ Cards job status update failed", error);
  }
}

async function findLabTab(serviceOrigin) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    if (!tab.url) return false;
    try {
      const url = new URL(tab.url);
      return url.origin === serviceOrigin && ALLOWED_PATHS.has(url.pathname);
    } catch {
      return false;
    }
  }) || null;
}

async function openJob(job, config) {
  if (job.action === "NOTIFY_ONLY") {
    await chrome.notifications.create(`ezcards-${job.jobId}`, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "EZ Cards signal matched",
      message: job.title || "A matching TCG event is ready.",
    }).catch(() => {});
    await updateJob(job.jobId, "DELIVERED", { note: "Notification-only job delivered" });
    return;
  }

  const targetUrl = safeTargetUrl(job.targetUrl, config.serviceUrl);
  let tab = job.policy?.reuseExistingTab ? await findLabTab(config.serviceUrl) : null;
  if (tab) {
    tab = await chrome.tabs.update(tab.id, { url: targetUrl, active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  } else {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
  }
  await updateJob(job.jobId, "OPENED", { pageState: "NAVIGATING", path: new URL(targetUrl).pathname });
  await chrome.notifications.create(`ezcards-${job.jobId}`, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "Localized queue lab opened",
    message: job.title || "Human action is ready in CardForge Lab.",
  }).catch(() => {});
}

async function processJobs(jobs) {
  const config = await settings();
  const processed = { ...config.processedJobs };
  const pending = { ...config.pendingJobs };
  for (const job of jobs) {
    try {
      if (!(await verifyJob(job, config))) {
        console.warn("Rejected unsigned or invalid EZ Cards job", job?.jobId);
        continue;
      }
      const prior = processed[job.jobId];
      if (prior && Number(prior.planVersion) >= Number(job.planVersion)) {
        delete pending[job.jobId];
        continue;
      }
      const notBefore = Date.parse(job.notBefore);
      if (Number.isFinite(notBefore) && notBefore > Date.now()) {
        pending[job.jobId] = job;
        await chrome.alarms.create(`ezcards-job:${job.jobId}`, { when: notBefore });
        continue;
      }
      await openJob(job, config);
      processed[job.jobId] = { planVersion: job.planVersion, processedAt: new Date().toISOString() };
      delete pending[job.jobId];
      await chrome.alarms.clear(`ezcards-job:${job.jobId}`).catch(() => {});
    } catch (error) {
      console.error("EZ Cards job processing failed", error);
      if (job?.jobId) await updateJob(job.jobId, "FAILED", { note: String(error.message || error).slice(0, 180) });
    }
  }
  const entries = Object.entries(processed).sort((a, b) => String(b[1].processedAt).localeCompare(String(a[1].processedAt))).slice(0, 100);
  await chrome.storage.local.set({
    processedJobs: Object.fromEntries(entries),
    pendingJobs: pending,
    lastSyncAt: new Date().toISOString(),
  });
}

async function runScheduledJob(jobId) {
  const config = await settings();
  const job = config.pendingJobs[jobId];
  if (!job) return;
  await processJobs([job]);
}

async function reschedulePendingJobs() {
  const config = await settings();
  for (const job of Object.values(config.pendingJobs)) {
    if (!(await verifyJob(job, config))) continue;
    const when = Date.parse(job.notBefore);
    if (when <= Date.now()) await processJobs([job]);
    else await chrome.alarms.create(`ezcards-job:${job.jobId}`, { when });
  }
}

async function poll() {
  const config = await settings();
  if (!config.deviceId || !config.authToken || !config.signingSecret) return { paired: false };
  const payload = await api("/devices/jobs");
  await processJobs(payload.jobs || []);
  await api("/devices/heartbeat", { method: "POST", body: JSON.stringify({ extensionVersion: VERSION, capabilities: { localizedLab: true, signedJobs: true, pageObservation: true } }) });
  return { paired: true, jobs: payload.jobs?.length || 0 };
}

async function claim({ code, name, serviceUrl }) {
  const origin = safeServiceUrl(serviceUrl || DEFAULT_SERVICE);
  await chrome.storage.local.set({ serviceUrl: origin });
  const response = await fetch(`${origin}/api/devices/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name, platform: navigator.userAgentData?.platform || navigator.platform || "unknown", browser: "Chromium", extensionVersion: VERSION }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "Device pairing failed.");
  await chrome.storage.local.set({
    serviceUrl: origin,
    deviceId: payload.device.id,
    authToken: payload.authToken,
    signingSecret: payload.signingSecret,
    device: payload.device,
    processedJobs: {},
    pendingJobs: {},
    pairedAt: new Date().toISOString(),
  });
  await poll();
  return payload.device;
}

async function clearPairing() {
  await chrome.storage.local.remove(["deviceId", "authToken", "signingSecret", "device", "processedJobs", "pendingJobs", "pairedAt", "lastSyncAt"]);
}

function stateToStatus(state) {
  return ({ PREQUEUE: "QUEUED", QUEUED: "QUEUED", CHALLENGE: "CAPTCHA", READY: "READY", CHECKOUT: "READY", COMPLETE: "COMPLETED" })[state] || "OPENED";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "EZCARDS_PAIR") return { ok: true, device: await claim(message) };
    if (message?.type === "EZCARDS_CLEAR") { await clearPairing(); return { ok: true }; }
    if (message?.type === "EZCARDS_SYNC") return { ok: true, ...(await poll()) };
    if (message?.type === "EZCARDS_STATUS") return { ok: true, ...(await settings()), lastSyncAt: (await chrome.storage.local.get("lastSyncAt")).lastSyncAt || null };
    if (message?.type === "EZCARDS_LAB_STATE") {
      const url = sender.tab?.url ? new URL(sender.tab.url) : null;
      if (!url || !ALLOWED_SERVICE_ORIGINS.has(url.origin) || !ALLOWED_PATHS.has(url.pathname)) throw new Error("Ignored lab state outside the local boundary.");
      if (message.jobId && !message.jobId.startsWith("manual_")) await updateJob(message.jobId, stateToStatus(message.state), { pageState: message.state, path: url.pathname });
      return { ok: true };
    }
    return { ok: false, error: "Unknown extension message." };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("ezcards-poll", { periodInMinutes: 0.5 });
  reschedulePendingJobs().catch(console.warn);
  poll().catch(console.warn);
});
chrome.runtime.onStartup.addListener(() => {
  reschedulePendingJobs().catch(console.warn);
  poll().catch(console.warn);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ezcards-poll") poll().catch(console.warn);
  else if (alarm.name.startsWith("ezcards-job:")) runScheduledJob(alarm.name.slice("ezcards-job:".length)).catch(console.warn);
});
