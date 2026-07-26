(() => {
  const $ = (selector) => document.querySelector(selector);
  const views = [...document.querySelectorAll("[data-view]")];
  const params = new URLSearchParams(location.search);
  const jobId = params.get("job") || `manual_${crypto.randomUUID?.() || Date.now()}`;
  const eventId = params.get("event") || "local_demo_event";
  const queueMode = params.get("mode") || "randomized";
  const storageKey = `ezcards-retailer-lab:${jobId}`;
  const initial = {
    state: "PRODUCT",
    jobId,
    eventId,
    queueMode,
    position: 14,
    initialPosition: 14,
    inventory: 12,
    cart: 0,
    purchaseEndsAt: null,
    receiptId: null,
    updatedAt: new Date().toISOString(),
  };
  let state = loadState();
  let timer = null;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      return stored && stored.jobId === jobId ? { ...initial, ...stored } : { ...initial };
    } catch {
      return { ...initial };
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function report(extra = {}) {
    const detail = {
      source: "ezcards-retailer-lab",
      jobId,
      eventId,
      state: state.state,
      path: location.pathname,
      position: state.position,
      updatedAt: state.updatedAt,
      ...extra,
    };
    document.dispatchEvent(new CustomEvent("ezcards:lab-state", { detail }));
    window.postMessage({ type: "EZCARDS_LAB_STATE", ...detail }, location.origin);
  }

  function show(next, extra = {}) {
    clearInterval(timer);
    state.state = next;
    Object.assign(state, extra);
    saveState();
    document.body.dataset.ezcardsLabState = next;
    $("#stateLabel").textContent = next;
    views.forEach((view) => view.classList.toggle("active", view.dataset.view === next));
    render();
    report();
    if (next === "PREQUEUE") runPrequeue();
    if (next === "QUEUED") runQueue();
    if (next === "READY") runPurchaseTimer();
  }

  function render() {
    $("#cartCount").textContent = String(state.cart);
    $("#inventoryLabel").textContent = `${state.inventory} fake units remaining`;
    $("#queuePosition").textContent = String(Math.max(0, state.position));
    const completed = state.initialPosition ? 1 - state.position / state.initialPosition : 0;
    $("#queueProgress").style.width = `${Math.max(5, Math.min(100, completed * 100))}%`;
    $("#queueEstimate").textContent = state.position > 8 ? "Estimated wait: under 1 minute" : state.position > 0 ? "Estimated wait: a few seconds" : "Admission ready";
    $("#queueModeLabel").textContent = queueMode === "fifo" ? "FIFO" : queueMode === "traffic" ? "Traffic triggered" : "Randomized";
    $("#sessionShort").textContent = `LAB-${jobId.slice(-6).toUpperCase()}`;
    if (state.receiptId) {
      $("#receiptId").textContent = state.receiptId;
      $("#receiptTime").textContent = `Created ${new Date(state.updatedAt).toLocaleString()}`;
    }
  }

  function runPrequeue() {
    let seconds = 5;
    $("#prequeueCountdown").textContent = `00:0${seconds}`;
    timer = setInterval(() => {
      seconds -= 1;
      $("#prequeueCountdown").textContent = `00:0${Math.max(0, seconds)}`;
      if (seconds <= 0) {
        clearInterval(timer);
        const seed = [...jobId].reduce((total, char) => total + char.charCodeAt(0), 0);
        const position = queueMode === "fifo" ? 8 : queueMode === "traffic" ? 18 : 8 + (seed % 13);
        show("QUEUED", { position, initialPosition: position });
      }
    }, 1000);
  }

  function runQueue() {
    timer = setInterval(() => {
      const decrement = queueMode === "traffic" ? 1 : 2;
      state.position = Math.max(0, state.position - decrement);
      saveState();
      render();
      report({ heartbeat: true });
      if (state.position <= 0) {
        clearInterval(timer);
        show("CHALLENGE");
      }
    }, 1100);
  }

  function runPurchaseTimer() {
    if (!state.purchaseEndsAt || Date.parse(state.purchaseEndsAt) <= Date.now()) {
      state.purchaseEndsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      saveState();
    }
    const update = () => {
      const remaining = Math.max(0, Date.parse(state.purchaseEndsAt) - Date.now());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      $("#purchaseCountdown").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      if (remaining <= 0) {
        clearInterval(timer);
        state.purchaseEndsAt = null;
        show("PRODUCT");
      }
    };
    update();
    timer = setInterval(update, 1000);
  }

  $("#joinDrop").addEventListener("click", () => show("PREQUEUE"));
  $("#cancelQueue").addEventListener("click", () => show("PRODUCT", { position: initial.position, initialPosition: initial.initialPosition }));
  $("#forceChallenge").addEventListener("click", () => show("CHALLENGE"));
  $("#humanCheck").addEventListener("change", (event) => { $("#completeChallenge").disabled = !event.target.checked; });
  $("#completeChallenge").addEventListener("click", () => show("READY", { purchaseEndsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() }));
  $("#addToCart").addEventListener("click", () => {
    state.cart = 1;
    saveState();
    show("CHECKOUT");
  });
  $("#cartButton").addEventListener("click", () => state.cart ? show("CHECKOUT") : alert("The demo cart is empty."));
  $("#accountButton").addEventListener("click", () => alert("Synthetic collector profile: local-demo-account"));
  $("#checkoutForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (state.inventory <= 0) return alert("Synthetic inventory is exhausted.");
    state.inventory -= 1;
    state.cart = 0;
    state.receiptId = `LAB-${new Date().toISOString().slice(0,10).replaceAll("-", "")}-${jobId.slice(-6).toUpperCase()}`;
    show("COMPLETE");
  });
  $("#restartLab").addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    state = { ...initial };
    $("#humanCheck").checked = false;
    $("#completeChallenge").disabled = true;
    show("PRODUCT");
  });

  render();
  show(state.state);
})();
