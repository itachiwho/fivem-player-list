// === CONFIG ===
const serverId = "8p75gb"; // your CFX code
const VERCEL_STATUS_URL = "https://fivem-server.vercel.app/status/legacybd";
const CFX_URL = `https://servers-frontend.fivem.net/api/servers/single/${serverId}`;

const shiftGroups = {
  "Shift-1": ["SPL4SH", "6t9", "ALFYKUNNO", "Siam", "Hercules", "Sami", "hasib", "Mowaj Hossain"],
  "Shift-2": ["KiUHA", "KIBRIA", "iramf", "Mr Fraud", "ITACHI", "💤", "mihad", "pc"],
  "Full Shift": ["Abir", "piupiu", "Achilles", "Mantasha", "DK Who", "DFIT", "Windows-10", "IT", "daddy_ji", "Poor Guy"],
  "Staff": ["[Albatross]", "KLOK", "Eyes_On_U", "Frog", "Zero", "GhostFreak"]
};

// === UTIL ===
function stripColorCodes(name = "") {
  return name.replace(/\^([0-9])/g, "").trim();
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
const shiftSets = Object.fromEntries(
  Object.entries(shiftGroups).map(([shift, names]) => [shift, new Set(names)])
);
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

// Try vercel → fallback to CFX
async function getServerSnapshot() {
  // small retry/backoff helper
  const attempt = async (fn) => {
    const tries = [0, 500, 1000]; // immediate, 0.5s, 1s
    let lastErr;
    for (const delay of tries) {
      if (delay) await new Promise(r => setTimeout(r, delay));
      try { return await fn(); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };

  // 1) Try vercel wrapper (often handles CORS and is stable)
  try {
    const j = await attempt(() => fetchJsonWithTimeout(VERCEL_STATUS_URL, { timeout: 7000 }));
    // normalize
    const players = j.players || j.data?.players || j.Data?.players || [];
    const hostname = j.hostname || j.data?.hostname || j.Data?.hostname || "FiveM Server";
    const max = j.maxPlayers || j.slots || j.data?.sv_maxclients || j.Data?.sv_maxclients ||
                j.vars?.sv_maxclients || j.vars?.svMaxClients || "?";
    if (!Array.isArray(players)) throw new Error("vercel: players not array");
    return { players, hostname, max, raw: j, source: "vercel" };
  } catch (_) {
    // 2) Fallback to CFX
    const j = await fetchJsonWithTimeout(CFX_URL, { timeout: 7000 });
    const d = j?.Data ?? j ?? {};
    const players = (d.players ?? []).slice();
    const hostname = d.hostname || "FiveM Server";
    const max = d.sv_maxclients ?? d.vars?.sv_maxclients ?? d.vars?.svMaxClients ?? "?";
    return { players, hostname, max, raw: j, source: "cfx" };
  }
}

// === STATE ===
let lastPlayers = [];
let lastMeta = { hostname: "FiveM Server", max: "?" };
let refreshInterval = 30; // seconds
let refreshCounter = refreshInterval;
let refreshTimer;

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

    const { players, hostname, max } = await getServerSnapshot();

    // sort stable
    players.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0) || String(a?.name||"").localeCompare(String(b?.name||"")));

    // update cache & UI
    lastPlayers = players;
    lastMeta = { hostname, max };
    hideWarning();
    setMeta(hostname, max);
    renderPlayers();
    renderOffline();
  } catch (err) {
    console.error("Fetch failed:", err);
    // keep showing last good list; just warn
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

// === Filters: re-render only ===
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
$("#search").addEventListener("input", debounce(renderPlayers, 120));
$("#shift-filter").addEventListener("change", renderPlayers);

// === Manual refresh ===
$("#refresh-status").addEventListener("click", () => loadPlayers());

// === Auto refresh (SWR style) ===
let refreshCounter = 30;
let refreshTimer;
function startRefreshTimer() {
  refreshCounter = 30;
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
