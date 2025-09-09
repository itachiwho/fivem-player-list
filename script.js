const serverId = "8p75gb"; // change this if needed

// Define shift groups
const shiftGroups = {
  "Shift-1": ["PlayerOne", "PlayerA"],
  "Shift-2": ["PlayerTwo", "PlayerB"],
  "Full Shift": ["AdminGuy", "PlayerC"]
};

// Clean FiveM color codes (^1, ^2, etc.)
function cleanServerName(name) {
  return name.replace(/\^([0-9])/g, "").trim();
}

async function loadPlayers() {
  const loader = document.getElementById("loader");
  loader.style.display = "flex";
  try {
    const res = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${serverId}`);
    const data = await res.json();
    console.log("API response:", data);

    const players = data.Data?.players || data.players || [];

    // Set server name (cleaned, white, bold)
    const serverTitle = document.getElementById("server-title");
    serverTitle.textContent = cleanServerName(data.Data?.hostname || data.hostname || "FiveM Server");

    // Set player count (right side)
    const serverCount = document.getElementById("server-count");
    serverCount.textContent = `(${players.length}/${data.Data?.sv_maxclients || data.sv_maxclients || "?"})`;

    // Set server icon if available
    if (data.Data?.icon) {
      const logo = document.getElementById("server-logo");
      logo.src = `data:image/png;base64,${data.Data.icon}`;
    }

    renderPlayers(players);
    renderOffline(players);
  } catch (err) {
    console.error("Error loading players:", err);
    document.getElementById("players-table").innerHTML = "<tr><td colspan='4'>Failed to load players.</td></tr>";
  } finally {
    loader.style.display = "none";
  }
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
        if (names.includes(p.name)) shiftTag = `(${shift})`;
      }
      const row = `
        <tr>
          <td>${i + 1}</td>
          <td>${p.id}</td>
          <td>${p.name} ${shiftTag}</td>
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
      <th>Shift</th>
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

// Initial load
loadPlayers();
setInterval(loadPlayers, 10000);
