const $ = (selector) => document.querySelector(selector);
function send(message) { return chrome.runtime.sendMessage(message); }
function display(message, ok = false) { $("#message").textContent = message || ""; $("#message").classList.toggle("ok", ok); }
async function refresh() {
  const response = await send({ type: "EZCARDS_STATUS" });
  const paired = Boolean(response.ok && response.deviceId);
  $("#unpaired").hidden = paired; $("#paired").hidden = !paired;
  if (paired) {
    $("#deviceLabel").textContent = response.device?.name || "Paired browser";
    $("#serviceLabel").textContent = response.serviceUrl;
    $("#lastSync").textContent = response.lastSyncAt ? new Date(response.lastSyncAt).toLocaleTimeString() : "Never";
  }
}
$("#pair").addEventListener("click", async () => {
  display("Pairing…");
  const response = await send({ type: "EZCARDS_PAIR", serviceUrl: $("#serviceUrl").value.trim(), name: $("#deviceName").value.trim() || "Chrome extension", code: $("#pairingCode").value.trim().toUpperCase() });
  if (!response.ok) return display(response.error || "Pairing failed.");
  display("Paired successfully.", true); await refresh();
});
$("#sync").addEventListener("click", async () => { display("Syncing…"); const response = await send({ type: "EZCARDS_SYNC" }); display(response.ok ? `Synced ${response.jobs || 0} active job(s).` : response.error, response.ok); await refresh(); });
$("#openApp").addEventListener("click", async () => { const status = await send({ type: "EZCARDS_STATUS" }); chrome.tabs.create({ url: `${status.serviceUrl || "https://ezcards.netlify.app"}/#devices` }); });
$("#clear").addEventListener("click", async () => { await send({ type: "EZCARDS_CLEAR" }); display("Browser pairing removed.", true); await refresh(); });
refresh().catch((error) => display(error.message));
