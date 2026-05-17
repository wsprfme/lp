const TRANSPORT = {
  ojol: {
    name: "Ojek Online",
    speed: 35,
    cost: (km) => 7000 + 2500 * km,
  },
  bus: {
    name: "Bus Trans Musi",
    speed: 25,
    cost: () => 5000,
  },
  lrt: {
    name: "LRT Palembang",
    speed: 40,
    cost: () => 8000,
  },
  angkot: {
    name: "Angkot",
    speed: 22,
    cost: (km) => 4000 + 1000 * km,
  },
  walk: {
    name: "Jalan Kaki",
    speed: 5,
    cost: () => 0,
  },
};

const PALEMBANG = [-2.9909, 104.7565];

let map;
let markerFrom = null;
let markerTo = null;
let routeLine = null;
let coordFrom = null;
let coordTo = null;

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  bindEvents();
  renderHistory();
});

function initMap() {
  map = L.map("map").setView(PALEMBANG, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function bindEvents() {
  setupAutocomplete("from", "suggest-from", (place) => {
    coordFrom = [parseFloat(place.lat), parseFloat(place.lon)];
    document.getElementById("from").value = place.display_name;
    setMarker("from", coordFrom, place.display_name);
  });

  setupAutocomplete("to", "suggest-to", (place) => {
    coordTo = [parseFloat(place.lat), parseFloat(place.lon)];
    document.getElementById("to").value = place.display_name;
    setMarker("to", coordTo, place.display_name);
  });

  document.getElementById("btn-find").addEventListener("click", findRoute);
  document.getElementById("btn-reset").addEventListener("click", resetAll);
  document.getElementById("btn-swap").addEventListener("click", swapLocations);
  document.getElementById("mode").addEventListener("change", autoChooseTransport);
}

function setupAutocomplete(inputId, listId, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  let timer;

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 3) {
      list.innerHTML = "";
      return;
    }
    timer = setTimeout(() => searchPlace(q, list, onSelect), 400);
  });

  document.addEventListener("click", (e) => {
    if (e.target !== input) list.innerHTML = "";
  });
}

async function searchPlace(query, list, onSelect) {
  list.innerHTML = "<li>Mencari...</li>";
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=id&q=" +
      encodeURIComponent(query + " Palembang");
    const res = await fetch(url, {
      headers: { "Accept-Language": "id" },
    });
    const data = await res.json();
    list.innerHTML = "";
    if (data.length === 0) {
      list.innerHTML = "<li>Tidak ditemukan</li>";
      return;
    }
    data.forEach((place) => {
      const li = document.createElement("li");
      li.textContent = place.display_name;
      li.addEventListener("click", () => {
        onSelect(place);
        list.innerHTML = "";
      });
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = "<li>Gagal memuat</li>";
  }
}

function setMarker(type, coord, label) {
  if (type === "from") {
    if (markerFrom) map.removeLayer(markerFrom);
    markerFrom = L.marker(coord).addTo(map).bindPopup("Asal: " + label);
  } else {
    if (markerTo) map.removeLayer(markerTo);
    markerTo = L.marker(coord).addTo(map).bindPopup("Tujuan: " + label);
  }

  if (markerFrom && markerTo) {
    const group = L.featureGroup([markerFrom, markerTo]);
    map.fitBounds(group.getBounds().pad(0.2));
  } else {
    map.setView(coord, 14);
  }
}

function autoChooseTransport() {
  const mode = document.getElementById("mode").value;
  const select = document.getElementById("transport");
  if (mode === "cost") {
    select.value = "walk";
  } else {
    select.value = "ojol";
  }
}

async function findRoute() {
  const fromVal = document.getElementById("from").value.trim();
  const toVal = document.getElementById("to").value.trim();

  if (!coordFrom || !coordTo) {
    showError("Pilih lokasi asal dan tujuan terlebih dahulu.");
    return;
  }

  showLoading(true);
  hideResult();

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coordFrom[1]},${coordFrom[0]};${coordTo[1]},${coordTo[0]}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
      throw new Error("Rute tidak ditemukan");
    }

    const route = data.routes[0];
    drawRoute(route.geometry.coordinates);

    const transportKey = chooseTransport();
    showResult(fromVal, toVal, route, transportKey);
    saveHistory(fromVal, toVal, transportKey);
  } catch (err) {
    showError("Gagal mencari rute: " + err.message);
  } finally {
    showLoading(false);
  }
}

function chooseTransport() {
  const mode = document.getElementById("mode").value;
  const selected = document.getElementById("transport").value;

  if (mode === "cost") {
    return "walk";
  }

  return selected;
}

function drawRoute(coords) {
  if (routeLine) map.removeLayer(routeLine);
  const latlngs = coords.map((c) => [c[1], c[0]]);
  routeLine = L.polyline(latlngs, {
    color: "#2c5282",
    weight: 5,
    opacity: 0.8,
  }).addTo(map);
  map.fitBounds(routeLine.getBounds().pad(0.15));
}

function showResult(fromName, toName, route, transportKey) {
  const trans = TRANSPORT[transportKey];
  const km = route.distance / 1000;
  const baseMin = route.duration / 60;
  const adjustedMin = (km / trans.speed) * 60;
  const finalMin = transportKey === "ojol" ? baseMin : Math.max(baseMin, adjustedMin);
  const cost = Math.round(trans.cost(km) / 500) * 500;

  const steps = extractStreetNames(route);

  const html = `
    <div class="transport-badge">${trans.name}</div>

    <div class="result-info">
      <div><b>Dari:</b> ${fromName}</div>
      <div><b>Ke:</b> ${toName}</div>
    </div>

    <div class="result-stats">
      <div class="stat-box">
        <div class="label">Jarak</div>
        <div class="value">${km.toFixed(1)} km</div>
      </div>
      <div class="stat-box">
        <div class="label">Waktu</div>
        <div class="value">${Math.round(finalMin)} mnt</div>
      </div>
      <div class="stat-box">
        <div class="label">Biaya</div>
        <div class="value">Rp ${cost.toLocaleString("id-ID")}</div>
      </div>
    </div>

    <h4 style="margin-top:10px; font-size:13px;">Jalur Rute</h4>
    <ul class="steps-list">
      ${steps.map((s) => `<li>${s}</li>`).join("")}
    </ul>
  `;

  document.getElementById("result").innerHTML = html;
  document.getElementById("result-card").style.display = "block";
}

function extractStreetNames(route) {
  const names = new Set();
  if (route.legs && route.legs.length > 0) {
    route.legs.forEach((leg) => {
      if (leg.steps) {
        leg.steps.forEach((step) => {
          if (step.name && step.name.trim() !== "") {
            names.add(step.name);
          }
        });
      }
    });
  }
  const arr = Array.from(names);
  return arr.length > 0 ? arr : ["Rute langsung"];
}

function showError(msg) {
  const card = document.getElementById("result-card");
  card.style.display = "block";
  document.getElementById("result").innerHTML = `<div class="error-msg">${msg}</div>`;
}

function hideResult() {
  document.getElementById("result-card").style.display = "none";
}

function showLoading(on) {
  document.getElementById("loading").style.display = on ? "flex" : "none";
}

function resetAll() {
  document.getElementById("from").value = "";
  document.getElementById("to").value = "";
  coordFrom = null;
  coordTo = null;
  if (markerFrom) map.removeLayer(markerFrom);
  if (markerTo) map.removeLayer(markerTo);
  if (routeLine) map.removeLayer(routeLine);
  markerFrom = null;
  markerTo = null;
  routeLine = null;
  hideResult();
  map.setView(PALEMBANG, 13);
}

function swapLocations() {
  const fromInput = document.getElementById("from");
  const toInput = document.getElementById("to");
  const tmpVal = fromInput.value;
  fromInput.value = toInput.value;
  toInput.value = tmpVal;

  const tmpCoord = coordFrom;
  coordFrom = coordTo;
  coordTo = tmpCoord;

  if (markerFrom) map.removeLayer(markerFrom);
  if (markerTo) map.removeLayer(markerTo);
  markerFrom = null;
  markerTo = null;
  if (coordFrom) setMarker("from", coordFrom, fromInput.value);
  if (coordTo) setMarker("to", coordTo, toInput.value);
}

const HISTORY_KEY = "planner_history";

function saveHistory(from, to, transport) {
  const list = getHistory();
  list.unshift({
    from,
    to,
    transport,
    date: new Date().toISOString(),
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8)));
  renderHistory();
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function renderHistory() {
  const ul = document.getElementById("history");
  const list = getHistory();
  if (list.length === 0) {
    ul.innerHTML = `<li class="history-empty">Belum ada pencarian</li>`;
    return;
  }
  ul.innerHTML = list
    .map(
      (h, i) => `
    <li data-idx="${i}">
      <b>${shortName(h.from)}</b> &rarr; <b>${shortName(h.to)}</b><br>
      <small>${TRANSPORT[h.transport]?.name || h.transport} &middot; ${formatDate(h.date)}</small>
    </li>
  `
    )
    .join("");

  ul.querySelectorAll("li[data-idx]").forEach((li) => {
    li.addEventListener("click", () => {
      const item = list[Number(li.dataset.idx)];
      document.getElementById("from").value = item.from;
      document.getElementById("to").value = item.to;
      document.getElementById("transport").value = item.transport;
      reGeocode(item.from, "from");
      reGeocode(item.to, "to");
    });
  });
}

async function reGeocode(query, type) {
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
        encodeURIComponent(query)
    );
    const data = await res.json();
    if (data.length > 0) {
      const place = data[0];
      const coord = [parseFloat(place.lat), parseFloat(place.lon)];
      if (type === "from") coordFrom = coord;
      else coordTo = coord;
      setMarker(type, coord, place.display_name);
    }
  } catch {}
}

function shortName(name) {
  if (!name) return "";
  return name.length > 30 ? name.substring(0, 30) + "..." : name;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
