const serverId = "8p75gb"; // change this if needed

// Define shift groups
const shiftGroups = {
  "Shift-1": ["SPL4SH", "6t9", "ALFYKUNNO", "Siam", "Hercules", "Sami"],
  "Shift-2": ["ITACHI", "💤"],
  "Full Shift": ["DK Who", "DFIT", "Windows-10", "IT", "daddy_ji", "Poor Guy"],
  "Staff": ["AdminGuy", "Moderator", "Helper"] // Example staff list
};

// Store last good data
let lastPlayers = [];
let lastServerData = null;

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
