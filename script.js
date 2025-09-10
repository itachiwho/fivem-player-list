const serverId = "8p75gb"; // change this if needed

// Define shift groups
const shiftGroups = {
  "Shift-1": ["SPL4SH", "6t9", "ALFYKUNNO", "Siam", "Hercules", "Sami", "hasib", "Mowaj Hossain"],
  "Shift-2": ["KiUHA", "KIBRIA", "iramf", "Mr Fraud", "ITACHI", "💤", "mihad", "pc"],
  "Full Shift": ["Abir", "piupiu", "Achilles", "Mantasha", "DK Who", "DFIT", "Windows-10", "IT", "daddy_ji", "Poor Guy"],
  "Staff": ["[Albatross]", "KLOK", "Eyes_On_U", "Frog", "Zero", "GhostFreak"] // Example staff list
};

// Store last good data
let lastPlayers = [];
let lastServerData = null;

// Refresh system
let refreshInterval = 30; // seconds
let refreshCounter = refreshInterval;
let refreshTimer;

// Clean FiveM color codes (^1, ^2, etc.)
function cleanServerName(name) {
  return name.replace(/\^([0-9])/g, "").trim();
}

async function loadPlayers() {
  const loader = document.getElementById("loader");
  loader.style.display = "flex";

  const warning = document.getElementById("warning");

  try {
    const res = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${serverId}`);
    if (!res.ok) throw new Error("Network response not ok");

    const data = await res.json();
    const players = data.Data?.players || data.players || [];

    // Save last good data
    lastPlayers = players;
    lastServerData = data;

    // Clear warning if it was showing
    if (warning) warning.style.display = "none";

    // Update UI
    updateUI(players, data);

  } catch (err) {
    console.error("Error loading players:", err);

    // If we have old data, show it + warning
    if (lastPlayers.length > 0) {
      if (warning) {
        warning.style.display = "block";
        warning.textContent = "⚠ Couldn’t update, showing last data";
      }
      updateUI(lastPlayers, lastServerData, true);
    } else {
      // If no old data, show error row
      document.getElementById("players-table").innerHTML =
        "<tr><td colspan='5'>⚠ Failed to load players.</td></tr>";
    }
  } finally {
    loader.style.display = "none";
    resetRefreshTimer(); // restart countdown after load
  }
}

function updateUI(players, data, isOld = false) {
  // Set server name
  const serverTitle = document.getElementById("server-title");
  serverTitle.textContent = cleanServerName(data?.Data?.hostname || data?.hostname || "FiveM Server");

  // Set player count
  const serverCount = document.getElementById("server-count");
  serverCount.textContent = `(${players.length}/${data?.Data?.sv_maxclients || data?.sv_maxclients || "?"})`;

  // Render tables
  renderPlayers(players);
  renderOffline(players);
}

function renderPlayers(players) {
  const container = document.getElementById("players-table");
  container.innerHTML = "";

  // Header row
  const header = `
    <tr>
      <th>No.</th>
      <th>ID</th>
      <th>Name</th>
      <th>Role</th>
      <th>Ping</th>
    </tr>`;
  container.innerHTML = header;

  const search = document.getElementById("search").value.toLowerCase();
  const filter = document.getElementById("shift-filter").value;

  players
    .filter(p => p.name.toLowerCase().includes(search))
    .filter(p => {
      if (filter === "all") return true;
      return shiftGroups[filter]?.includes(p.name);
    })
    .sort((a, b) => a.id - b.id) // sort by ID ascending
    .forEach((p, i) => {
      let shiftTag = "";
      for (let [shift, names] of Object.entries(shiftGroups)) {
        if (names.includes(p.name)) shiftTag = shift;
      }
      const row = `
        <tr>
          <td>${i + 1}</td>
          <td>${p.id}</td>
          <td>${p.name}</td>
          <td>${shiftTag || "-"}</td>
          <td>${p.ping} ms</td>
        </tr>`;
      container.innerHTML += row;
    });
}

function renderOffline(players) {
  const container = document.getElementById("offline-table");
  container.innerHTML = "";

  const header = `
    <tr>
      <th>Name</th>
      <th>Role</th>
      <th>Status</th>
    </tr>`;
  container.innerHTML = header;

  const onlineNames = players.map(p => p.name);

  for (let [shift, names] of Object.entries(shiftGroups)) {
    names.forEach(name => {
      if (!onlineNames.includes(name)) {
        const row = `
          <tr class="offline">
            <td>${name}</td>
            <td>${shift}</td>
            <td>🔴 Offline</td>
          </tr>`;
        container.innerHTML += row;
      }
    });
  }
}

// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// Search/filter events
document.getElementById("search").addEventListener("input", () => loadPlayers());
document.getElementById("shift-filter").addEventListener("change", () => loadPlayers());

// Manual refresh (click refresh icon)
document.getElementById("refresh-status").addEventListener("click", () => {
  loadPlayers();
});

// Auto refresh countdown
function startRefreshTimer() {
  refreshCounter = refreshInterval;
  updateRefreshDisplay();

  refreshTimer = setInterval(() => {
    refreshCounter--;
    updateRefreshDisplay();

    if (refreshCounter <= 0) {
      loadPlayers();
    }
  }, 1000);
}

function resetRefreshTimer() {
  clearInterval(refreshTimer);
  startRefreshTimer();
}

function updateRefreshDisplay() {
  const timerSpan = document.getElementById("refresh-timer");
  if (timerSpan) {
    timerSpan.textContent = refreshCounter + "s";
  }
}

// Initial load
loadPlayers();
startRefreshTimer();
