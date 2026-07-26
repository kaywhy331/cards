const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#modal");

const state = {
  health: null,
  me: null,
  catalog: null,
  rules: [],
  events: [],
  observations: [],
  aliases: [],
  devices: [],
  membership: null,
  invites: [],
  users: [],
  integrations: null,
  verification: null,
  view: "dashboard",
  loading: false,
};

const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char]));

function formatDate(value, options = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: options.dateOnly ? undefined : "short" }).format(date);
}

function relativeTime(value) {
  if (!value) return "—";
  const delta = Date.now() - new Date(value).getTime();
  const units = [
    [86_400_000, "day"], [3_600_000, "hour"], [60_000, "minute"], [1000, "second"],
  ];
  for (const [size, name] of units) {
    if (Math.abs(delta) >= size) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.round(delta / size), name);
  }
  return "just now";
}

let toastTimer;
function notify(message, type = "success") {
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function hashRoute() {
  const raw = location.hash.slice(1);
  const [route, query = ""] = raw.split("?", 2);
  return { route: route || "dashboard", params: new URLSearchParams(query) };
}

function setRoute(view) {
  state.view = view;
  history.replaceState(null, "", `#${view}`);
  renderShell();
  if (["admin", "signals", "devices", "membership"].includes(view)) refreshView(view).catch(handleError);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleError(error) {
  console.error(error);
  notify(error.message || "Something went wrong.", "error");
}

function initials(name) {
  return String(name || "EZ").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function statusChip(status) {
  const normalized = String(status || "unknown").toUpperCase();
  const color = ["LIVE", "ACTIVE", "READY", "PROCESSED", "CONNECTED", "BETA", "SANDBOX"].includes(normalized)
    ? "" : ["SCHEDULED", "PENDING", "RECEIVED", "PROCESSING"].includes(normalized)
      ? "blue" : ["REVIEW", "PAST_DUE", "EXPIRED"].includes(normalized)
        ? "orange" : ["ENDED", "FAILED", "CANCELED", "CANCELLED", "REVOKED"].includes(normalized)
          ? "red" : "gray";
  return `<span class="status-chip ${color}"><i></i>${escapeHTML(normalized.replaceAll("_", " "))}</span>`;
}

function renderAuthVisual() {
  return `
    <section class="auth-visual">
      <div class="auth-copy">
        <span class="eyebrow">Signal-to-browser control plane</span>
        <h1>Know the drop.<br><em>Act on the right one.</em></h1>
        <p>EZ Cards converts noisy community messages into canonical TCG events, matches them to collector preferences, and hands a signed local demonstration job to the correct browser.</p>
        <div class="auth-points">
          <article class="auth-point"><strong>Dynamic intake</strong><small>Telegram messages, edited posts, links, and duplicate confirmations.</small></article>
          <article class="auth-point"><strong>Personal rules</strong><small>Game, release, product type, vendor, event type, and exclusions.</small></article>
          <article class="auth-point"><strong>Human handoff</strong><small>Localized queue lab and manual verification or checkout.</small></article>
        </div>
      </div>
    </section>`;
}

function renderSetup() {
  app.innerHTML = `<main class="auth-shell">${renderAuthVisual()}
    <section class="auth-panel-wrap">
      <div class="auth-panel card">
        <span class="panel-kicker">One-time setup</span>
        <h2>Create the owner account</h2>
        <p>The repository stores only a hash of the setup token. Redeeming it initializes the persistent invite-only membership database.</p>
        <form id="setupForm" class="auth-form">
          <div class="form-field"><label for="setupToken">Owner setup token</label><input class="input" id="setupToken" name="token" autocomplete="off" required /></div>
          <div class="form-field"><label for="setupName">Name</label><input class="input" id="setupName" name="name" autocomplete="name" required /></div>
          <div class="form-field"><label for="setupEmail">Email</label><input class="input" id="setupEmail" name="email" type="email" autocomplete="email" required /></div>
          <div class="form-field"><label for="setupPassword">Password</label><input class="input" id="setupPassword" name="password" type="password" minlength="10" autocomplete="new-password" required /><small class="help">At least 10 characters. Passwords are scrypt-hashed server-side.</small></div>
          <button class="primary-button full" type="submit">Initialize EZ Cards</button>
        </form>
        <div class="security-note">The setup token is single-use. After owner creation, only owner-generated invitations can create accounts.</div>
      </div>
    </section></main>`;
  document.querySelector("#setupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api("/bootstrap", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      state.me = { authenticated: true, user: payload.user, entitlements: payload.entitlements };
      notify("Owner account created. The invite-only workspace is ready.");
      await loadAuthenticatedApp();
    } catch (error) { handleError(error); }
  });
}

function renderLogin(mode = "login") {
  const route = hashRoute();
  const inviteCode = route.params.get("invite") || "";
  const registering = mode === "register" || route.route === "register";
  app.innerHTML = `<main class="auth-shell">${renderAuthVisual()}
    <section class="auth-panel-wrap">
      <div class="auth-panel card">
        <span class="panel-kicker">Invite-only membership</span>
        <h2>${registering ? "Accept your invitation" : "Welcome back"}</h2>
        <p>${registering ? "Create a member account using an invitation issued by the workspace owner." : "Sign in to manage watch rules, signals, devices, and membership."}</p>
        <form id="authForm" class="auth-form">
          ${registering ? `<div class="form-field"><label for="inviteCode">Invitation code</label><input class="input" id="inviteCode" name="code" value="${escapeHTML(inviteCode)}" required /></div><div class="form-field"><label for="authName">Name</label><input class="input" id="authName" name="name" autocomplete="name" required /></div>` : ""}
          <div class="form-field"><label for="authEmail">Email</label><input class="input" id="authEmail" name="email" type="email" autocomplete="email" required /></div>
          <div class="form-field"><label for="authPassword">Password</label><input class="input" id="authPassword" name="password" type="password" minlength="10" autocomplete="${registering ? "new-password" : "current-password"}" required /></div>
          <button class="primary-button full" type="submit">${registering ? "Create member account" : "Sign in"}</button>
        </form>
        <div class="auth-switch">${registering ? "Already a member?" : "Received an invite?"} <button id="authSwitch">${registering ? "Sign in" : "Register"}</button></div>
      </div>
    </section></main>`;
  document.querySelector("#authSwitch").addEventListener("click", () => {
    history.replaceState(null, "", registering ? "#login" : "#register");
    renderLogin(registering ? "login" : "register");
  });
  document.querySelector("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const payload = await api(registering ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(data) });
      state.me = { authenticated: true, user: payload.user, entitlements: payload.entitlements };
      history.replaceState(null, "", "#dashboard");
      notify(registering ? "Account created. Welcome to EZ Cards." : "Signed in successfully.");
      await loadAuthenticatedApp();
    } catch (error) { handleError(error); }
  });
}

async function loadAuthenticatedApp() {
  const [catalog, rules, signals, devices, membership] = await Promise.all([
    api("/catalog"), api("/rules"), api("/signals"), api("/devices"), api("/membership"),
  ]);
  state.catalog = catalog;
  state.rules = rules.rules;
  state.events = signals.events;
  state.observations = signals.observations;
  state.devices = devices.devices;
  state.membership = membership;
  state.integrations = membership.integrations;
  if (["owner", "admin", "curator"].includes(state.me.user.role)) state.aliases = (await api("/aliases")).aliases;
  state.view = ["dashboard", "signals", "rules", "devices", "membership", "admin", "lab"].includes(hashRoute().route) ? hashRoute().route : "dashboard";
  renderShell();
  if (state.view === "admin") await refreshAdmin();
}

function renderShell() {
  const user = state.me.user;
  const isAdmin = ["owner", "admin"].includes(user.role);
  app.innerHTML = `<div class="app-shell">
    <header class="topbar">
      <button class="brand" data-nav="dashboard" aria-label="EZ Cards dashboard">
        <span class="brand-mark">EZ</span><span><strong>EZ Cards</strong><small>TCG intelligence</small></span>
      </button>
      <nav class="main-nav" aria-label="Application navigation">
        ${navButton("dashboard", "Overview")}${navButton("signals", "Signals")}${navButton("rules", "Watch rules")}${navButton("devices", "Devices")}${navButton("membership", "Membership")}${isAdmin ? navButton("admin", "Admin") : ""}${navButton("lab", "AIO Lab")}
      </nav>
      <div class="top-actions">
        <a class="icon-button" href="/downloads/ezcards-extension.zip" download>Extension</a>
        <div class="user-chip"><span class="user-avatar">${escapeHTML(initials(user.name))}</span><span><strong>${escapeHTML(user.name)}</strong><small>${escapeHTML(user.role)} · ${escapeHTML(user.planId)}</small></span></div>
        <button class="icon-button" id="logoutButton">Sign out</button>
      </div>
    </header>
    <main class="app-main"><section id="viewRoot" class="view">${renderView()}</section></main>
  </div>`;
  bindShellEvents();
  bindViewEvents();
}

function navButton(view, label) {
  return `<button class="nav-button ${state.view === view ? "active" : ""}" data-nav="${view}">${label}</button>`;
}

function bindShellEvents() {
  document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.nav)));
  document.querySelector("#logoutButton")?.addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      state.me = null;
      history.replaceState(null, "", "#login");
      renderLogin("login");
    } catch (error) { handleError(error); }
  });
}

function renderView() {
  if (state.view === "signals") return renderSignals();
  if (state.view === "rules") return renderRules();
  if (state.view === "devices") return renderDevices();
  if (state.view === "membership") return renderMembership();
  if (state.view === "admin") return renderAdmin();
  if (state.view === "lab") return renderLabLaunch();
  return renderDashboard();
}

function renderDashboard() {
  const live = state.events.filter((event) => event.status === "LIVE").length;
  const reviews = state.events.filter((event) => event.status === "REVIEW").length;
  const paired = state.devices.filter((device) => !device.revokedAt).length;
  const recent = state.events.slice(0, 5);
  return `<div class="page-heading"><div><span class="eyebrow">Personal control plane</span><h1>Collector overview</h1><p>Shared drop intelligence is filtered through your rules and delivered only to your paired devices.</p></div><div class="heading-actions"><button class="secondary-button" data-action="refresh">Refresh</button><button class="primary-button" data-nav="signals">Review signals</button></div></div>
    <div class="metric-grid">
      <article class="metric"><span>Canonical events</span><strong>${state.events.length}</strong><small>Duplicate observations merged</small></article>
      <article class="metric good"><span>Live events</span><strong>${live}</strong><small>Current signal window</small></article>
      <article class="metric ${reviews ? "warn" : ""}"><span>Needs review</span><strong>${reviews}</strong><small>Low-confidence intake</small></article>
      <article class="metric good"><span>Paired devices</span><strong>${paired}</strong><small>${paired ? "Ready for local jobs" : "Pair the extension"}</small></article>
    </div>
    <div class="dashboard-grid">
      <div class="stack">
        <section class="card hero-card">
          <span class="panel-kicker">Verified workflow</span><h2>One event, one personalized execution plan.</h2>
          <p>Telegram posts are observations. Short links are resolved, products are classified, duplicate confirmations are merged, and your highest-priority matching rule determines the action.</p>
          <div class="workflow">
            <article class="workflow-row"><span class="workflow-icon">T</span><div><strong>Signal observation</strong><small>Raw post, source identity, URLs, and edit history</small></div>${statusChip("received")}</article>
            <article class="workflow-row"><span class="workflow-icon">↗</span><div><strong>Classification worker</strong><small>Game, collection, product type, vendor, and event intent</small></div>${statusChip("processed")}</article>
            <article class="workflow-row"><span class="workflow-icon">2→1</span><div><strong>Canonical event</strong><small>Repeated posts increase confidence without creating another job</small></div>${statusChip("active")}</article>
            <article class="workflow-row"><span class="workflow-icon">✓</span><div><strong>Device-bound handoff</strong><small>Signed job opens only the localized educational retailer lab</small></div>${statusChip(paired ? "ready" : "pending")}</article>
          </div>
          <div class="hero-actions"><button class="primary-button" data-nav="devices">Pair a device</button><a class="secondary-button" href="/local-retailer">Open retailer replica</a><a class="secondary-button" href="/lab.html">Open AIO lab</a></div>
        </section>
        <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Recent intelligence</span><h2>Matching drop feed</h2></div><button class="text-button" data-nav="signals">View all →</button></div>${recent.length ? `<div class="event-list">${recent.map(renderEventRow).join("")}</div>` : empty("No events have been ingested yet.")}</section>
      </div>
      <aside class="stack">
        <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Your configuration</span><h2>Readiness</h2></div>${statusChip(state.me.entitlements.active ? "active" : "inactive")}</div>
          <div class="integration-list">
            ${integrationRow("Membership", `${state.me.user.planId} · ${state.me.entitlements.subscriptionStatus}`)}
            ${integrationRow("Watch rules", `${state.rules.length}/${state.me.entitlements.maxRules}`)}
            ${integrationRow("Browser extension", paired ? "Paired" : "Not paired")}
            ${integrationRow("Telegram intake", state.integrations?.telegram?.configured ? `@${state.integrations.telegram.botUsername}` : "Ready to configure")}
            ${integrationRow("Stripe", state.integrations?.stripe?.configured ? `${state.integrations.stripe.mode} mode` : "Sandbox mode")}
          </div>
        </section>
        <section class="card card-pad"><span class="panel-kicker">Current watch logic</span><h2>${escapeHTML(state.rules[0]?.name || "No watch rule")}</h2><p>${state.rules[0] ? `${state.rules[0].gameIds.join(" or ") || "any game"} · ${state.rules[0].productTypeIds.join(" or ") || "any product"} · ${state.rules[0].vendorIds.join(" or ") || "any vendor"}` : "Create a watch rule to personalize your event feed."}</p><button class="secondary-button full" data-nav="rules">Manage rules</button></section>
      </aside>
    </div>`;
}

function integrationRow(label, value) {
  return `<div class="integration-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
}

function renderEventRow(event) {
  return `<article class="event-row"><div><strong>${escapeHTML(event.productName || "Unclassified product")}</strong><small>${escapeHTML(event.gameId || "unknown game")} · ${escapeHTML(event.productTypeId || "unknown type")} · ${relativeTime(event.lastSeenAt)}</small></div><div><strong>${escapeHTML(event.vendorId || "unknown vendor")}</strong><small>${escapeHTML(event.eventType.replaceAll("_", " "))}</small></div><div><strong>${Math.round((event.confidence || 0) * 100)}% confidence</strong><small>${event.observationCount || 1} observation${event.observationCount === 1 ? "" : "s"}</small></div>${statusChip(event.status)}</article>`;
}

function renderSignals() {
  const canCurate = ["owner", "admin", "curator"].includes(state.me.user.role);
  return `<div class="page-heading"><div><span class="eyebrow">Central intelligence</span><h1>Signal intake</h1><p>Each source message is retained as evidence and attached to one canonical event after classification and deduplication.</p></div><div class="heading-actions"><button class="secondary-button" data-action="refresh-signals">Refresh</button>${canCurate ? '<button class="primary-button" data-action="fixture-signal">Load screenshot fixture</button>' : ""}</div></div>
    <div class="signal-layout">
      ${canCurate ? `<aside class="stack sidebar-card"><section class="card card-pad"><span class="panel-kicker">Manual or test intake</span><h2>Submit observation</h2><form id="signalForm" class="auth-form"><div class="form-field"><label>Source</label><select class="input" name="source"><option value="manual">Manual</option><option value="telegram">Telegram fixture</option><option value="x">X source</option><option value="calendar">Release calendar</option></select></div><div class="form-field"><label>Message text</label><textarea class="input" name="text" required placeholder="Pitch Black ETB back up at Target…"></textarea></div><div class="form-field"><label>URLs</label><textarea class="input" name="links" placeholder="One URL per line"></textarea><small class="help">The backend resolves each link once, records its redirect chain, and blocks private-network destinations.</small></div><button class="primary-button full" type="submit">Ingest signal</button></form></section><section class="card card-pad"><span class="panel-kicker">Learned aliases</span><h2>Teach the classifier</h2><form id="aliasForm" class="auth-form"><div class="form-field"><label>Observed phrase</label><input class="input" name="phrase" placeholder="pb etb" required /></div><div class="form-grid"><div class="form-field"><label>Field</label><select class="input" name="field"><option value="collectionId">Collection</option><option value="productTypeId">Product type</option><option value="gameId">Game</option><option value="vendorId">Vendor</option><option value="eventType">Event intent</option></select></div><div class="form-field"><label>Canonical value</label><input class="input" name="value" placeholder="pitch-black" required /></div></div><button class="secondary-button full" type="submit">Add alias</button></form><div class="alias-list">${state.aliases.slice(0,6).map((alias) => `<div class="integration-row"><span>${escapeHTML(alias.phrase)} → ${escapeHTML(alias.field)}</span><strong>${escapeHTML(alias.value)} <button class="text-button" data-delete-alias="${alias.id}">×</button></strong></div>`).join("") || '<p class="help">No learned aliases yet.</p>'}</div></section></aside>` : ""}
      <section class="card card-pad"><div class="tabs"><button class="tab active" data-signal-tab="events">Canonical events (${state.events.length})</button>${canCurate ? `<button class="tab" data-signal-tab="observations">Observations (${state.observations.length})</button>` : ""}</div><div id="signalPanel">${renderEventTable()}</div></section>
    </div>`;
}

function renderEventTable() {
  if (!state.events.length) return empty("No canonical events yet. Submit a fixture or connect Telegram from Admin.");
  return `<div class="signal-table"><div class="signal-head"><span>Event</span><span>Classification</span><span>Vendor</span><span>Evidence</span><span>Status</span></div>${state.events.map((event) => `<article class="signal-row"><div><strong>${escapeHTML(event.productName || "Unclassified product")}</strong><small>${relativeTime(event.lastSeenAt)} · ${event.id}</small></div><div><strong>${escapeHTML(event.gameId || "unknown")} / ${escapeHTML(event.productTypeId || "unknown")}</strong><small>${escapeHTML(event.eventType)}</small></div><div><strong>${escapeHTML(event.vendorId || "unknown")}</strong><small>${event.vendorSku ? `SKU ${escapeHTML(event.vendorSku)}` : "No canonical SKU"}</small></div><div><strong>${event.observationCount || 1} post${event.observationCount === 1 ? "" : "s"}</strong><small>${Math.round((event.confidence || 0) * 100)}% confidence</small></div><div>${statusChip(event.status)}${["owner", "admin", "curator"].includes(state.me.user.role) ? `<button class="text-button" data-review-event="${event.id}">Review</button>` : ""}</div></article>`).join("")}</div>`;
}

function renderObservationTable() {
  if (!state.observations.length) return empty("No raw observations are available.");
  return `<div class="signal-table"><div class="signal-head"><span>Observation</span><span>Source</span><span>Event</span><span>Links</span><span>Status</span></div>${state.observations.map((observation) => `<article class="signal-row"><div><strong>${escapeHTML(observation.text.slice(0, 100))}</strong><small>${relativeTime(observation.receivedAt)} · ${escapeHTML(observation.id)}</small></div><div><strong>${escapeHTML(observation.source)}</strong><small>${escapeHTML(observation.sourceId || "no source id")}</small></div><div><strong>${escapeHTML(observation.eventId || "pending")}</strong><small>${escapeHTML(observation.classification?.eventType || "not classified")}</small></div><div><strong>${observation.links?.length || 0}</strong><small>${observation.resolvedLinks?.filter((link) => link.vendorId).length || 0} merchant</small></div>${statusChip(observation.status)}</article>`).join("")}</div>`;
}

function renderRules() {
  const catalog = state.catalog;
  return `<div class="page-heading"><div><span class="eyebrow">Personal matching</span><h1>Watch rules</h1><p>AND across categories, OR within a category. Empty categories act as wildcards and exclusions always override inclusions.</p></div><button class="primary-button" data-action="new-rule">New rule</button></div>
    <div class="two-column"><section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Active preferences</span><h2>${state.rules.length} rule${state.rules.length === 1 ? "" : "s"}</h2></div><span class="mini-chip gray">Limit ${state.me.entitlements.maxRules}</span></div>${state.rules.length ? `<div class="rule-list">${state.rules.map((rule) => `<article class="rule-row"><div><strong>${escapeHTML(rule.name)}</strong><small>${escapeHTML(rule.action.replaceAll("_", " "))} · Priority ${rule.priority}</small></div><div class="rule-tags">${[...rule.gameIds, ...rule.productTypeIds, ...rule.vendorIds].slice(0, 8).map((tag) => `<span class="entity-tag">${escapeHTML(tag)}</span>`).join("")}</div><div>${statusChip(rule.enabled ? "active" : "disabled")}</div><div><button class="text-button" data-toggle-rule="${rule.id}">${rule.enabled ? "Disable" : "Enable"}</button><button class="text-button" data-delete-rule="${rule.id}">Delete</button></div></article>`).join("")}</div>` : empty("No rules yet. Create one to personalize drop matching.")}</section>
      <aside class="card card-pad sidebar-card"><span class="panel-kicker">Available taxonomy</span><h2>Current catalog</h2><div class="integration-list">${integrationRow("Games", catalog.games.length)}${integrationRow("Collections", catalog.collections.length)}${integrationRow("Product types", catalog.productTypes.length)}${integrationRow("Vendors", catalog.vendors.length)}</div><p>Catalog aliases allow messages like “ETB,” “pre sale,” “back up,” and set shorthand to resolve into stable IDs.</p></aside></div>`;
}

function ruleFormTemplate() {
  const choices = (name, items) => `<div class="choice-grid" data-choice-group="${name}">${items.map((item) => `<button type="button" class="choice" data-choice-value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</button>`).join("")}</div>`;
  return `<div class="modal-inner"><div class="modal-head"><div><span class="panel-kicker">New watch rule</span><h2>Choose what should match</h2></div><button class="modal-close" data-close-modal>×</button></div><form id="ruleForm" class="auth-form"><div class="form-field"><label>Rule name</label><input class="input" name="name" value="Premium TCG products" required /></div><div class="form-field"><label>Games</label>${choices("gameIds", state.catalog.games)}</div><div class="form-field"><label>Collections or sets</label>${choices("collectionIds", state.catalog.collections)}</div><div class="form-field"><label>Product types</label>${choices("productTypeIds", state.catalog.productTypes)}</div><div class="form-field"><label>Vendors</label>${choices("vendorIds", state.catalog.vendors)}</div><div class="form-field"><label>Event types</label>${choices("eventTypes", [
    { id: "live_restock", name: "Live restock" }, { id: "scheduled_drop", name: "Scheduled drop" }, { id: "presale_open", name: "Presale" }, { id: "preorder_deadline", name: "Deadline" }, { id: "announcement", name: "Announcement" },
  ])}</div><div class="form-grid"><div class="form-field"><label>Action</label><select class="input" name="action"><option value="queue_assist">Queue assist demo</option><option value="open_page">Open localized page</option><option value="notify_only">Notify only</option></select></div><div class="form-field"><label>Priority</label><input class="input" name="priority" type="number" min="0" max="1000" value="100" /></div></div><button class="primary-button full" type="submit">Create rule</button></form></div>`;
}

function renderDevices() {
  return `<div class="page-heading"><div><span class="eyebrow">Local execution agent</span><h1>Paired devices</h1><p>The extension authenticates with a device token, verifies signed jobs locally, and can open only the EZ Cards localized retailer lab.</p></div><div class="heading-actions"><a class="secondary-button" href="/downloads/ezcards-extension.zip" download>Download extension</a><button class="primary-button" data-action="pair-device">Pair extension</button></div></div>
    <div class="two-column"><section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Registered installations</span><h2>${state.devices.length} device${state.devices.length === 1 ? "" : "s"}</h2></div>${statusChip(state.devices.some((device) => !device.revokedAt) ? "connected" : "pending")}</div>${state.devices.length ? `<div class="device-list">${state.devices.map((device) => `<article class="device-row"><div><strong>${escapeHTML(device.name)}</strong><small>${escapeHTML(device.browser)} · ${escapeHTML(device.platform)} · v${escapeHTML(device.extensionVersion)}</small></div><div><strong>${device.lastSeenAt ? relativeTime(device.lastSeenAt) : "Never"}</strong><small>Last heartbeat</small></div><div>${statusChip(device.revokedAt ? "revoked" : "active")}</div><div>${device.revokedAt ? "" : `<button class="text-button" data-revoke-device="${device.id}">Revoke</button>`}</div></article>`).join("")}</div>` : empty("No extension is paired. Download it, load it in Chrome or Edge, and enter a generated code.")}</section>
      <aside class="stack"><section class="card card-pad"><span class="panel-kicker">End-to-end test</span><h2>Send a local demo job</h2><p>The extension will verify the HMAC signature and open <code>/local-retailer</code>. It never opens an external retailer in this educational build.</p><button class="primary-button full" data-action="demo-job" ${state.devices.some((device) => !device.revokedAt) ? "" : "disabled"}>Send test job</button></section><section class="card card-pad"><span class="panel-kicker">Install unpacked</span><h2>Chrome / Edge</h2><ol class="help"><li>Download and unzip the extension.</li><li>Open the browser extensions page.</li><li>Enable Developer mode.</li><li>Choose Load unpacked and select the folder.</li><li>Generate a pairing code here and enter it in the popup.</li></ol></section></aside></div>`;
}

function renderMembership() {
  const current = state.membership?.user || state.me.user;
  const entitlements = state.membership?.entitlements || state.me.entitlements;
  const stripeReady = state.integrations?.stripe?.configured;
  return `<div class="page-heading"><div><span class="eyebrow">Entitlements and billing</span><h1>Membership</h1><p>The invite-only beta is fully functional without payment. Stripe Checkout can be connected from Admin before paid launch.</p></div>${statusChip(entitlements.subscriptionStatus)}</div>
    <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Current access</span><h2>${escapeHTML(entitlements.name)}</h2></div><span class="mini-chip gray">${escapeHTML(current.email)}</span></div><div class="metric-grid"><article class="metric"><span>Watch rules</span><strong>${entitlements.maxRules}</strong><small>Maximum active rules</small></article><article class="metric"><span>Devices</span><strong>${entitlements.maxDevices}</strong><small>Paired installations</small></article><article class="metric"><span>Family seats</span><strong>${entitlements.familySeats}</strong><small>Membership seats</small></article><article class="metric good"><span>Queue assist</span><strong>${entitlements.queueAssist ? "On" : "Off"}</strong><small>Localized lab handoff</small></article></div></section>
    <div class="plan-grid" style="margin-top:15px">
      ${planCard("beta", "Beta", "$0", ["Invite-only access", "25 watch rules", "2 devices", "Telegram and local lab"], current.planId === "beta", false)}
      ${planCard("individual", "Individual", "Stripe", ["50 watch rules", "2 devices", "Personalized signals", "Paid-launch entitlement"], current.planId === "individual", true)}
      ${planCard("family", "Family", "Stripe", ["100 watch rules", "10 devices", "Up to 6 seats", "Shared family workspace"], current.planId === "family", true)}
    </div>
    <section class="card card-pad" style="margin-top:15px"><div class="panel-head"><div><span class="panel-kicker">Billing adapter</span><h2>${stripeReady ? `Stripe ${escapeHTML(state.integrations.stripe.mode)} mode connected` : "Stripe is not configured"}</h2></div>${statusChip(stripeReady ? "connected" : "sandbox")}</div><p>${stripeReady ? "Paid buttons create a Stripe-hosted subscription Checkout Session. Subscription webhooks update entitlements asynchronously." : "Use sandbox activation to test every entitlement path. The owner can add Stripe test keys, Price IDs, and the webhook signing secret from Admin."}</p>${stripeReady && current.stripeCustomerId ? '<button class="secondary-button" data-action="billing-portal">Manage billing in Stripe</button>' : ""}</section>`;
}

function planCard(id, name, price, features, selected, paid) {
  const stripeReady = state.integrations?.stripe?.configured;
  const sandboxAllowed = !stripeReady || ["owner", "admin"].includes(state.me.user.role);
  const action = selected
    ? '<button class="secondary-button full" disabled>Current membership</button>'
    : paid && stripeReady
      ? `<button class="primary-button full" data-checkout-plan="${id}">Start Stripe Checkout</button>`
      : sandboxAllowed
        ? `<button class="secondary-button full" data-sandbox-plan="${id}">Activate in sandbox</button>`
        : '<button class="secondary-button full" disabled>Billing required</button>';
  return `<article class="plan-card ${selected ? "recommended" : ""}"><span class="panel-kicker">${selected ? "Current plan" : paid ? "Paid launch" : "Invite-only"}</span><h3>${name}</h3><div class="price">${price}</div><ul>${features.map((feature) => `<li>${escapeHTML(feature)}</li>`).join("")}</ul>${action}</article>`;
}

function renderAdmin() {
  if (!["owner", "admin"].includes(state.me.user.role)) return empty("Administrator access is required.");
  const owner = state.me.user.role === "owner";
  return `<div class="page-heading"><div><span class="eyebrow">Operations console</span><h1>Administration</h1><p>Manage invitations, integrations, member status, and full-scope verification from one place.</p></div><button class="primary-button" data-action="run-verification">Run completion verification</button></div>
    <div class="admin-grid">
      <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Invite-only access</span><h2>Create invitation</h2></div>${statusChip("active")}</div><form id="inviteForm" class="auth-form"><div class="form-grid"><div class="form-field"><label>Email (optional)</label><input class="input" type="email" name="email" /></div><div class="form-field"><label>Role</label><select class="input" name="role"><option value="member">Member</option><option value="curator">Curator</option><option value="admin">Admin</option></select></div><div class="form-field"><label>Plan</label><select class="input" name="planId"><option value="beta">Beta</option><option value="individual">Individual</option><option value="family">Family</option></select></div><div class="form-field"><label>Expires in hours</label><input class="input" type="number" name="expiresHours" value="72" min="1" max="720" /></div></div><button class="primary-button full" type="submit">Generate invite link</button></form></section>
      <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Telegram Bot API</span><h2>${state.integrations?.telegram?.configured ? `@${escapeHTML(state.integrations.telegram.botUsername)}` : "Connect intake bot"}</h2></div>${statusChip(state.integrations?.telegram?.configured ? "connected" : "pending")}</div>${owner ? `<form id="telegramForm" class="auth-form"><div class="form-field"><label>Bot token</label><input class="input" type="password" name="botToken" placeholder="123456:ABC…" required /><small class="help">Used once to call getMe and setWebhook. The bot token is not retained; only the generated webhook verification secret is stored server-side.</small></div><button class="secondary-button full" type="submit">Configure Telegram webhook</button></form>` : '<p>Only the workspace owner can change integration secrets.</p>'}</section>
      <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">X source enrichment</span><h2>${state.integrations?.x?.configured ? "Bearer token connected" : "Resolve links inside X posts"}</h2></div>${statusChip(state.integrations?.x?.configured ? "connected" : "optional")}</div>${owner ? `<form id="xForm" class="auth-form"><div class="form-field"><label>X API bearer token</label><input class="input" type="password" name="bearerToken" placeholder="AAAA…" required /><small class="help">Stored encrypted server-side. Used only to read structured post text and outbound URL entities when Telegram contains an X status link without a direct merchant link.</small></div><button class="secondary-button full" type="submit">Save X enrichment token</button></form>` : '<p>Only the workspace owner can change integration secrets.</p>'}</section>
      <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Stripe subscriptions</span><h2>${state.integrations?.stripe?.configured ? `${escapeHTML(state.integrations.stripe.mode)} mode` : "Configure paid launch"}</h2></div>${statusChip(state.integrations?.stripe?.configured ? "connected" : "sandbox")}</div>${owner ? `<form id="stripeForm" class="auth-form"><div class="form-field"><label>Secret key</label><input class="input" type="password" name="secretKey" placeholder="sk_test_…" required /></div><div class="form-field"><label>Webhook signing secret</label><input class="input" type="password" name="webhookSecret" placeholder="whsec_…" required /><small class="help">Register ${location.origin}/api/stripe-webhook in Stripe Workbench.</small></div><div class="form-grid"><div class="form-field"><label>Individual Price ID</label><input class="input" name="individualPriceId" placeholder="price_…" required /></div><div class="form-field"><label>Family Price ID</label><input class="input" name="familyPriceId" placeholder="price_…" required /></div></div><button class="secondary-button full" type="submit">Save Stripe configuration</button></form>` : '<p>Only the workspace owner can change integration secrets.</p>'}</section>
      <section class="card card-pad"><div class="panel-head"><div><span class="panel-kicker">Member directory</span><h2>${state.users.length} members</h2></div></div>${state.users.length ? `<div class="user-list">${state.users.slice(0, 20).map((user) => `<article class="user-row admin-user-row"><div><strong>${escapeHTML(user.name)}</strong><small>${escapeHTML(user.email)}</small></div><label><small>Role</small><select class="input compact-input" data-user-role="${user.id}"><option value="member" ${user.role === "member" ? "selected" : ""}>Member</option><option value="curator" ${user.role === "curator" ? "selected" : ""}>Curator</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option><option value="owner" ${user.role === "owner" ? "selected" : ""}>Owner</option></select></label><label><small>Plan</small><select class="input compact-input" data-user-plan="${user.id}"><option value="beta" ${user.planId === "beta" ? "selected" : ""}>Beta</option><option value="individual" ${user.planId === "individual" ? "selected" : ""}>Individual</option><option value="family" ${user.planId === "family" ? "selected" : ""}>Family</option></select></label><label><small>Status</small><select class="input compact-input" data-user-status="${user.id}"><option value="active" ${user.status === "active" ? "selected" : ""}>Active</option><option value="suspended" ${user.status === "suspended" ? "selected" : ""}>Suspended</option></select></label><button class="text-button" data-save-user="${user.id}">Save</button></article>`).join("")}</div>` : empty("Loading users…")}</section>
      <section class="card card-pad wide"><div class="panel-head"><div><span class="panel-kicker">Recent invitations</span><h2>${state.invites.length} invitations</h2></div></div>${state.invites.length ? `<div class="invite-list">${state.invites.slice(0, 12).map((invite) => `<article class="invite-row"><div><strong>${escapeHTML(invite.email || "Open invitation")}</strong><small>Expires ${formatDate(invite.expiresAt)}</small></div><div><strong>${escapeHTML(invite.role)}</strong><small>Role</small></div><div><strong>${invite.uses}/${invite.maxUses}</strong><small>Uses</small></div>${statusChip(invite.expired ? "expired" : "active")}</article>`).join("")}</div>` : empty("No invitations have been generated.")}</section>
      ${state.verification ? `<section class="card card-pad wide"><div class="panel-head"><div><span class="panel-kicker">Completion criteria</span><h2>${state.verification.ok ? "All verification checks passed" : "Verification needs attention"}</h2></div>${statusChip(state.verification.ok ? "active" : "failed")}</div><div class="verification-list">${state.verification.checks.map((check) => `<article class="verification-row"><span class="check-icon ${check.pass ? "" : "fail"}">${check.pass ? "✓" : "!"}</span><div><strong>${escapeHTML(check.name)}</strong><small>${escapeHTML(check.detail)}</small></div>${statusChip(check.pass ? "passed" : "failed")}</article>`).join("")}</div></section>` : ""}
    </div>`;
}

function renderLabLaunch() {
  return `<div class="page-heading"><div><span class="eyebrow">Owned educational environment</span><h1>AIO simulation lab</h1><p>Use synthetic accounts, queue tokens, mock verification, fake inventory, and idempotent sandbox orders against URLs owned by this project.</p></div><span class="status-chip"><i></i>Isolated</span></div>
    <div class="dashboard-grid"><section class="card hero-card"><span class="panel-kicker">AIO workflow simulator</span><h2>Task groups, waiting rooms, challenges, and checkout—without touching a retailer.</h2><p>The standalone lab supports randomized pre-queue and FIFO modes, duplicate-account controls, route-affinity probes, manual challenge handoff, inventory races, and fake order receipts.</p><div class="hero-actions"><a class="primary-button" href="/lab.html">Open AIO console</a><a class="secondary-button" href="/local-retailer">Open localized retailer replica</a></div></section><aside class="stack"><section class="card card-pad"><span class="panel-kicker">Hard boundary</span><h2>Allowed origins</h2><div class="code-block">https://ezcards.netlify.app/local-retailer\nhttp://localhost:8888/local-retailer</div><p>No real retailer host permissions, CAPTCHA solver, queue-token transfer, proxy provider, cookie import, payment data, or external checkout.</p></section><section class="card card-pad"><span class="panel-kicker">Extension demonstration</span><h2>Signed local handoff</h2><p>Pair the downloadable extension, then send a demo job from Devices. The extension validates the device signature before opening the replica.</p><button class="secondary-button full" data-nav="devices">Go to devices</button></section></aside></div>`;
}

function empty(message) {
  return `<div class="empty-state">${escapeHTML(message)}</div>`;
}

function showModal(content) {
  modal.innerHTML = content;
  modal.showModal();
  modal.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => modal.close()));
}

async function refreshView(view = state.view) {
  if (!state.me?.authenticated) return;
  if (view === "signals" || view === "dashboard") {
    const signals = await api("/signals");
    state.events = signals.events;
    state.observations = signals.observations;
    if (["owner", "admin", "curator"].includes(state.me.user.role)) state.aliases = (await api("/aliases")).aliases;
  }
  if (view === "rules" || view === "dashboard") state.rules = (await api("/rules")).rules;
  if (view === "devices" || view === "dashboard") state.devices = (await api("/devices")).devices;
  if (view === "membership" || view === "dashboard") {
    state.membership = await api("/membership");
    state.integrations = state.membership.integrations;
  }
  if (view === "admin") await refreshAdmin(false);
  renderShell();
}

async function refreshAdmin(render = true) {
  if (!["owner", "admin"].includes(state.me.user.role)) return;
  const requests = [api("/admin/integrations")];
  if (["owner", "admin"].includes(state.me.user.role)) requests.push(api("/invites"), api("/users"));
  const results = await Promise.all(requests);
  state.integrations = results[0].integrations;
  if (results[1]) state.invites = results[1].invites;
  if (results[2]) state.users = results[2].users;
  if (render) renderShell();
}

function bindViewEvents() {
  document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.nav)));
  document.querySelector("[data-action='refresh']")?.addEventListener("click", () => refreshView("dashboard").catch(handleError));
  document.querySelector("[data-action='refresh-signals']")?.addEventListener("click", () => refreshView("signals").catch(handleError));
  document.querySelector("[data-action='fixture-signal']")?.addEventListener("click", () => {
    const form = document.querySelector("#signalForm");
    if (!form) return;
    form.elements.source.value = "telegram";
    form.elements.text.value = "🔥 Pokémon Pitch Black ETB back up at CardForge Local Lab — still seeing success";
    form.elements.links.value = `${location.origin}/local-retailer?product=pitch-black-etb`;
  });
  document.querySelector("#signalForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/signals", { method: "POST", body: JSON.stringify({ ...data, links: String(data.links || "").split(/\r?\n/).map((link) => link.trim()).filter(Boolean) }) });
      notify("Signal accepted. Classification is continuing after the response.");
      setTimeout(() => refreshView("signals").catch(handleError), 1500);
    } catch (error) { handleError(error); }
  });
  document.querySelectorAll("[data-signal-tab]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-signal-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelector("#signalPanel").innerHTML = button.dataset.signalTab === "observations" ? renderObservationTable() : renderEventTable();
  }));
  document.querySelector("#aliasForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await api("/aliases", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); notify("Classifier alias saved."); await refreshView("signals"); } catch (error) { handleError(error); }
  });
  document.querySelectorAll("[data-delete-alias]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/aliases/${button.dataset.deleteAlias}`, { method: "DELETE" }); notify("Alias removed."); await refreshView("signals"); } catch (error) { handleError(error); }
  }));
  document.querySelectorAll("[data-review-event]").forEach((button) => button.addEventListener("click", () => {
    const event = state.events.find((item) => item.id === button.dataset.reviewEvent);
    if (!event) return;
    const option = (value, label, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
    showModal(`<div class="modal-inner"><div class="modal-head"><div><span class="panel-kicker">Curator review</span><h2>Correct canonical event</h2></div><button class="modal-close" data-close-modal>×</button></div><form id="eventReviewForm" class="auth-form"><div class="form-field"><label>Product name</label><input class="input" name="productName" value="${escapeHTML(event.productName || "")}" /></div><div class="form-grid"><div class="form-field"><label>Game ID</label><input class="input" name="gameId" value="${escapeHTML(event.gameId || "")}" /></div><div class="form-field"><label>Collection ID</label><input class="input" name="collectionId" value="${escapeHTML(event.collectionId || "")}" /></div><div class="form-field"><label>Product type ID</label><input class="input" name="productTypeId" value="${escapeHTML(event.productTypeId || "")}" /></div><div class="form-field"><label>Vendor ID</label><input class="input" name="vendorId" value="${escapeHTML(event.vendorId || "")}" /></div></div><div class="form-grid"><div class="form-field"><label>Event type</label><select class="input" name="eventType">${option("live_restock","Live restock",event.eventType)}${option("scheduled_drop","Scheduled drop",event.eventType)}${option("presale_open","Presale open",event.eventType)}${option("preorder_deadline","Preorder deadline",event.eventType)}${option("announcement","Announcement",event.eventType)}${option("status_update","Status update",event.eventType)}${option("sold_out","Sold out",event.eventType)}</select></div><div class="form-field"><label>Workflow status</label><select class="input" name="status">${option("REVIEW","Review",event.status)}${option("LIVE","Live / published",event.status)}${option("SCHEDULED","Scheduled / published",event.status)}${option("ENDED","Ended",event.status)}${option("CANCELLED","Cancelled",event.status)}</select></div></div><div class="form-field"><label>Verified action URL (optional)</label><input class="input" name="actionUrl" value="${escapeHTML(event.actionUrl || "")}" /></div><button class="primary-button full" type="submit">Save and re-run matching</button></form></div>`);
    modal.querySelector("#eventReviewForm").addEventListener("submit", async (submitEvent) => { submitEvent.preventDefault(); try { await api(`/signals/events/${event.id}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(submitEvent.currentTarget))) }); modal.close(); notify("Canonical event updated and matching re-run."); await refreshView("signals"); } catch (error) { handleError(error); } });
  }));
  document.querySelector("[data-action='new-rule']")?.addEventListener("click", () => {
    showModal(ruleFormTemplate());
    modal.querySelectorAll("[data-choice-value]").forEach((button) => button.addEventListener("click", () => button.classList.toggle("selected")));
    modal.querySelector("#ruleForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(event.currentTarget));
      modal.querySelectorAll("[data-choice-group]").forEach((group) => {
        formData[group.dataset.choiceGroup] = [...group.querySelectorAll(".selected")].map((button) => button.dataset.choiceValue);
      });
      try {
        await api("/rules", { method: "POST", body: JSON.stringify(formData) });
        modal.close();
        notify("Watch rule created.");
        await refreshView("rules");
      } catch (error) { handleError(error); }
    });
  });
  document.querySelectorAll("[data-toggle-rule]").forEach((button) => button.addEventListener("click", async () => {
    const rule = state.rules.find((item) => item.id === button.dataset.toggleRule);
    try { await api(`/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }); await refreshView("rules"); } catch (error) { handleError(error); }
  }));
  document.querySelectorAll("[data-delete-rule]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this watch rule?")) return;
    try { await api(`/rules/${button.dataset.deleteRule}`, { method: "DELETE" }); notify("Rule deleted."); await refreshView("rules"); } catch (error) { handleError(error); }
  }));
  document.querySelector("[data-action='pair-device']")?.addEventListener("click", async () => {
    try {
      const { pairing } = await api("/devices/pair", { method: "POST", body: "{}" });
      showModal(`<div class="modal-inner"><div class="modal-head"><div><span class="panel-kicker">Extension pairing</span><h2>Enter this code in the extension</h2></div><button class="modal-close" data-close-modal>×</button></div><div class="pairing-code"><strong>${escapeHTML(pairing.code)}</strong><small>Expires ${formatDate(pairing.expiresAt)}</small></div><p>Set the service URL to <code>${escapeHTML(location.origin)}</code>. The extension receives separate device authentication and signing secrets after claiming this code.</p><a class="primary-button full" href="/downloads/ezcards-extension.zip" download>Download extension</a></div>`);
      modal.querySelector("[data-close-modal]").addEventListener("click", () => modal.close());
    } catch (error) { handleError(error); }
  });
  document.querySelectorAll("[data-revoke-device]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/devices/${button.dataset.revokeDevice}/revoke`, { method: "POST", body: "{}" }); notify("Device revoked."); await refreshView("devices"); } catch (error) { handleError(error); }
  }));
  document.querySelector("[data-action='demo-job']")?.addEventListener("click", async () => {
    try { await api("/devices/demo-job", { method: "POST", body: "{}" }); notify("Signed demo job queued. Use Sync now in the extension or wait for its next poll."); } catch (error) { handleError(error); }
  });
  document.querySelectorAll("[data-sandbox-plan]").forEach((button) => button.addEventListener("click", async () => {
    try { const payload = await api("/membership/sandbox", { method: "POST", body: JSON.stringify({ planId: button.dataset.sandboxPlan }) }); state.me.user = payload.user; state.me.entitlements = payload.entitlements; notify("Sandbox membership activated."); await refreshView("membership"); } catch (error) { handleError(error); }
  }));
  document.querySelectorAll("[data-checkout-plan]").forEach((button) => button.addEventListener("click", async () => {
    try { const { checkout } = await api("/membership/checkout", { method: "POST", body: JSON.stringify({ planId: button.dataset.checkoutPlan }) }); location.href = checkout.url; } catch (error) { handleError(error); }
  }));
  document.querySelector("[data-action='billing-portal']")?.addEventListener("click", async () => {
    try { const { portal } = await api("/membership/portal", { method: "POST", body: "{}" }); location.href = portal.url; } catch (error) { handleError(error); }
  });
  document.querySelectorAll("[data-save-user]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.saveUser;
    const patch = {
      role: document.querySelector(`[data-user-role="${id}"]`)?.value,
      planId: document.querySelector(`[data-user-plan="${id}"]`)?.value,
      status: document.querySelector(`[data-user-status="${id}"]`)?.value,
    };
    try { await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); notify("Member access updated."); await refreshView("admin"); } catch (error) { handleError(error); }
  }));
  document.querySelector("#inviteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const payload = await api("/invites", { method: "POST", body: JSON.stringify(data) });
      showModal(`<div class="modal-inner"><div class="modal-head"><div><span class="panel-kicker">Invitation created</span><h2>Share this one-time link</h2></div><button class="modal-close" data-close-modal>×</button></div><div class="code-block">${escapeHTML(payload.inviteUrl)}</div><button class="primary-button full" id="copyInvite">Copy invite link</button></div>`);
      modal.querySelector("[data-close-modal]").addEventListener("click", () => modal.close());
      modal.querySelector("#copyInvite").addEventListener("click", async () => { await navigator.clipboard.writeText(payload.inviteUrl); notify("Invite link copied."); });
      await refreshAdmin(false);
    } catch (error) { handleError(error); }
  });
  document.querySelector("#telegramForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Connecting…";
    try { await api("/admin/integrations/telegram", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); notify("Telegram webhook configured."); await refreshView("admin"); } catch (error) { handleError(error); } finally { button.disabled = false; button.textContent = "Configure Telegram webhook"; }
  });
  document.querySelector("#xForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Saving…";
    try { await api("/admin/integrations/x", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); notify("X source enrichment configured."); await refreshView("admin"); } catch (error) { handleError(error); } finally { button.disabled = false; button.textContent = "Save X enrichment token"; }
  });
  document.querySelector("#stripeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Saving…";
    try { await api("/admin/integrations/stripe", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); notify("Stripe subscription adapter configured."); await refreshView("admin"); } catch (error) { handleError(error); } finally { button.disabled = false; button.textContent = "Save Stripe configuration"; }
  });
  document.querySelector("[data-action='run-verification']")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Verifying…";
    try { state.verification = await api("/system/verify", { method: "POST", body: "{}" }); notify("Completion verification passed."); renderShell(); } catch (error) { handleError(error); } finally { button.disabled = false; }
  });
}

async function init() {
  try {
    state.health = await api("/health");
    const bootstrap = await api("/bootstrap");
    if (bootstrap.setupRequired) return renderSetup();
    const me = await api("/auth/me");
    if (!me.authenticated) return renderLogin(hashRoute().route === "register" ? "register" : "login");
    state.me = me;
    await loadAuthenticatedApp();
  } catch (error) {
    app.innerHTML = `<main class="auth-shell">${renderAuthVisual()}<section class="auth-panel-wrap"><div class="auth-panel card"><span class="panel-kicker">Service unavailable</span><h2>EZ Cards could not start</h2><p>${escapeHTML(error.message)}</p><button class="primary-button full" id="retryInit">Retry</button></div></section></main>`;
    document.querySelector("#retryInit").addEventListener("click", init);
  }
}

window.addEventListener("hashchange", () => {
  if (!state.me?.authenticated) return;
  const next = hashRoute().route;
  if (["dashboard", "signals", "rules", "devices", "membership", "admin", "lab"].includes(next)) setRoute(next);
});

init();
