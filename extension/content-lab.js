(() => {
  const allowedPaths = new Set(["/local-retailer", "/retailer-lab.html", "/retailer-lab"]);
  if (!allowedPaths.has(location.pathname)) return;
  let lastState = null;
  function report(detail = {}) {
    const state = detail.state || document.body?.dataset?.ezcardsLabState || "UNKNOWN";
    if (state === lastState && !detail.heartbeat) return;
    lastState = state;
    const params = new URLSearchParams(location.search);
    chrome.runtime.sendMessage({
      type: "EZCARDS_LAB_STATE",
      state,
      jobId: detail.jobId || params.get("job"),
      eventId: detail.eventId || params.get("event"),
      path: location.pathname,
    }).catch(() => {});
  }
  document.addEventListener("ezcards:lab-state", (event) => report(event.detail || {}));
  window.addEventListener("message", (event) => {
    if (event.source === window && event.origin === location.origin && event.data?.type === "EZCARDS_LAB_STATE") report(event.data);
  });
  const observer = new MutationObserver(() => report());
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-ezcards-lab-state"] });
  report();
})();
