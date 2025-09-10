// === CONFIG (your current CFX code and shift lists) ===
const serverId = "8p75gb"; // change if needed

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

// Build exact-match Sets for each shift (case-sensitive)
const shiftSets = Object.fromEntries(
  Object.entries(shiftGroups).map(([shift, names]) => [shift, new Set(names)])
);

// === STATE ===
let lastPlayers = [];
let lastServerData = null;

let refreshInterval = 30; // seconds
let refreshCounter = refreshInterval;
let refreshTimer;

// === DOM helpers ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// === FETCH & UPDATE ===
async function loadPlayers() {
  const loader = $("#loader");
  const warning = $("#warning");
  const icon = $("#refresh-status img");

  try {
    loader.style.display = "flex";
    icon?.classList.add("spin");

    const res = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${serverId}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Network response not ok");

    const data = await res.json();
    const d = data?.Data ?? data ?? {};
    const players = (d.players ?? []).slice();

    // sort by id then name for stable order
    players.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0) || String(a?.name||"").localeCompare(String(b?.name||"")));

    lastPlayers = players;
    lastServerData = data;

    if (warning) warning.style.display = "none";
    updateUI(players, data);
  } catch (err) {
    console.error("Error loading players:", err);
    if (lastPlayers.length) {
      if (warning) {
        warning.style.display = "block";
        warning.textContent = "⚠ Couldn’t update, showing last data";
      }
      updateUI(lastPlayers, lastServerData, true);
    } else {
      $("#players-table").innerHTML = "<tr><td colspan='5'>⚠ Failed to load players.</td></tr>";
    }
  } finally {
    $("#loader").style.display = "none";
    icon?.classList.remove("spin");
    resetRefreshTimer();
  }
}

function updateUI(players, data, isOld = false) {
  const d = data?.Data ?? data ?? {};

  $("#server-title").textContent = stripColorCodes(d?.hostname || "FiveM Server");

  const max = d?.sv_maxclients ?? d?.vars?.sv_maxclients ?? d?.vars?.svMaxClients ?? "?";
  $("#server-count").textContent = `(${players.length}/${max})`;

  renderPlayers();   // render from cached lastPlayers + current filters
  renderOffline();   // compute offline vs shift lists
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
    // keep search user-friendly (case-insensitive search text)
    if (searchVal && !clean.toLowerCase().includes(searchVal)) return false;

    if (filter !== "all") {
      // STRICT role filter: exact (case-sensitive) match in that shift set
      return shiftSets[filter].has(clean);
    }
    return true;
  });

  filtered.forEach((p, i) => {
    const clean = stripColorCodes(p?.name || "");

    // STRICT role detection (exact match only)
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

  // Build a set of ONLINE names (color codes stripped) — case-sensitive
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
function resetRefreshTimer() { startRefreshTimer(); }
function updateRefreshDisplay() {
  const el = $("#refresh-timer");
  if (el) el.textContent = refreshCounter + "s";
}

// === Boot ===
loadPlayers();
startRefreshTimer();
