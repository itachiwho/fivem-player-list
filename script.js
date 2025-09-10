// === CONFIG ===
const serverId = "8p75gb"; // your CFX code
const VERCEL_STATUS_URL = "https://fivem-server.vercel.app/status/legacybd";
const CFX_URL = `https://servers-frontend.fivem.net/api/servers/single/${serverId}`;

const shiftGroups = {
  "Shift-1": ["SPL4SH", "6t9", "ALFYKUNNO", "Siam", "Hercules", "Sami", "hasib", "Mowaj Hossain"],
  "Shift-2": ["KiUHA", "KIBRIA", "iramf", "Mr Fraud", "ITACHI", "💤", "mihad", "pc"],
  "Full Shift": ["Abir", "piupiu", "Achilles", "Mantasha", "DK Who", "DFIT", "Windows-10", "IT", "daddy_ji", "Poor Guy"],
  "Staff": ["[Albatross]", "KLOK", "Eyes_On_U", "Frog", "Zero", "GhostFreak"],
};

// === UTIL ===
function stripColorCodes(name = "") {
  // Remove FiveM color codes like ^1 ^2 ...
  return name.replace(/\^([0-9])/g, "").trim();
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Exact-match Sets for roles (case-sensitive, after stripping color codes on the player name)
const shiftSets = Object.fromEntries(
  Object.entries(shiftGroups).map(([shift, names]) => [shift, new Set(names)])
);

// === STATE ===
let lastPlayers = [];
let lastMeta = { hostname: "FiveM Server", max: "?" };

let refreshInterval = 30; // seconds
let refreshCounter = refreshInterval;
let refreshTimer;

// === FETCH HELPERS ===
async function fetchJsonWithTimeout(url, { timeout = 7000, signal } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error("timeout")), timeout);
  try {
    const res = await fetch(url, { cache: "no-store", signal: signal || controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) throw new Error("non-JSON response");
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

// Try vercel → fallback to CFX, with small retries
async function getServerSnapshot() {
  const attempt = async (fn) => {
    const delays = [0, 500, 1000]; // immediate, 0.5s, 1s
    let lastErr;
    for (const d of delays) {
      if (d) await new Promise(r => setTimeout(r, d));
      try { return await fn(); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };

  // 1) Try Vercel wrapper first
  try {
    const j = await attempt(() => fetchJsonWithTimeout(VERCEL_STATUS_URL, { timeout: 7000 }));
    const players = j.players || j.data?.players || j.Data?.players || [];
    const hostname = j.hostname || j.data?.hostname || j.Data?.hostname || "FiveM Server";
    const max = j.maxPlayers || j.slots || j.data?.sv_maxclients || j.Data?.sv_maxclients ||
                j.vars?.sv_maxclients || j.vars?.svMaxClients || "?";
    if (!Array.isArray(players)) throw new Error("vercel: players not array");
    return { players, hostname, max, source: "vercel" };
  } catch (_) {
    // 2) Fallback to CFX endpoint
    const j = await fetchJsonWithTimeout(CFX_URL, { timeout: 7000 });
    const d = j?.Data ?? j ?? {};
    const players = (d.players ?? []).slice();
    const hostname = d.hostname || "FiveM Server";
    const max = d.sv_maxclients ?? d.vars?.sv_maxclients ?? d.vars?.svMaxClients ?? "?";
    return { players, hostname, max, source: "cfx" };
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

  const searchVal = ($("#search").value || "").toLowerCase();
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
