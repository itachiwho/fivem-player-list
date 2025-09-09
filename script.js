const serverId = "8p75gb"; // change this if needed

// Define shift groups
const shiftGroups = {
  "Shift-1": ["PlayerOne", "PlayerA"],
  "Shift-2": ["PlayerTwo", "PlayerB"],
  "Full Shift": ["AdminGuy", "PlayerC"]
};

async function loadPlayers() {
  const loader = document.getElementById("loader");
  loader.style.display = "flex";
  try {
    const res = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${serverId}`);
    const data = await res.json();
    const players = data.Data.players || [];

    renderPlayers(players);
    renderOffline(players);
  } catch (err) {
    console.error(err);
    document.getElementById("players-table").innerHTML = "<p>Failed to load players.</p>";
  } finally {
    loader.style.display = "none";
  }
}

function renderPlayers(players) {
  const container = document.getElementById("players-table");
  container.innerHTML = "";
  const search = document.getElementById("search").value.toLowerCase();
  const filter = document.getElementById("shift-filter").value;

  players
    .filter(p => p.name.toLowerCase().includes(search))
    .filter(p => {
      if (filter === "all") return true;
      return shiftGroups[filter]?.includes(p.name);
    })
    .forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "player-row";
      let shiftTag = "";
      for (let [shift, names] of Object.entries(shiftGroups)) {
        if (names.includes(p.name)) shiftTag = `(${shift})`;
      }
      row.innerHTML = `<div>${i+1}. [${p.id}] ${p.name} ${shiftTag}</div><div>${p.ping} ms</div>`;
      container.appendChild(row);
    });
}

function renderOffline(players) {
  const container = document.getElementById("offline-table");
  container.innerHTML = "";
  const onlineNames = players.map(p => p.name);

  for (let [shift, names] of Object.entries(shiftGroups)) {
    names.forEach(name => {
      if (!onlineNames.includes(name)) {
        const row = document.createElement("div");
        row.className = "player-row offline";
        row.innerHTML = `<div>${name} (${shift})</div><div>🔴 Offline</div>`;
        container.appendChild(row);
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
