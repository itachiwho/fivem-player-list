// === CONFIG ===
const PLAYERS_API_URL = "http://139.162.4.173:30120/players.json";

// === STATE ===
let lastPlayers = [];
let lastMeta = { hostname: "FiveM Server", max: "?" };
let refreshInterval = 30; // seconds
let refreshCounter = refreshInterval;
let refreshTimer;

// === UTIL FUNCTIONS ===
function $$ (sel) {
  return Array.from(document.querySelectorAll(sel));
}

function $(sel) {
  return document.querySelector(sel);
}

function stripColorCodes(name = "") {
  // Remove FiveM color codes like ^1 ^2 ...
  return name.replace(/\^([0-9])/g, "").trim();
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// === FETCH HELPERS ===
async function fetchWithTimeout(url, { timeout = 7000, init = {} } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error("timeout")), timeout);
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: init.signal || controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Custom fetch to get player data from the new API
async function fetchJsonLenient(url, { timeout = 7000 } = {}) {
  const res = await fetchWithTimeout(url, {
    timeout,
    init: { headers: { Accept: "application/json" } },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error("non-JSON response");
  }
}

// Try the custom API to fetch player data
async function getServerSnapshot() {
  try {
    const j = await fetchJsonLenient(PLAYERS_API_URL, { timeout: 7000 });

    // Now we directly use the player data
    const players = j; // Players are the direct array returned from the API

    const hostname = "FiveM Server";  // Static value or pull from another source if available
    const max = players.length || "?"; // Just use player count for max players

    return { players, hostname, max, source: "custom" };
  } catch (err) {
    console.error("Error with custom fetch:", err);
    return { players: [], hostname: "FiveM Server", max: "?" }; // Empty players on failure
  }
}

// === UI HELPERS ===
function setMeta(hostname, max) {
  $("#server-title").textContent = stripColorCodes(hostname);
  $("#server-count").textContent = `(${lastPlayers.length}/${max})`;
}

function showWarning(msg) {
  const w = $("#warning");
  w.style.display = "block";
  w.textContent = msg;
}

function hideWarning() {
  const w = $("#warning");
  w.style.display = "none";
}

// === RENDER: ONLINE ===
function renderPlayers() {
  const table = $("#players-table");
  table.innerHTML = `
    <tr>
      <th>No.</th>
      <th>ID</th>
      <th>Name</th>
      <th>Role</th>
      <th>Ping</th>
    </tr>`;

  if (lastPlayers.length === 0) {
    table.innerHTML += "<tr><td colspan='5'>No players are currently online.</td></tr>";
    return; // Skip further rendering if no players
  }

  const searchVal = ($("#search").value || "").trim().toLowerCase();
  const filter = $("#shift-filter").value;

  const filtered = lastPlayers.filter((p) => {
    const clean = stripColorCodes(p?.name || "");
    if (searchVal && !clean.toLowerCase().includes(searchVal)) return false;
    if (filter !== "all") return shiftSets[filter].has(clean); // exact match only
    return true;
  });

  filtered.forEach((p, i) => {
    const clean = stripColorCodes(p?.name || "");
    // exact, case-sensitive role mapping
    let role = "-";
    for (const [shift, set] of Object.entries(shiftSets)) {
      if (set.has(clean)) { role = shift; break; }
    }
    table.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${i + 1}</td>
        <td>${p?.id ?? "-"}</td>
        <td>${escapeHtml(clean)}</td>
        <td>${role}</td>
        <td>${p?.ping ?? "-"} ms</td>
      </tr>`);
  });

  if (filtered.length === 0) {
    table.insertAdjacentHTML("beforeend", `<tr><td colspan="5">No players match your filters.</td></tr>`);
  }
}

// === RENDER: OFFLINE ===
function renderOffline() {
  const table = $("#offline-table");
  table.innerHTML = `
    <tr>
      <th>Name</th>
      <th>Role</th>
      <th>Status</th>
    </tr>`;

  // Online names set (after stripping color codes), case-sensitive comparison
  const online = new Set(lastPlayers.map((p) => stripColorCodes(p?.name || "")));

  for (const [shift, names] of Object.entries(shiftGroups)) {
    for (const name of names) {
      if (!online.has(name)) {
        table.insertAdjacentHTML("beforeend", `
          <tr class="offline">
            <td>${escapeHtml(name)}</td>
            <td>${shift}</td>
            <td>🔴 Offline</td>
          </tr>`);
      }
    }
  }
}

// === FETCH CYCLE (SWR: keep last good on screen) ===
async function loadPlayers() {
  const loader = $("#loader");
  const icon = $("#refresh-status img");

  try {
    loader.style.display = "flex";
    icon?.classList.add("spin");

    const snap = await getServerSnapshot();
    const players = snap.players.slice();

    // Stable sort: by id, then name
    players.sort((a, b) =>
      (a?.id ?? 0) - (b?.id ?? 0) ||
      String(a?.name || "").localeCompare(String(b?.name || ""))
    );

    // Update cache & UI only after success
    lastPlayers = players;
    window.lastPlayers = lastPlayers; // keep debug in sync
    lastMeta = { hostname: snap.hostname, max: snap.max };

    hideWarning();
    setMeta(lastMeta.hostname, lastMeta.max);
    renderPlayers();
    renderOffline();
  } catch (err) {
    console.error("Fetch failed:", err);
    // Keep last list; warn if we had something previously
    if (lastPlayers.length) {
      showWarning("⚠ Couldn’t update, showing last data");
      setMeta(lastMeta.hostname, lastMeta.max);
      renderPlayers();
      renderOffline();
    } else {
      $("#players-table").innerHTML = "<tr><td colspan='5'>⚠ Failed to load players.</td></tr>";
    }
  } finally {
    loader.style.display = "none";
    icon?.classList.remove("spin");
    resetRefreshTimer();
  }
}

// === Tabs ===
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// === Filters: re-render only (no refetch) ===
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
$("#search").addEventListener("input", debounce(renderPlayers, 120));
$("#shift-filter").addEventListener("change", renderPlayers);

// === Manual refresh ===
$("#refresh-status").addEventListener("click", () => loadPlayers());

// === Auto refresh (keeps cadence, no overlap) ===
function startRefreshTimer() {
  refreshCounter = refreshInterval;
  updateRefreshDisplay();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshCounter--;
    updateRefreshDisplay();
    if (refreshCounter <= 0) loadPlayers();
  }, 1000);
}
function resetRefreshTimer() { startRefreshTimer(); }
function updateRefreshDisplay() {
  const el = $("#refresh-timer");
  if (el) el.textContent = refreshCounter + "s";
}

// === Boot ===
loadPlayers();
startRefreshTimer();
