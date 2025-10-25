// === CONFIG ===
const serverId = "8p75gb"; // your CFX code
const CFX_URL = `https://servers-frontend.fivem.net/api/servers/single/${serverId}`;
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkQmk1EPkEaJKZ8YlrCd89-66e55TgACGPIe11KgLYs3WIv80JY62_d6BJhQ-xNoIpiQTyrY8Pxn27/pub?gid=0&single=true&output=csv";

// Manual Staff group (edit this in code)
const manualStaffGroup = {
  "Staff": ["[Albatross]", "_ROVER_", "Eyes_On_U", "Frog", "Zero", "GhostFreak"]
};

// === UTIL ===
function stripColorCodes(name = "") {
  return name.replace(/\^([0-9])/g, "").trim();
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// 12-hour time WITH seconds, e.g., "2:35:07 PM"
function nowTime() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour12: true });
}

// Simple robust CSV parser (handles quotes/commas/newlines)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'; i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell); cell = "";
      } else if (ch === '\n') {
        row.push(cell); rows.push(row); row = []; cell = "";
      } else if (ch === '\r') {
        // ignore \r; handle \r\n via \n branch
      } else {
        cell += ch;
      }
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

// === STATE ===
let shiftGroups = {}; // loaded from Google Sheet
let lastPlayers = [];
let lastMeta = { hostname: "FiveM Server", max: "?" };
let lastUpdated = null;

let refreshInterval = 30;
let refreshCounter = refreshInterval;
let refreshTimer;
let loading = false; // prevent overlapping fetches

// === FETCH HELPERS ===
async function fetchWithTimeout(url, { timeout = 3000, init = {} } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: init.signal || controller.signal });
  } finally {
    clearTimeout(id);
  }
}
async function fetchJsonStrict(url, { timeout = 3000 } = {}) {
  const res = await fetchWithTimeout(url, { timeout });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) throw new Error("non-JSON response");
  return await res.json();
}

// === FETCH SHIFT GROUPS FROM GOOGLE SHEET (non-blocking) ===
async function fetchShiftGroups() {
  try {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    const csvText = await res.text();
    const rows = parseCsv(csvText);
    const dataRows = rows.slice(6); // skip header rows as in your sheet

    const groups = { "Shift-1": [], "Shift-2": [], "Full Shift": [] };

    for (const row of dataRows) {
      const s1 = (row[3]  || "").trim();
      const s2 = (row[8]  || "").trim();
      const s3 = (row[13] || "").trim();

      if (s1) groups["Shift-1"].push(s1);
      if (s2) groups["Shift-2"].push(s2);
      if (s3) groups["Full Shift"].push(s3);
    }

    const combined = { ...groups, ...manualStaffGroup };
    console.log("✅ Loaded shift groups from Google Sheet:", combined);
    return combined;

  } catch (err) {
    console.error("❌ Failed to load shift groups:", err);
    return manualStaffGroup;
  }
}

// === SERVER SNAPSHOT (CFX-only, fast timeout + quick retry) ===
async function getServerSnapshot() {
  // 1st attempt (short timeout)
  try {
    const j = await fetchJsonStrict(CFX_URL, { timeout: 3000 });
    return normalizeCfxSnapshot(j);
  } catch (e1) {
    // Quick retry with small backoff
    await new Promise(r => setTimeout(r, 500));
    const j2 = await fetchJsonStrict(CFX_URL, { timeout: 4000 });
    return normalizeCfxSnapshot(j2);
  }
}
function normalizeCfxSnapshot(j) {
  const d = j?.Data ?? j ?? {};
  const players = (d.players ?? []).slice();
  const hostname = d.hostname || "FiveM Server";
  const max = d.sv_maxclients ?? d.vars?.sv_maxclients ?? d.vars?.svMaxClients ?? "?";
  return { players, hostname, max };
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
  $("#warning").style.display = "none";
}
function setSpinner(on) {
  const icon = $("#refresh-status img");
  if (!icon) return;
  if (on) {
    icon.style.animation = "spin 0.9s linear infinite"; // uses your CSS @keyframes spin
  } else {
    icon.style.animation = ""; // stop
  }
}
function updateRefreshDisplay() {
  const el = $("#refresh-timer");
  if (!el) return;

  const next = `${refreshCounter}s`;
  const updated = lastUpdated ? ` • Last updated: ${lastUpdated}` : "";

  el.textContent = `${next}${updated}`;
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

  const searchVal = ($("#search").value || "").trim().toLowerCase();
  const filter = $("#shift-filter").value;

  const shiftSets = Object.fromEntries(
    Object.entries(shiftGroups).map(([shift, names]) => [shift, new Set(names)])
  );

  const filtered = lastPlayers.filter((p) => {
    const clean = stripColorCodes(p?.name || "");
    const idStr = String(p?.id ?? "").toLowerCase();

    // Search by both player name AND server ID
    const matchesSearch =
      !searchVal ||
      clean.toLowerCase().includes(searchVal) ||
      idStr.includes(searchVal);

    if (!matchesSearch) return false;
    if (filter !== "all") return shiftSets[filter]?.has(clean);
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

// === FETCH + RENDER CYCLE ===
async function loadPlayers() {
  if (loading) return;        // prevent overlap
  loading = true;

  const loader = $("#loader");
  try {
    loader.style.display = "flex";
    setSpinner(true);

    const snap = await getServerSnapshot();
    const players = snap.players.slice().sort((a, b) =>
      (a?.id ?? 0) - (b?.id ?? 0) || String(a?.name || "").localeCompare(String(b?.name || ""))
    );

    lastPlayers = players;
    lastMeta = { hostname: snap.hostname, max: snap.max };
    lastUpdated = nowTime();

    hideWarning();
    setMeta(lastMeta.hostname, lastMeta.max);
    renderPlayers();
    renderOffline();
  } catch (err) {
    console.error("Fetch failed:", err);
    if (lastPlayers.length) {
      // Show warning with timestamp when falling back to cached data
      const ts = lastUpdated ? lastUpdated : "N/A";
      showWarning(`⚠ Couldn’t update, showing last data — last updated at ${ts}`);
      setMeta(lastMeta.hostname, lastMeta.max);
      renderPlayers();
      renderOffline();
    } else {
      $("#players-table").innerHTML = "<tr><td colspan='5'>⚠ Failed to load players.</td></tr>";
    }
  } finally {
    loader.style.display = "none";
    setSpinner(false);
    resetRefreshTimer();
    loading = false;
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

// === Filters ===
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
$("#search").addEventListener("input", debounce(renderPlayers, 120));
$("#shift-filter").addEventListener("change", renderPlayers);

// === Manual refresh ===
$("#refresh-status").addEventListener("click", () => loadPlayers());

// === Auto refresh ===
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
function resetRefreshTimer() { 
  refreshCounter = refreshInterval;
  updateRefreshDisplay();
}

// === BOOT ===
(async function init() {
  // Start fetching roles but DON'T block initial player render
  const groupsPromise = fetchShiftGroups().catch(() => ({}));
  await loadPlayers();                 // show players ASAP
  shiftGroups = await groupsPromise;   // roles arrive later
  renderPlayers();                     // re-render with roles
  renderOffline();
  startRefreshTimer();

// === Live Date & Time (DD/MM/YYYY, 12-hour format, no seconds) ===
function updateDateTime() {
  const el = document.getElementById("current-datetime");
  if (!el) return;

  const now = new Date();

  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  const formattedTime = `${hours}:${minutes} ${ampm}`;
  const formattedDate = `${day}/${month}/${year}`;

  el.textContent = `${formattedDate}, ${formattedTime}`;
}

// Update every minute
setInterval(updateDateTime, 60000);
updateDateTime();
})();
