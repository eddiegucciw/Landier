// map.js — Leaflet + OpenStreetMap (no API key): explore map with price pins + clustering,
// place search (Nominatim), my location, the seller's location picker and the detail mini map.
import { NAIROBI, SUPPORT_EMAIL } from "./config.js";
import { state } from "./state.js";
import { $, esc, safeImg, formatKsh, shortKsh, toast, registerActions, onTabShow, switchTab, closeAllOverlays } from "./ui.js";
import { filteredListings, listingLocation, openDetail, loadListings } from "./listings.js";

// Kenya, with some padding so edge-of-country land is reachable.
const KENYA_BOUNDS = [[-5.5, 33.0], [6.0, 42.8]];

const TILES = {
  streets: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: { maxZoom: 20, subdomains: "abcd", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' }
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: { maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }
  }
};

// ---------- Library loading (bundled copy first, CDN fallback) ----------
const LIBS = [
  { css: "vendor/leaflet/leaflet.css", cdnCss: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    js: "vendor/leaflet/leaflet.js", cdnJs: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", ready: () => !!window.L?.map },
  { css: "vendor/leaflet/MarkerCluster.css", cdnCss: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
    css2: "vendor/leaflet/MarkerCluster.Default.css", cdnCss2: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
    js: "vendor/leaflet/leaflet.markercluster.js", cdnJs: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
    ready: () => !!window.L?.markerClusterGroup, optional: true }
];

function addCss(href, fallback) {
  if (document.querySelector(`link[data-src="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  l.dataset.src = href;
  l.onerror = () => { l.onerror = null; l.href = fallback; };
  document.head.appendChild(l);
}

function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("load failed: " + src)); };
    document.head.appendChild(s);
  });
}

let libPromise = null;
export function loadMaps() {
  libPromise ||= (async () => {
    for (const lib of LIBS) {
      addCss(lib.css, lib.cdnCss);
      if (lib.css2) addCss(lib.css2, lib.cdnCss2);
      if (lib.ready()) continue;
      try { await addScript(lib.js); }
      catch (_) {
        try { await addScript(lib.cdnJs); }
        catch (e) { if (!lib.optional) { libPromise = null; throw new Error("LOAD_FAILED"); } }
      }
    }
    return window.L;
  })();
  return libPromise;
}

function mapMessage(el, title, text) {
  if (!el) return;
  el.innerHTML = `<div class="map-msg"><i class="icon-map-pin-off"></i><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}
function explainMapError(el) {
  if (!navigator.onLine) mapMessage(el, "You're offline", "Connect to the internet to load the map.");
  else mapMessage(el, "Couldn't load the map", "Check your connection and try again.");
}

function isDark() { return document.documentElement.dataset.theme === "dark"; }

function tileLayer(kind) {
  const t = TILES[kind];
  return L.tileLayer(t.url, t.options);
}

// Base layers + a Map/Satellite switcher.
function addBaseLayers(map, { satellite = false, control = true } = {}) {
  const road = tileLayer(isDark() ? "dark" : "streets");
  const sat = tileLayer("satellite");
  (satellite ? sat : road).addTo(map);
  if (control) L.control.layers({ "Map": road, "Satellite": sat }, null, { position: "bottomleft" }).addTo(map);
  map.__road = road;
  return { road, sat };
}

function pricePin(text, active = false) {
  return L.divIcon({
    className: "",
    html: `<div class="price-pin${active ? " active" : ""}">${esc(text)}</div>`,
    iconSize: null,
    iconAnchor: [0, 0]
  });
}

function dropPin() {
  return L.divIcon({ className: "", html: '<div class="drop-pin"></div>', iconSize: [30, 42], iconAnchor: [15, 42] });
}

// Leaflet measures its container once; overlays slide in, so re-measure after the animation.
function settle(map) {
  setTimeout(() => map.invalidateSize(), 50);
  setTimeout(() => map.invalidateSize(), 350);
}

// ---------- Geolocation ----------
export function getMyLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location isn't supported on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(err.code === 1 ? "Location permission denied. Enable it in your phone settings." : "Couldn't get your location. Make sure GPS is on.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// ---------- Geocoding (OpenStreetMap Nominatim, Kenya only) ----------
export async function geocode(q) {
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
    q, format: "jsonv2", countrycodes: "ke", limit: "1", "accept-language": "en", email: SUPPORT_EMAIL
  });
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const [hit] = await res.json();
    if (!hit) return null;
    const [s, n, w, e] = hit.boundingbox.map(Number);
    return { location: { lat: Number(hit.lat), lng: Number(hit.lon) }, bounds: [[s, w], [n, e]], label: hit.display_name };
  } catch (e) {
    console.warn("geocode failed", e);
    return null;
  }
}

// ---------- Explore map ----------
let exploreMap = null;
let markerLayer = null;
let markers = [];
let userDot = null;
let activeMarker = null;
let pendingFit = true;
let exploreReady = false;

async function initExplore() {
  const el = $("#exploreMap");
  if (exploreMap) { exploreMap.invalidateSize(); refreshMarkers(); return; }
  if (!state.listings.length) loadListings();
  try {
    await loadMaps();
  } catch (e) {
    explainMapError(el);
    return;
  }
  el.innerHTML = "";
  exploreMap = L.map(el, {
    center: [NAIROBI.lat, NAIROBI.lng], zoom: 7, minZoom: 5,
    maxBounds: KENYA_BOUNDS, maxBoundsViscosity: 0.6, zoomControl: false
  });
  L.control.zoom({ position: "bottomright" }).addTo(exploreMap);
  addBaseLayers(exploreMap);
  markerLayer = L.markerClusterGroup
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup();
  markerLayer.addTo(exploreMap);
  exploreMap.on("click", hidePreview);
  settle(exploreMap);
  refreshMarkers();
  exploreReady = true;
}

function refreshMarkers() {
  if (!exploreMap) return;
  const list = filteredListings().filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  markerLayer.clearLayers();
  activeMarker = null;
  markers = list.map((l) => {
    const m = L.marker([l.latitude, l.longitude], { icon: pricePin(shortKsh(l.price)), title: l.title, riseOnHover: true });
    m.__l = l;
    m.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (activeMarker && activeMarker !== m) activeMarker.setIcon(pricePin(shortKsh(activeMarker.__l.price)));
      m.setIcon(pricePin(shortKsh(l.price), true));
      m.setZIndexOffset(1000);
      activeMarker = m;
      showPreview(l);
    });
    return m;
  });
  if (markerLayer.addLayers) markerLayer.addLayers(markers);
  else markers.forEach((m) => markerLayer.addLayer(m));
  const count = $("#mapCount");
  count.hidden = false;
  count.textContent = `${list.length} listing${list.length === 1 ? "" : "s"} on map`;
  hidePreview();
  if (pendingFit && markers.length) {
    const b = L.latLngBounds(markers.map((m) => m.getLatLng()));
    exploreMap.fitBounds(b, { padding: [60, 60], maxZoom: 14 });
    pendingFit = false;
  }
}

function showPreview(l) {
  const p = $("#mapPreview");
  p.innerHTML = `
    <img src="${safeImg(l.coverThumb)}" alt="">
    <div class="mp-body">
      <div class="card-price">${formatKsh(l.price)}</div>
      <div class="card-title">${esc(l.title)}</div>
      <div class="card-loc"><i class="icon-map-pin"></i> ${esc(listingLocation(l))}</div>
      ${l.size ? `<div class="card-size" style="margin-top:4px">${esc(l.size)}</div>` : ""}
    </div>
    <button class="mp-close" data-action="closePreview" aria-label="Close"><i class="icon-x"></i></button>`;
  p.dataset.id = l.id;
  p.hidden = false;
  $("#mapCount").hidden = true;
}

function hidePreview() {
  $("#mapPreview").hidden = true;
  if (exploreMap) $("#mapCount").hidden = false;
  if (activeMarker) {
    activeMarker.setIcon(pricePin(shortKsh(activeMarker.__l.price)));
    activeMarker.setZIndexOffset(0);
    activeMarker = null;
  }
}

async function locateMe() {
  try {
    const pos = await getMyLocation();
    if (!exploreMap) return;
    if (!userDot) {
      userDot = L.circleMarker([pos.lat, pos.lng], {
        radius: 9, color: "#fff", weight: 3, fillColor: "#3B82F6", fillOpacity: 1
      }).bindTooltip("You are here").addTo(exploreMap);
    } else userDot.setLatLng([pos.lat, pos.lng]);
    exploreMap.setView([pos.lat, pos.lng], 13);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function searchExplore(q) {
  q = q.trim();
  if (!q || !exploreMap) return;
  const res = await geocode(q);
  if (res) {
    exploreMap.fitBounds(res.bounds, { maxZoom: 15 });
    return;
  }
  // Fallback: zoom to listings whose town/county matches.
  const ql = q.toLowerCase();
  const hits = markers.filter((m) => listingLocation(m.__l).toLowerCase().includes(ql));
  if (hits.length) exploreMap.fitBounds(L.latLngBounds(hits.map((m) => m.getLatLng())), { padding: [80, 80], maxZoom: 14 });
  else toast(`Couldn't find "${q}"`, "error");
}

export function focusOnMap(l) {
  pendingFit = false;
  closeAllOverlays({ rewind: true });
  // Wait for the history rewind before pushing the tab entry.
  setTimeout(() => {
    switchTab("explore");
    let tries = 0;
    const go = () => {
      if (!exploreReady) return ++tries < 30 && setTimeout(go, 300);
      exploreMap.setView([l.latitude, l.longitude], 16);
      showPreview(l);
    };
    go();
  }, 80);
}

// ---------- Location picker (listing form) ----------
export async function createPicker(el, initial, onChange) {
  let map = null;
  let marker = null;
  let current = initial || null;

  const set = (pos, { pan = false, zoom = null } = {}) => {
    current = { lat: Number(pos.lat), lng: Number(pos.lng) };
    if (map) {
      if (!marker) {
        marker = L.marker([current.lat, current.lng], { icon: dropPin(), draggable: true, autoPan: true }).addTo(map);
        marker.on("dragend", () => { const p = marker.getLatLng(); set({ lat: p.lat, lng: p.lng }); });
      } else marker.setLatLng([current.lat, current.lng]);
      if (zoom) map.setView([current.lat, current.lng], zoom);
      else if (pan) map.panTo([current.lat, current.lng]);
    }
    onChange(current);
  };

  try {
    await loadMaps();
    el.innerHTML = "";
    const start = initial || NAIROBI;
    map = L.map(el, { center: [start.lat, start.lng], zoom: initial ? 16 : 11, minZoom: 5, maxBounds: KENYA_BOUNDS });
    addBaseLayers(map, { satellite: true });
    map.on("click", (e) => set({ lat: e.latlng.lat, lng: e.latlng.lng }));
    settle(map);
  } catch (e) {
    explainMapError(el);
    el.querySelector(".map-msg span")?.insertAdjacentText("beforeend", " You can still use “my location” to set the land's position.");
  }
  if (initial) set(initial);

  return {
    get: () => current,
    set,
    locate: async () => {
      const p = await getMyLocation();
      set(p, { zoom: 17 });
      return p;
    },
    search: async (q) => {
      if (!map) throw new Error("Map isn't available.");
      const r = await geocode(q);
      if (!r) throw new Error(`Couldn't find "${q}"`);
      map.fitBounds(r.bounds, { maxZoom: 16 });
      toast("Now tap the exact spot of the land", "info");
    }
  };
}

// ---------- Detail mini map ----------
let detailMap = null;
async function renderDetailMap(l) {
  const el = $("#detailMap");
  if (!el) return;
  try {
    await loadMaps();
  } catch (e) {
    explainMapError(el);
    return;
  }
  if (detailMap) { detailMap.remove(); detailMap = null; }
  if (!document.body.contains(el)) return;
  const pos = [l.latitude, l.longitude];
  detailMap = L.map(el, {
    center: pos, zoom: 15, zoomControl: false, dragging: false, touchZoom: false,
    scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
  });
  addBaseLayers(detailMap, { satellite: true, control: false });
  L.marker(pos, { icon: dropPin(), interactive: false }).addTo(detailMap);
  detailMap.on("click", () => focusOnMap(l));
  settle(detailMap);
}

// ---------- Theme ----------
function applyMapTheme() {
  const road = exploreMap?.__road;
  if (!road) return;
  // Re-point the "Map" layer in place, so the Map/Satellite switcher and the user's choice survive.
  const t = TILES[isDark() ? "dark" : "streets"];
  const wasOn = exploreMap.hasLayer(road);
  if (wasOn) exploreMap.removeLayer(road);
  L.setOptions(road, t.options);
  road.setUrl(t.url, true);
  if (wasOn) road.addTo(exploreMap);
}

// ---------- Init ----------
export function initMap() {
  onTabShow("explore", initExplore);
  document.addEventListener("listings-loaded", () => { pendingFit = true; refreshMarkers(); });
  document.addEventListener("filters-changed", () => { pendingFit = true; refreshMarkers(); });
  document.addEventListener("detail-rendered", (e) => renderDetailMap(e.detail));
  document.addEventListener("theme-changed", applyMapTheme);

  $("#mapSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#mapSearchInput").blur();
    searchExplore($("#mapSearchInput").value);
  });

  registerActions({
    myLocation: () => (exploreMap ? locateMe() : toast("Map isn't loaded yet", "info")),
    closePreview: () => hidePreview()
  });
  $("#mapPreview").addEventListener("click", (e) => {
    if (e.target.closest("[data-action]")) return;
    const id = $("#mapPreview").dataset.id;
    if (id) openDetail(id);
  });
}
