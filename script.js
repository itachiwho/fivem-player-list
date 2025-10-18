// === CONFIG ===
const serverId = "8p75gb"; // your CFX code
const VERCEL_STATUS_URL = "https://fivem-server.vercel.app/status/legacybd";
const CFX_URL = `https://servers-frontend.fivem.net/api/servers/single/${serverId}`;
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkQmk1EPkEaJKZ8YlrCd89-66e55TgACGPIe11KgLYs3WIv80JY62_d6BJhQ-xNoIpiQTyrY8Pxn27/pub?gid=0&single=true&output=csv";

// Manual Staff group (edit this in code)
const manualStaffGroup = {
  "Staff": ["[Albatross]", "_ROVER_", "KLOK", "Eyes_On_U", "Frog", "Zero", "GhostFreak"]
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

// === STATE ===
let shiftGroups = {}; // loaded from Google Sheet
let lastPlayers = [];
let lastMeta = { hostname: "FiveM Server", max: "?" };
let refreshInterval = 30;
let refreshCounter = refreshInterval;
let refreshTimer;

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
async function fetchJsonStrict(url, { timeout = 7000 } = {}) {
  const res = await fetchWithTimeout(url, { timeout });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) throw new Error("non-JSON response");
  return await res.json();
}

// === FETCH SHIFT GROUPS FROM GOOGLE SHEET ===
async function fetchShiftGroups() {
  try {
    const res = await fetch(CSV_URL);
    const csvText = await res.text();
    const rows = csvText.split(/\r?\n/).map(r => r.split(","));
    const dataRows = rows.slice(6); // skip header rows

    const groups = { "Shift-1": [], "Shift-2": [], "Full Shift": [] };

    for (const row of dataRows) {
      const s1 = row[3]?.trim();
      const s2 = row[8]?.trim();
      const s3 = row[13]?.trim();

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

// === SERVER SNAPSHOT ===
async function getServerSnapshot() {
  const attempt = async (fn) => {
    const delays = [0, 500, 1000];
    let lastErr;
    for (const d of delays) {
      if (d) await new Promise(r => setTimeout(r, d));
      try { return await fn(); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };

  try {
    const j = await attempt(() => fetchJsonLenient(VERCEL_STATUS_URL, { timeout: 7000 }));
    const players = pickPlayersFromAnyShape(j);
    if (!Array.isArray(players) || players.length === 0) throw new Error("vercel: empty players");
    return { players, hostname: pickHostnameFromAnyShape(j), max: pickMaxFromAnyShape(j) };
  } catch (_) {
    const j = await fetchJsonStrict(CFX_URL, { timeout: 7000 });
    const d = j?.Data ?? j ?? {};
    const players = (d.players ?? []).slice();
    const hostname = d.hostname || "FiveM Server";
    const max = d.sv_maxclients ?? d.vars?.sv_maxclients ?? d.vars?.svMaxClients ?? "?";
    return { players, hostname, max };
  }
}
function pickPlayersFromAnyShape(j) {
  let arr =
    j.players ||
    j.data?.players ||
    j.Data?.players ||
    j.server?.players ||
    j.response?.players ||
    j.result?.players ||
    j.payload?.players ||
    j.body?.players ||
    null;
  if (Array.isArray(arr) && arr.length > 0) return arr;
  const queue = [j];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      if (/^players$/i.test(k) && Array.isArray(v) && v.length > 0) return v;
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return null;
}
function pickHostnameFromAnyShape(j) {
  return (
    j.hostname || j.data?.hostname || j.Data?.hostname || j.server?.hostname || j.response?.hostname || "FiveM Server"
  );
}
function pickMaxFromAnyShape(j) {
  return (
    j.maxPlayers ||
    j.slots ||
    j.data?.sv_maxclients ||
    j.Data?.sv_maxclients ||
    j.vars?.sv_maxclients ||
    j.vars?.svMaxClients ||
    "?"
  );
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
    if (searchVal && !clean.toLowerCase().includes(searchVal)) return false;
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
  const loader = $("#loader");
  const icon = $("#refresh-status img");
  try {
    loader.style.display = "flex";
    icon?.classList.add("spin");

    const snap = await getServerSnapshot();
    const players = snap.players.slice().sort((a, b) =>
      (a?.id ?? 0) - (b?.id ?? 0) || String(a?.name || "").localeCompare(String(b?.name || ""))
    );

    lastPlayers = players;
    lastMeta = { hostname: snap.hostname, max: snap.max };

    hideWarning();
    setMeta(lastMeta.hostname, lastMeta.max);
    renderPlayers();
    renderOffline();
  } catch (err) {
    console.error("Fetch failed:", err);
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
function resetRefreshTimer() { startRefreshTimer(); }
function updateRefreshDisplay() {
  const el = $("#refresh-timer");
  if (el) el.textContent = refreshCounter + "s";
}

// === BOOT ===
(async function init() {
  shiftGroups = await fetchShiftGroups();
  await loadPlayers();
  startRefreshTimer();
})();
