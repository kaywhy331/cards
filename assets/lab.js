(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const seedBase = 331;
  const baseTasks = [
    { id: "etb-primary", group: "Pokémon premium", product: "Pitch Black ETB", type: "ETB", profile: "Primary collector", account: "acct-001", device: "win-chrome-01", route: "lab-west" },
    { id: "upc-family", group: "Pokémon premium", product: "Pitch Black UPC", type: "UPC", profile: "Family seat 2", account: "acct-002", device: "mac-chrome-02", route: "lab-central" },
    { id: "promo-friend", group: "One Piece presale", product: "Luffy / Zoro / Sanji promo", type: "Promo", profile: "Friend seat 3", account: "acct-003", device: "win-edge-03", route: "lab-east" },
    { id: "duplicate", group: "Defensive probes", product: "Pitch Black ETB", type: "ETB", profile: "Duplicate-account probe", account: "acct-001", device: "win-chrome-dup", route: "lab-west-2" },
    { id: "lorcana", group: "Lorcana releases", product: "Fabled Realms booster", type: "Booster", profile: "Family seat 4", account: "acct-004", device: "win-chrome-04", route: "lab-south" },
    { id: "gundam", group: "Gundam releases", product: "Newtype Rising starter", type: "Starter", profile: "Friend seat 5", account: "acct-005", device: "win-edge-05", route: "lab-north" },
  ];
  const lab = { status: "idle", tick: 0, timer: null, tasks: [], logs: [], inventory: { ETB: 4, UPC: 2, Promo: 5, Booster: 3, Starter: 3 }, orders: [], rejected: 0 };

  function mode() { return $("#queueMode").value; }
  function position(index) {
    if (mode() === "fifo") return index + 1;
    const value = Math.sin(seedBase * 12.9898 + (index + 3) * 78.233) * 43758.5453;
    const fraction = value - Math.floor(value);
    return mode() === "traffic" ? 6 + index + Math.floor(fraction * 6) : 1 + Math.floor(fraction * baseTasks.length);
  }
  function tasks() {
    return baseTasks.filter((task) => $("#duplicate").checked || task.id !== "duplicate").map((task, index) => ({ ...task, status: "ready", progress: 0, position: null, initialPosition: position(index), challenge: "none", order: null, error: null }));
  }
  function log(level, message) {
    lab.logs.unshift({ level, message, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });
    lab.logs = lab.logs.slice(0, 80);
  }
  function reset() {
    clearInterval(lab.timer); lab.status = "idle"; lab.tick = 0; lab.tasks = tasks(); lab.logs = []; lab.inventory = { ETB: 4, UPC: 2, Promo: 5, Booster: 3, Starter: 3 }; lab.orders = []; lab.rejected = 0;
    log("info", "AIO education lab initialized. All accounts, inventory, tokens, routes, and receipts are synthetic.");
    $("#run").disabled = false; $("#run").textContent = "Run tasks"; render();
  }
  function start() {
    if (lab.status === "running") return;
    if (lab.status === "complete") reset();
    lab.status = "running"; $("#run").disabled = true; $("#run").textContent = "Running";
    log("success", `${$("#queueMode").selectedOptions[0].text} scenario started with ${lab.tasks.length} synthetic tasks.`);
    lab.timer = setInterval(step, 850); render();
  }
  function step() {
    lab.tick += 1;
    const rate = Math.max(1, Math.min(5, Number($("#rate").value) || 2));
    const claimedAccounts = new Set(lab.tasks.filter((task) => ["checkout", "success"].includes(task.status)).map((task) => task.account));
    for (const [index, task] of lab.tasks.entries()) {
      if (lab.tick === 1 && task.status === "ready") { task.status = "monitoring"; task.progress = 10; continue; }
      if (lab.tick === 2 && task.status === "monitoring") { task.status = "queued"; task.position = task.initialPosition; task.progress = 24; continue; }
      if (task.status === "queued") {
        task.position = Math.max(0, task.position - rate); task.progress = Math.min(60, task.progress + 10);
        if (!task.position) {
          if ($("#challenges").checked && (index % 3 === 0 || task.id === "duplicate")) { task.status = "challenge"; task.challenge = "pending"; task.progress = 64; }
          else { task.status = "admitted"; task.progress = 74; }
        }
        continue;
      }
      if (task.status === "admitted") {
        if (claimedAccounts.has(task.account)) { reject(task, "Duplicate synthetic account session rejected"); continue; }
        claimedAccounts.add(task.account);
        if ($("#routeChange").checked && task.id === "upc-family") { reject(task, "Route continuity changed after queue admission"); continue; }
        task.status = "checkout"; task.progress = 86; continue;
      }
      if (task.status === "checkout" && $("#autoCheckout").checked) finishOrder(task, index);
    }
    if (lab.tick === 1) log("info", "Owned catalog monitors armed. No external host was contacted.");
    if (lab.tick === 2) log("info", "Synthetic HMAC queue sessions issued with account/device/route binding.");
    if (lab.tick === 4) log("warn", "Continuity, replay, and duplicate-account controls evaluated.");
    if (lab.tasks.every((task) => ["success", "failed", "checkout"].includes(task.status)) && !lab.tasks.some((task) => task.status === "challenge")) {
      clearInterval(lab.timer); lab.status = "complete"; $("#run").disabled = false; $("#run").textContent = "Run again"; log("success", "Scenario reached a terminal state with third-party network actions blocked.");
    }
    render();
  }
  function reject(task, message) { task.status = "failed"; task.error = message; task.progress = 100; lab.rejected += 1; log("error", `${task.profile}: ${message}.`); }
  function finishOrder(task, index) {
    const stock = lab.inventory[task.type] ?? 10;
    if (stock <= 0) { reject(task, `Synthetic ${task.type} inventory exhausted`); return; }
    lab.inventory[task.type] = stock - 1;
    const idempotency = `${task.account}:${task.id}`;
    const existing = lab.orders.find((order) => order.idempotency === idempotency);
    if (existing) { task.order = existing.id; task.status = "success"; task.progress = 100; return; }
    const order = { id: `LAB-${String(index + 1).padStart(3,"0")}-${Date.now().toString().slice(-5)}`, idempotency, product: task.product, profile: task.profile, at: new Date().toISOString() };
    lab.orders.push(order); task.order = order.id; task.status = "success"; task.progress = 100; log("success", `${task.profile}: idempotent fake order ${order.id} created.`);
  }
  function completeChallenge(id) { const task = lab.tasks.find((item) => item.id === id); if (!task || task.status !== "challenge") return; task.challenge = "passed"; task.status = "admitted"; task.progress = 74; log("success", `${task.profile}: tester completed owned mock verification.`); render(); }
  function manualCheckout(id) { const task = lab.tasks.find((item) => item.id === id); if (!task || task.status !== "checkout") return; finishOrder(task, lab.tasks.indexOf(task)); render(); }

  function render() {
    const counts = (status) => lab.tasks.filter((task) => status.includes(task.status)).length;
    $("#runState").textContent = lab.status; $("#tickState").textContent = `Tick ${lab.tick}`; $("#monitorMetric").textContent = counts(["monitoring"]); $("#queueMetric").textContent = counts(["queued","admitted"]); $("#challengeMetric").textContent = counts(["challenge"]); $("#orderMetric").textContent = lab.orders.length; $("#rejectMetric").textContent = lab.rejected;
    $("#taskBadge").textContent = lab.tasks.length; $("#queueBadge").textContent = counts(["queued","admitted"]); $("#challengeBadge").textContent = lab.tasks.filter((task) => task.challenge !== "none").length; $("#orderBadge").textContent = lab.orders.length; $("#logBadge").textContent = lab.logs.length;
    $("#tasks").innerHTML = lab.tasks.map((task) => `<tr><td><strong>${task.product}</strong><small>${task.group} · ${task.type}</small></td><td><strong>${task.profile}</strong><small>${task.account} · ${task.device} · ${task.route}</small></td><td><strong>${task.position ?? "—"}</strong><small>${mode()}</small></td><td><div class="progress"><i style="width:${task.progress}%"></i></div><small>${task.progress}%</small></td><td><span class="status ${task.status}">${task.status}</span>${task.error ? `<small>${task.error}</small>` : ""}${task.order ? `<small>${task.order}</small>` : ""}${task.status === "checkout" && !$("#autoCheckout").checked ? `<button data-checkout="${task.id}">Complete fake checkout</button>` : ""}</td></tr>`).join("");
    $("#queueTrack").innerHTML = lab.tasks.map((task,index) => `<article class="queue-node"><b>${task.position ?? index + 1}</b><strong>${task.profile}</strong><small>${task.status}</small></article>`).join("") + '<div class="gate">ADMIT</div>';
    const challengeTasks = lab.tasks.filter((task) => task.challenge !== "none");
    $("#challengeGrid").innerHTML = challengeTasks.length ? challengeTasks.map((task) => `<article class="challenge-card"><span class="status challenge">Mock check</span><strong>${task.profile}</strong><small>${task.product} · ${task.challenge}</small>${task.challenge === "pending" ? `<button data-challenge="${task.id}">Complete as human tester</button>` : '<span class="status success">passed</span>'}</article>`).join("") : '<div class="empty">No challenges issued.</div>';
    $("#etb").textContent = lab.inventory.ETB; $("#upc").textContent = lab.inventory.UPC; $("#promo").textContent = lab.inventory.Promo; $("#receipts").textContent = lab.orders.length;
    $("#orders").innerHTML = lab.orders.length ? lab.orders.map((order) => `<article class="order-row"><div><strong>${order.product}</strong><small>${order.profile} · ${new Date(order.at).toLocaleTimeString()}</small></div><code>${order.id}</code></article>`).join("") : '<div class="empty">No sandbox orders yet.</div>';
    $("#logs").innerHTML = lab.logs.length ? lab.logs.map((entry) => `<article class="log ${entry.level}"><time>${entry.at}</time><b>${entry.level}</b><p>${entry.message}</p></article>`).join("") : '<div class="empty">Runtime log cleared.</div>';
    $$('[data-challenge]').forEach((button) => button.addEventListener("click", () => completeChallenge(button.dataset.challenge)));
    $$('[data-checkout]').forEach((button) => button.addEventListener("click", () => manualCheckout(button.dataset.checkout)));
  }

  $$(".nav").forEach((button) => button.addEventListener("click", () => { $$(".nav").forEach((item) => item.classList.toggle("active", item === button)); $$("[data-panel-view]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panelView === button.dataset.panel)); }));
  $("#run").addEventListener("click", start); $("#reset").addEventListener("click", reset); $("#clearLogs").addEventListener("click", () => { lab.logs = []; render(); });
  ["#queueMode","#duplicate"].forEach((selector) => $(selector).addEventListener("change", () => { if (lab.status !== "running") reset(); }));
  reset();
})();
