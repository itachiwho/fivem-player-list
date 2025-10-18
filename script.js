// ================================================
//  SHIFT GROUP + PLAYER LIST SYNC SCRIPT
// ================================================

// Google Sheet CSV link (publicly published CSV)
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkQmk1EPkEaJKZ8YlrCd89-66e55TgACGPIe11KgLYs3WIv80JY62_d6BJhQ-xNoIpiQTyrY8Pxn27/pub?gid=0&single=true&output=csv";

// Manual group (only this one is edited in code)
const manualGroups = {
  "Staff": ["[Albatross]", "_ROVER_", "KLOK", "Eyes_On_U", "Frog", "Zero", "GhostFreak"]
};

// =================================================
// 1️⃣ Fetch and parse Google Sheet
// =================================================
async function fetchShiftGroups() {
  try {
    const response = await fetch(CSV_URL);
    const text = await response.text();
    const rows = text.split(/\r?\n/).map(r => r.split(","));
    const dataRows = rows.slice(6); // Skip top junk rows

    const groups = { "Shift-1": [], "Shift-2": [], "Full Shift": [] };

    for (const row of dataRows) {
      const s1 = row[3]?.trim();
      const s2 = row[8]?.trim();
      const s3 = row[13]?.trim();

      if (s1) groups["Shift-1"].push(s1);
      if (s2) groups["Shift-2"].push(s2);
      if (s3) groups["Full Shift"].push(s3);
    }

    const shiftGroups = { ...groups, ...manualGroups };
    console.log("✅ Shift groups loaded:", shiftGroups);
    return shiftGroups;

  } catch (err) {
    console.error("❌ Failed to load shift groups:", err);
    return manualGroups;
  }
}

// =================================================
// 2️⃣ Example: Fetch FiveM player list (your API)
// =================================================
async function fetchPlayerList() {
  try {
    const res = await fetch("https://servers-frontend.fivem.net/api/servers/single/8p75gb"); 
    const data = await res.json();
    const players = data?.Data?.players || [];
    return players.map(p => stripColorCodes(p.name));
  } catch (err) {
    console.error("❌ Failed to fetch player list:", err);
    return [];
  }
}

// Removes FiveM color codes (^1, ^2, etc.)
function stripColorCodes(name) {
  return name.replace(/\^[0-9]/g, "").trim();
}

// =================================================
// 3️⃣ Display the grouped player list
// =================================================
function updateUIWithGroups(shiftGroups, onlinePlayers = []) {
  const container = document.getElementById("shift-container");
  container.innerHTML = "";

  const allGroups = Object.keys(shiftGroups);

  allGroups.forEach(group => {
    const groupCard = document.createElement("div");
    groupCard.className = "group-card";

    const header = document.createElement("h2");
    header.textContent = group;
    groupCard.appendChild(header);

    const list = document.createElement("ul");

    shiftGroups[group].forEach(name => {
      const item = document.createElement("li");
      const cleanName = stripColorCodes(name);
      const isOnline = onlinePlayers.includes(cleanName);

      item.textContent = cleanName;
      item.className = isOnline ? "online" : "offline";
      list.appendChild(item);
    });

    groupCard.appendChild(list);
    container.appendChild(groupCard);
  });

  // Optional: Unassigned players
  const allNames = Object.values(shiftGroups).flat();
  const unassigned = onlinePlayers.filter(p => !allNames.includes(p));
  if (unassigned.length > 0) {
    const card = document.createElement("div");
    card.className = "group-card unassigned";
    const header = document.createElement("h2");
    header.textContent = "Unassigned (Online)";
    card.appendChild(header);

    const list = document.createElement("ul");
    unassigned.forEach(name => {
      const li = document.createElement("li");
      li.textContent = name;
      li.className = "online";
      list.appendChild(li);
    });
    card.appendChild(list);
    container.appendChild(card);
  }
}

// =================================================
// 4️⃣ Initialize on page load
// =================================================
async function init() {
  const [shiftGroups, players] = await Promise.all([
    fetchShiftGroups(),
    fetchPlayerList()
  ]);

  updateUIWithGroups(shiftGroups, players);
}

// Call on page load
init();

// =================================================
// 5️⃣ Optional: Manual refresh button support
// =================================================
async function refreshShifts() {
  const shiftGroups = await fetchShiftGroups();
  const players = await fetchPlayerList();
  updateUIWithGroups(shiftGroups, players);
}
