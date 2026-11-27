// map.js — Google Maps: explore map with price pins + clustering, search, my location,
// location picker for sellers, and the mini map on the listing detail page.
import { MAPS_API_KEY, NAIROBI } from "./config.js";
import { state } from "./state.js";
import { $, esc, safeImg, formatKsh, shortKsh, toast, registerActions, onTabShow, switchTab, closeAllOverlays } from "./ui.js";
import { filteredListings, listingLocation, openDetail, loadListings } from "./listings.js";

const KENYA_BOUNDS = { north: 5.6, south: -4.9, west: 33.5, east: 42.2 };
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] }
];

let mapsPromise = null;
let authFailed = false;

export function mapsConfigured() {
  return typeof MAPS_API_KEY === "string" && MAPS_API_KEY.length > 20 && !MAPS_API_KEY.startsWith("__");
}

function mapMessage(el, title, text) {
  if (!el) return;
  el.innerHTML = `<div class="map-msg"><i class="icon-map-pin-off"></i><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}

const NO_KEY_TEXT = "Maps aren't configured in this build. Add the MAPS_API_KEY secret in GitHub and rebuild.";
const AUTH_FAIL_TEXT = "Google Maps rejected the API key. Check the key's restrictions and that the Maps JavaScript API is enabled.";

export function loadMaps() {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (!mapsConfigured()) return Promise.reject(new Error("NO_KEY"));
  if (authFailed) return Promise.reject(new Error("AUTH_FAILED"));
  if (!navigator.onLine) return Promise.reject(new Error("OFFLINE"));
  mapsPromise ||= new Promise((resolve, reject) => {
    window.__landierMapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => {
      authFailed = true;
      document.querySelectorAll(".map").forEach((el) => mapMessage(el, "Map unavailable", AUTH_FAIL_TEXT));
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_API_KEY)}&v=weekly&loading=async&region=KE&language=en&callback=__landierMapsReady`;
    s.async = true;
    s.onerror = () => { mapsPromise = null; reject(new Error("LOAD_FAILED")); };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

function explainMapError(el, e) {
  const msg = e?.message;
  if (msg === "NO_KEY") mapMessage(el, "Map not configured", NO_KEY_TEXT);
  else if (msg === "AUTH_FAILED") mapMessage(el, "Map unavailable", AUTH_FAIL_TEXT);
  else if (msg === "OFFLINE") mapMessage(el, "You're offline", "Connect to the internet to load the map.");
  else mapMessage(el, "Couldn't load the map", "Check your connection and try again.");
}

function isDark() { return document.documentElement.dataset.theme === "dark"; }

function pillIcon(text, active = false) {
  const w = Math.max(44, 18 + text.length * 8);
  const fill = active ? "#047857" : "#10B981";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="32" viewBox="0 0 ${w} 32">
    <rect x="1" y="1" rx="13" ry="13" width="${w - 2}" height="25" fill="${fill}" stroke="#fff" stroke-width="2"/>
    <path d="M${w / 2 - 5} 25 L${w / 2} 31 L${w / 2 + 5} 25Z" fill="${fill}"/>
    <text x="${w / 2}" y="18" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(w, 32),
    anchor: new google.maps.Point(w / 2, 32)
  };
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

// ---------- Geocoding (with listing-name fallback) ----------
let geocoder;
export async function geocode(q) {
  await loadMaps();
  geocoder ||= new google.maps.Geocoder();
  try {
    const { results } = await geocoder.geocode({ address: q, componentRestrictions: { country: "KE" } });
    if (results?.length) {
      const g = results[0].geometry;
      return { location: g.location.toJSON(), viewport: g.viewport, label: results[0].formatted_address };
    }
  } catch (e) {
    console.warn("geocode failed (is the Geocoding API enabled?)", e);
  }
  return null;
}

// ---------- Explore map ----------
let exploreMap = null;
let markers = [];
let clusterer = null;
let userDot = null;
let activeMarker = null;
let pendingFit = true;
let exploreReady = false;

function loadClusterer() {
  if (window.markerClusterer) return Promise.resolve(window.markerClusterer);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js";
    s.onload = () => resolve(window.markerClusterer || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

async function initExplore() {
  const el = $("#exploreMap");
  if (exploreMap) { refreshMarkers(); return; }
  if (!state.listings.length) loadListings();
  try {
    await loadMaps();
  } catch (e) {
    explainMapError(el, e);
    return;
  }
  exploreMap = new google.maps.Map(el, {
    center: NAIROBI, zoom: 7,
    disableDefaultUI: true, zoomControl: true, mapTypeControl: true,
    mapTypeControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM, mapTypeIds: ["roadmap", "hybrid"] },
    gestureHandling: "greedy", clickableIcons: false,
    restriction: { latLngBounds: KENYA_BOUNDS, strictBounds: false },
    styles: isDark() ? DARK_STYLE : null
  });
  exploreMap.addListener("click", hidePreview);
  const mc = await loadClusterer();
  if (mc?.MarkerClusterer) {
    clusterer = new mc.MarkerClusterer({ map: exploreMap, markers: [] });
  }
  refreshMarkers();
  exploreReady = true;
}

function refreshMarkers() {
  if (!exploreMap) return;
  const list = filteredListings().filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  if (clusterer) clusterer.clearMarkers();
  markers.forEach((m) => m.setMap(null));
  activeMarker = null;
  markers = list.map((l) => {
    const m = new google.maps.Marker({
      position: { lat: l.latitude, lng: l.longitude },
      icon: pillIcon(shortKsh(l.price)),
      title: l.title,
      map: clusterer ? null : exploreMap
    });
    m.addListener("click", () => {
      if (activeMarker && activeMarker !== m) activeMarker.setIcon(pillIcon(shortKsh(activeMarker.__l.price)));
      m.setIcon(pillIcon(shortKsh(l.price), true));
      m.setZIndex(999);
      activeMarker = m;
      showPreview(l);
    });
    m.__l = l;
    return m;
  });
  if (clusterer) clusterer.addMarkers(markers);
  const count = $("#mapCount");
  count.hidden = false;
  count.textContent = `${list.length} listing${list.length === 1 ? "" : "s"} on map`;
  hidePreview();
  if (pendingFit && markers.length) {
    const b = new google.maps.LatLngBounds();
    markers.forEach((m) => b.extend(m.getPosition()));
    exploreMap.fitBounds(b, 60);
    if (markers.length === 1) google.maps.event.addListenerOnce(exploreMap, "idle", () => exploreMap.setZoom(14));
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
  if (activeMarker) { activeMarker.setIcon(pillIcon(shortKsh(activeMarker.__l.price))); activeMarker = null; }
}

async function locateMe() {
  try {
    const pos = await getMyLocation();
    if (!exploreMap) return;
    if (!userDot) {
      userDot = new google.maps.Marker({
        map: exploreMap, position: pos, zIndex: 1000, title: "You are here",
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#3B82F6", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 }
      });
    } else userDot.setPosition(pos);
    exploreMap.panTo(pos);
    exploreMap.setZoom(13);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function searchExplore(q) {
  q = q.trim();
  if (!q || !exploreMap) return;
  const res = await geocode(q).catch(() => null);
  if (res) {
    if (res.viewport) exploreMap.fitBounds(res.viewport);
    else { exploreMap.panTo(res.location); exploreMap.setZoom(13); }
    return;
  }
  // Fallback: zoom to listings whose town/county matches.
  const ql = q.toLowerCase();
  const hits = markers.filter((m) => listingLocation(m.__l).toLowerCase().includes(ql));
  if (hits.length) {
    const b = new google.maps.LatLngBounds();
    hits.forEach((m) => b.extend(m.getPosition()));
    exploreMap.fitBounds(b, 80);
    if (hits.length === 1) exploreMap.setZoom(14);
  } else toast(`Couldn't find "${q}"`, "error");
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
      exploreMap.panTo({ lat: l.latitude, lng: l.longitude });
      exploreMap.setZoom(16);
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
        marker = new google.maps.Marker({ map, position: current, draggable: true });
        marker.addListener("dragend", () => set(marker.getPosition().toJSON()));
      } else marker.setPosition(current);
      if (pan) map.panTo(current);
      if (zoom) map.setZoom(zoom);
    }
    onChange(current);
  };

  try {
    await loadMaps();
    map = new google.maps.Map(el, {
      center: initial || NAIROBI, zoom: initial ? 16 : 11,
      mapTypeId: "hybrid", gestureHandling: "greedy", streetViewControl: false,
      fullscreenControl: true, clickableIcons: false,
      mapTypeControlOptions: { mapTypeIds: ["roadmap", "hybrid"] }
    });
    map.addListener("click", (e) => set(e.latLng.toJSON()));
  } catch (e) {
    explainMapError(el, e);
    el.querySelector(".map-msg span")?.insertAdjacentText("beforeend", " You can still use “my location” to set the land's position.");
  }
  if (initial) set(initial);

  return {
    get: () => current,
    set,
    locate: async () => {
      const p = await getMyLocation();
      set(p, { pan: true, zoom: 17 });
      return p;
    },
    search: async (q) => {
      if (!map) throw new Error("Map isn't available.");
      const r = await geocode(q);
      if (!r) throw new Error(`Couldn't find "${q}"`);
      if (r.viewport) map.fitBounds(r.viewport); else { map.panTo(r.location); map.setZoom(15); }
      toast("Now tap the exact spot of the land", "info");
    }
  };
}

// ---------- Detail mini map ----------
async function renderDetailMap(l) {
  const el = $("#detailMap");
  if (!el) return;
  try {
    await loadMaps();
  } catch (e) {
    explainMapError(el, e);
    return;
  }
  const pos = { lat: l.latitude, lng: l.longitude };
  const m = new google.maps.Map(el, {
    center: pos, zoom: 15, mapTypeId: "hybrid", disableDefaultUI: true,
    gestureHandling: "cooperative", clickableIcons: false
  });
  new google.maps.Marker({ map: m, position: pos });
  m.addListener("click", () => focusOnMap(l));
}

// ---------- Init ----------
export function initMap() {
  onTabShow("explore", initExplore);
  document.addEventListener("listings-loaded", () => { pendingFit = true; refreshMarkers(); });
  document.addEventListener("filters-changed", () => { pendingFit = true; refreshMarkers(); });
  document.addEventListener("detail-rendered", (e) => renderDetailMap(e.detail));
  document.addEventListener("theme-changed", () => exploreMap?.setOptions({ styles: isDark() ? DARK_STYLE : null }));

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
