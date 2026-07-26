(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const toast = $("#toast");
  let toastTimer;
  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  const viewButtons = $$("[data-go], .nav-link");
  function showView(name) {
    $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === name));
    $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  viewButtons.forEach((button) => button.addEventListener("click", () => showView(button.dataset.go || button.dataset.view)));
  const initialHash = location.hash.replace("#", "");
  if (["overview", "signals", "rules", "lab"].includes(initialHash)) showView(initialHash);

  const commandDialog = $("#commandDialog");
  $("#openCommand").addEventListener("click", () => commandDialog.showModal());
  $("#closeCommand").addEventListener("click", () => commandDialog.close());
  $$('[data-go]', commandDialog).forEach((button) => button.addEventListener("click", () => commandDialog.close()));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      commandDialog.showModal();
    }
    if (!commandDialog.open && ["1", "2", "3", "4"].includes(event.key)) {
      const map = { 1: "overview", 2: "signals", 3: "rules", 4: "lab" };
      showView(map[event.key]);
    }
  });

  $("#runReadiness").addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Running checks…";
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Run test drop";
      notify("Test drop passed: notification, timing, and local handoff are ready.");
    }, 1300);
  });

  let signalSequence = 1;
  $("#addSignal").addEventListener("click", () => {
    const entry = document.createElement("article");
    entry.className = "signal-entry";
    entry.dataset.status = "Live";
    entry.innerHTML = `
      <div class="source-avatar">T</div>
      <div><strong>Simulated Pitch Black restock confirmation #${signalSequence++}</strong><small>Owned demo intake · just now</small></div>
      <div><span class="entity-tag">Pokémon</span><span class="entity-tag">ETB</span><span class="entity-tag">Target</span></div>
      <div class="dedupe-cell"><strong>event_pb_target_07</strong><small>Merged into existing event</small></div>
      <span class="status-chip merged">Merged</span>`;
    $("#signalTable").prepend(entry);
    $("#metricSignals").textContent = String(Number($("#metricSignals").textContent) + 1);
    notify("New observation classified and merged. No duplicate execution job created.");
  });

  $("#signalStatus").addEventListener("change", (event) => {
    const filter = event.target.value;
    $$(".signal-entry").forEach((entry) => {
      entry.style.display = filter === "All statuses" || entry.dataset.status === filter ? "grid" : "none";
    });
  });

  const selectionGroups = {
    games: $("#logicGames"),
    products: $("#logicProducts"),
    vendors: $("#logicVendors"),
  };

  function updateRulePreview() {
    Object.entries(selectionGroups).forEach(([group, target]) => {
      const values = $$(`[data-choice-group="${group}"] .selected`).map((button) => button.dataset.value || button.textContent.trim());
      target.textContent = values.length ? values.join(" OR ") : "Nothing selected";
    });
    const activeRules = $$("[data-choice-group] .selected").length > 0 ? 3 : 2;
    $("#metricRules").textContent = String(activeRules);
  }

  $$('[data-choice-group] button').forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("selected");
      updateRulePreview();
    });
  });

  function currentPreferences() {
    const selections = {};
    Object.keys(selectionGroups).forEach((group) => {
      selections[group] = $$(`[data-choice-group="${group}"] .selected`).map((button) => button.dataset.value || button.textContent.trim());
    });
    selections.behavior = $('input[name="behavior"]:checked')?.value || "queue";
    return selections;
  }

  $("#saveRules").addEventListener("click", () => {
    localStorage.setItem("cards-demo-watch-rule", JSON.stringify(currentPreferences()));
    $("#savedNote").textContent = `Saved locally · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    notify("Watch rule saved to this browser. Production persistence will use the member database.");
  });

  try {
    const saved = JSON.parse(localStorage.getItem("cards-demo-watch-rule") || "null");
    if (saved) {
      Object.entries(saved).forEach(([group, values]) => {
        if (!Array.isArray(values)) return;
        $$(`[data-choice-group="${group}"] button`).forEach((button) => {
          button.classList.toggle("selected", values.includes(button.dataset.value || button.textContent.trim()));
        });
      });
      if (saved.behavior) {
        const radio = $(`input[name="behavior"][value="${saved.behavior}"]`);
        if (radio) radio.checked = true;
      }
      updateRulePreview();
      $("#savedNote").textContent = "Restored from local demo storage.";
    }
  } catch {
    localStorage.removeItem("cards-demo-watch-rule");
  }

  const baseTasks = [
    { id: "pb-etb", group: "Pokémon Premium", product: "Pitch Black Elite Trainer Box", type: "ETB", profile: "Kevin · Primary", account: "collector-001", device: "chrome-win-01", route: "lab-west" },
    { id: "pb-upc", group: "Pokémon Premium", product: "Pitch Black Ultra-Premium Collection", type: "UPC", profile: "Family · Seat 2", account: "collector-002", device: "chrome-mac-02", route: "lab-central" },
    { id: "op-promo", group: "One Piece Presales", product: "Luffy, Zoro & Sanji Promo Set", type: "Promo", profile: "Friend · Seat 3", account: "collector-003", device: "edge-win-03", route: "lab-east" },
    { id: "duplicate", group: "Abuse-resistance", product: "Pitch Black Elite Trainer Box", type: "ETB", profile: "Duplicate account probe", account: "collector-001", device: "chrome-win-dup", route: "lab-west-2" },
    { id: "lorcana", group: "Lorcana Watch", product: "Fabled Realms Booster Box", type: "Booster", profile: "Family · Seat 4", account: "collector-004", device: "chrome-win-04", route: "lab-south" },
    { id: "gundam", group: "Gundam Releases", product: "Newtype Rising Starter Deck", type: "Starter", profile: "Friend · Seat 5", account: "collector-005", device: "edge-win-05", route: "lab-north" },
  ];

  const lab = {
    state: "idle",
    tick: 0,
    timer: null,
    tasks: [],
    logs: [],
    etb: 5,
    upc: 3,
    orderCount: 0,
    rejected: 0,
  };

  function timeLabel() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function addLog(level, message) {
    lab.logs.unshift({ at: timeLabel(), level, message });
    lab.logs = lab.logs.slice(0, 70);
    renderLogs();
  }

  function seeded(index) {
    const queueMode = $("#queueMode").value;
    if (queueMode === "fifo") return index + 1;
    const value = Math.sin(331 * 12.9898 + (index + 11) * 78.233) * 43758.5453;
    const fraction = value - Math.floor(value);
    return queueMode === "traffic" ? index + 2 + Math.floor(fraction * 5) : 1 + Math.floor(fraction * baseTasks.length);
  }

  function freshTasks() {
    const duplicate = $("#duplicateToggle").checked;
    return baseTasks.filter((task) => duplicate || task.id !== "duplicate").map((task, index) => ({
      ...task,
      status: "ready",
      position: null,
      progress: 0,
      challenge: "none",
      initialPosition: seeded(index),
      orderId: null,
      failure: null,
    }));
  }

  function resetLab() {
    clearInterval(lab.timer);
    lab.state = "idle";
    lab.tick = 0;
    lab.tasks = freshTasks();
    lab.logs = [];
    lab.etb = 5;
    lab.upc = 3;
    lab.orderCount = 0;
    lab.rejected = 0;
    addLog("info", "Lab ready. All identities, tokens, inventory, and orders are synthetic.");
    renderLab();
    $("#startLab").textContent = "Start simulation";
    $("#startLab").disabled = false;
  }

  function startLab() {
    if (lab.state === "running") return;
    if (lab.state === "complete") resetLab();
    lab.state = "running";
    $("#startLab").textContent = "Simulation running";
    $("#startLab").disabled = true;
    addLog("success", `${$("#queueMode").selectedOptions[0].text} run started with ${lab.tasks.length} synthetic tasks.`);
    lab.timer = setInterval(stepLab, 850);
    renderLab();
  }

  function stepLab() {
    lab.tick += 1;
    const admissionRate = Math.max(1, Math.min(5, Number($("#admissionRate").value) || 2));
    const challengeEnabled = $("#challengeToggle").checked;
    const routeProbe = $("#routeToggle").checked;
    const claimedAccounts = new Set(lab.tasks.filter((task) => ["admitted", "checkout", "success"].includes(task.status)).map((task) => task.account));

    lab.tasks.forEach((task, index) => {
      if (lab.tick === 1 && task.status === "ready") {
        task.status = "monitoring";
        task.progress = 8;
        return;
      }
      if (lab.tick === 2 && task.status === "monitoring") {
        task.status = "queued";
        task.position = task.initialPosition;
        task.progress = 20;
        return;
      }
      if (task.status === "queued") {
        task.position = Math.max(0, task.position - admissionRate);
        task.progress = Math.min(58, task.progress + 11);
        if (task.position === 0) {
          const needsChallenge = challengeEnabled && (index % 3 === 0 || task.id === "duplicate");
          if (needsChallenge) {
            task.status = "challenge";
            task.challenge = "pending";
            task.progress = 62;
          } else {
            task.status = "admitted";
            task.progress = 72;
          }
        }
        return;
      }
      if (task.status === "admitted") {
        if (claimedAccounts.has(task.account)) {
          task.status = "failed";
          task.failure = "Duplicate synthetic account session rejected";
          task.progress = 100;
          lab.rejected += 1;
          addLog("error", `${task.profile}: duplicate account session rejected.`);
          return;
        }
        claimedAccounts.add(task.account);
        if (routeProbe && task.id === "pb-upc") {
          task.status = "failed";
          task.failure = "Session affinity invalidated after route change";
          task.progress = 100;
          lab.rejected += 1;
          addLog("warn", `${task.profile}: route-change probe invalidated the synthetic session.`);
          return;
        }
        task.status = "checkout";
        task.progress = 84;
        return;
      }
      if (task.status === "checkout") {
        if (task.type === "ETB") {
          if (lab.etb <= 0) {
            task.status = "failed";
            task.failure = "Synthetic ETB inventory exhausted";
            task.progress = 100;
            lab.rejected += 1;
            return;
          }
          lab.etb -= 1;
        }
        if (task.type === "UPC") {
          if (lab.upc <= 0) {
            task.status = "failed";
            task.failure = "Synthetic UPC inventory exhausted";
            task.progress = 100;
            lab.rejected += 1;
            return;
          }
          lab.upc -= 1;
        }
        task.status = "success";
        task.progress = 100;
        task.orderId = `LAB-331-${String(index + 1).padStart(3, "0")}`;
        lab.orderCount += 1;
        addLog("success", `${task.profile}: fake order ${task.orderId} created idempotently.`);
      }
    });

    if (lab.tick === 1) addLog("info", "Product monitors armed against the owned sandbox catalog.");
    if (lab.tick === 2) addLog("info", "Synthetic queue tokens issued and bound to event, account, device, and route.");
    if (lab.tick === 4) addLog("warn", "Risk engine evaluated continuity and duplicate-session controls.");

    const terminal = lab.tasks.every((task) => ["success", "failed"].includes(task.status));
    if (terminal) {
      clearInterval(lab.timer);
      lab.state = "complete";
      $("#startLab").textContent = "Run again";
      $("#startLab").disabled = false;
      addLog("success", "Run complete. No third-party retailer system was contacted.");
    }
    renderLab();
  }

  function completeChallenge(taskId) {
    const task = lab.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status !== "challenge") return;
    task.challenge = "passed";
    task.status = "admitted";
    task.progress = 72;
    addLog("success", `${task.profile}: owned mock challenge completed by the tester.`);
    renderLab();
  }

  function renderTasks() {
    $("#taskTableBody").innerHTML = lab.tasks.map((task) => `
      <tr>
        <td><strong>${task.product}</strong><small>${task.group} · ${task.type}</small></td>
        <td><strong>${task.profile}</strong><small>${task.account} · ${task.device}</small></td>
        <td><strong>${task.position === null ? "—" : task.position}</strong><small>${task.route}</small></td>
        <td><div class="progress-track"><span style="width:${task.progress}%"></span></div><small>${task.progress}%</small></td>
        <td><span class="task-status ${task.status}">${task.status}</span>${task.failure ? `<small>${task.failure}</small>` : ""}${task.orderId ? `<small>${task.orderId}</small>` : ""}</td>
      </tr>`).join("");
  }

  function renderQueue() {
    $("#queueVisual").innerHTML = lab.tasks.map((task, index) => `
      <article class="queue-node">
        <span>${task.position === null ? index + 1 : task.position}</span>
        <strong>${task.profile}</strong>
        <small>${task.status}</small>
      </article>`).join("") + '<div class="queue-gate">ADMIT</div>';
  }

  function renderChallenges() {
    const challenged = lab.tasks.filter((task) => task.challenge !== "none");
    $("#challengeGrid").innerHTML = challenged.length ? challenged.map((task) => `
      <article class="challenge-card">
        <span class="mini-chip orange">Mock challenge</span>
        <strong>${task.profile}</strong>
        <small>${task.product} · ${task.challenge}</small>
        ${task.challenge === "pending" ? `<button data-complete-challenge="${task.id}">Complete human verification</button>` : '<span class="task-status success">passed</span>'}
      </article>`).join("") : '<div class="empty-state">No mock challenges issued yet.</div>';
    $$('[data-complete-challenge]').forEach((button) => button.addEventListener("click", () => completeChallenge(button.dataset.completeChallenge)));
  }

  function renderOrders() {
    const checkout = lab.tasks.filter((task) => ["checkout", "success", "failed"].includes(task.status));
    $("#orderList").innerHTML = checkout.length ? checkout.map((task) => `
      <div class="order-row"><div><strong>${task.product}</strong><small>${task.profile}</small></div><span>${task.orderId || task.failure || task.status}</span></div>`).join("") : '<div class="empty-state">No task has reached sandbox checkout.</div>';
    $("#etbInventory").textContent = String(lab.etb);
    $("#upcInventory").textContent = String(lab.upc);
    $("#orderInventory").textContent = String(lab.orderCount);
    $("#rejectInventory").textContent = String(lab.rejected);
  }

  function renderLogs() {
    $("#runtimeLog").innerHTML = lab.logs.length ? lab.logs.map((entry) => `
      <div class="log-row ${entry.level}"><time>${entry.at}</time><b>${entry.level}</b><p>${entry.message}</p></div>`).join("") : '<div class="empty-state">Runtime log cleared.</div>';
    $("#logTabCount").textContent = String(lab.logs.length);
  }

  function renderLab() {
    const queued = lab.tasks.filter((task) => task.status === "queued").length;
    const challenged = lab.tasks.filter((task) => task.status === "challenge").length;
    $("#labState").textContent = lab.state;
    $("#labTick").textContent = `Tick ${lab.tick}`;
    $("#labQueued").textContent = String(queued);
    $("#labChallenges").textContent = String(challenged);
    $("#labOrders").textContent = String(lab.orderCount);
    $("#labRejected").textContent = String(lab.rejected);
    $("#queueTabCount").textContent = String(lab.tasks.filter((task) => ["queued", "admitted"].includes(task.status)).length);
    $("#challengeTabCount").textContent = String(lab.tasks.filter((task) => task.challenge !== "none").length);
    $("#checkoutTabCount").textContent = String(lab.tasks.filter((task) => ["checkout", "success", "failed"].includes(task.status)).length);
    renderTasks();
    renderQueue();
    renderChallenges();
    renderOrders();
    renderLogs();
  }

  $$(".lab-tab").forEach((button) => button.addEventListener("click", () => {
    $$(".lab-tab").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    $$("[data-lab-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.labPanel === button.dataset.labTab));
  }));
  $("#startLab").addEventListener("click", startLab);
  $("#resetLab").addEventListener("click", resetLab);
  $("#clearLogs").addEventListener("click", () => { lab.logs = []; renderLogs(); });
  $("#queueMode").addEventListener("change", () => { if (lab.state !== "running") resetLab(); });
  $("#duplicateToggle").addEventListener("change", () => { if (lab.state !== "running") resetLab(); });

  resetLab();
})();
