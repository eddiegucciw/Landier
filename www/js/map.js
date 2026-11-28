// map.js — MapLibre GL JS (WebGL) maps on free OpenStreetMap data, no API keys.
//  • Explore: 3D globe, terrain, 3D buildings, satellite (Sentinel-2) with readable labels,
//    clustered price markers, indicative property boundaries, place search, GPS.
//  • Listing form: location pin + boundary drawing (add / move / remove points, live area).
//  • Listing detail: small map with pin + boundary.
// Data sources are configured in config.js (MAP_CONFIG) so they can be self-hosted later.
import { MAP_CONFIG, NAIROBI, SUPPORT_EMAIL, COUNTIES } from "./config.js";
import { state } from "./state.js";
import { $, esc, safeImg, formatKsh, shortKsh, toast, registerActions, onTabShow, switchTab, closeAllOverlays } from "./ui.js";
import { filteredListings, listingLocation, openDetail, loadListings } from "./listings.js";

const KENYA_BOUNDS = [[33.0, -5.5], [42.8, 6.0]]; // [west,south],[east,north]
const KENYA_VIEW = { center: [37.9, 0.2], zoom: 5.2 };

// ---------- Library loading (bundled copy first, CDN fallback) ----------
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

export function webglSupported() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (_) { return false; }
}

let libPromise = null;
export function loadMaps() {
  libPromise ||= (async () => {
    if (!webglSupported()) throw new Error("NO_WEBGL");
    addCss("vendor/maplibre/maplibre-gl.css", "https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css");
    if (!window.maplibregl) {
      try { await addScript("vendor/maplibre/maplibre-gl.js"); }
      catch (_) {
        try { await addScript("https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"); }
        catch (e) { libPromise = null; throw new Error("LOAD_FAILED"); }
      }
    }
    return window.maplibregl;
  })();
  return libPromise;
}

function mapMessage(el, title, text, extra = "") {
  if (!el) return;
  el.innerHTML = `<div class="map-msg"><i class="icon-map-pin-off"></i><b>${esc(title)}</b><span>${esc(text)}</span>${extra}</div>`;
}
function explainMapError(el, e) {
  if (e?.message === "NO_WEBGL") mapMessage(el, "Map not supported", "This device can't display interactive maps (WebGL is unavailable).");
  else if (!navigator.onLine) mapMessage(el, "You're offline", "Connect to the internet to load the map.");
  else mapMessage(el, "Couldn't load the map", "Check your connection and try again.");
}

// 3D by default unless the device looks low-powered; the user's choice is remembered.
function prefers3D() {
  try {
    const v = localStorage.getItem("landier-map3d");
    if (v !== null) return v === "1";
  } catch (_) {}
  const mem = navigator.deviceMemory;
  return !(mem && mem < 4);
}
function savePref(key, val) { try { localStorage.setItem(key, val); } catch (_) {} }
function prefersSatellite() { try { return localStorage.getItem("landier-mapsat") === "1"; } catch (_) { return false; } }

// ---------- Geometry helpers ----------
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h))) / 1000;
}
// Geodesic polygon area (m²) on a sphere.
export function polygonAreaSqm(points) {
  if (!points || points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    total += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((total * R * R) / 2);
}
export function formatArea(sqm) {
  if (!sqm) return "";
  const acres = sqm / 4046.8564;
  const ha = sqm / 10000;
  if (acres < 1) return `${Math.round(sqm).toLocaleString("en-KE")} m² · ${acres.toFixed(2)} acres`;
  return `${acres.toFixed(2)} acres · ${ha.toFixed(2)} ha`;
}
function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
export function validateBoundary(points) {
  if (!points || points.length === 0) return null;
  if (points.length < 3) return "A boundary needs at least 3 points.";
  if (points.length > 60) return "A boundary can have at most 60 points.";
  for (const p of points) {
    if (!(p.lat >= -5.5 && p.lat <= 6 && p.lng >= 33 && p.lng <= 42.5)) return "Boundary points must be inside Kenya.";
  }
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      if (segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return "The boundary lines cross each other. Move or remove a point.";
    }
  }
  if (polygonAreaSqm(points) > 5e8) return "That boundary is too large (over 50,000 ha).";
  return null;
}
// Firestore can't store nested arrays, so boundaries are saved as {points:[{lat,lng}]}
// and converted to GeoJSON here.
export function boundaryToGeoJSON(points, props = {}) {
  const ring = points.map((p) => [p.lng, p.lat]);
  ring.push(ring[0]);
  return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } };
}
const fc = (features) => ({ type: "FeatureCollection", features });

// ---------- Geocoding ----------
const geoCache = new Map();
export function parseCoordinates(q) {
  const m = String(q).trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
export async function geocode(q, limit = 5) {
  const coords = parseCoordinates(q);
  if (coords) return [{ location: coords, label: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, bounds: null, kind: "Coordinates" }];
  const key = q.trim().toLowerCase() + "|" + limit;
  if (geoCache.has(key)) return geoCache.get(key);
  const url = MAP_CONFIG.geocoderUrl + "?" + new URLSearchParams({
    q, format: "jsonv2", countrycodes: "ke", limit: String(limit), "accept-language": "en", email: SUPPORT_EMAIL
  });
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const hits = await res.json();
    const out = hits.map((h) => {
      const [s, n, w, e] = h.boundingbox.map(Number);
      return {
        location: { lat: Number(h.lat), lng: Number(h.lon) },
        bounds: [[w, s], [e, n]],
        label: h.display_name,
        kind: (h.addresstype || h.type || "").replace(/_/g, " ")
      };
    });
    geoCache.set(key, out);
    return out;
  } catch (e) {
    console.warn("geocode failed", e);
    return [];
  }
}
export function shortLabel(label) {
  return String(label || "").split(",").slice(0, 2).join(",").trim();
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

// ---------- Shared style setup: labels, terrain, satellite, buildings ----------
// Prefer English names, falling back to the local / Latin name, for every label that shows a name.
const NAME_EXPR = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
function usesName(expr) { return JSON.stringify(expr || "").includes("name"); }

function prepareStyle(map, { satellite = false } = {}) {
  const style = map.getStyle();
  const layers = style.layers || [];
  const firstSymbol = layers.find((l) => l.type === "symbol")?.id;

  // 1) Labels: English-first names, collision handling kept, readable halos.
  map.__symbolLayers = [];
  for (const l of layers) {
    if (l.type !== "symbol") continue;
    const tf = l.layout?.["text-field"];
    if (!tf) continue;
    if (usesName(tf) && !/shield|ref|housenum/i.test(l.id)) {
      try { map.setLayoutProperty(l.id, "text-field", NAME_EXPR); } catch (_) {}
    }
    map.__symbolLayers.push({
      id: l.id,
      color: l.paint?.["text-color"] ?? "#333",
      halo: l.paint?.["text-halo-color"] ?? "#fff",
      haloWidth: l.paint?.["text-halo-width"] ?? 1
    });
  }

  // 2) Satellite imagery, inserted below roads and labels so place names stay on top.
  const roadLayer = layers.find((l) => l.type === "line" && /^(tunnel|road|bridge|highway|transportation)/i.test(l.id))?.id;
  if (!map.getSource("satellite")) {
    map.addSource("satellite", {
      type: "raster", tiles: [MAP_CONFIG.satelliteTiles], tileSize: 256,
      maxzoom: MAP_CONFIG.satelliteMaxZoom, attribution: MAP_CONFIG.satelliteAttribution
    });
    map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" },
      paint: { "raster-fade-duration": 150 } }, roadLayer || firstSymbol);
  }
  // Flat fills drawn above the imagery (buildings, landuse) get hidden in satellite mode.
  const satIdx = map.getStyle().layers.findIndex((l) => l.id === "satellite");
  map.__fillsAboveSat = map.getStyle().layers.slice(satIdx + 1).filter((l) => l.type === "fill").map((l) => l.id);

  // 3) Terrain (elevation) + hillshade.
  if (!map.getSource("terrain")) {
    map.addSource("terrain", { type: "raster-dem", tiles: [MAP_CONFIG.terrainTiles], encoding: "terrarium",
      tileSize: 256, maxzoom: 15, attribution: MAP_CONFIG.terrainAttribution });
    map.addSource("hillshade-dem", { type: "raster-dem", tiles: [MAP_CONFIG.terrainTiles], encoding: "terrarium",
      tileSize: 256, maxzoom: 15 });
    map.addLayer({ id: "hillshade", type: "hillshade", source: "hillshade-dem", layout: { visibility: "none" },
      paint: { "hillshade-shadow-color": "#473B24", "hillshade-exaggeration": 0.35 } }, roadLayer || firstSymbol);
  }

  // 4) 3D buildings from OpenStreetMap, always below labels so names are never hidden.
  let ext = layers.find((l) => l.type === "fill-extrusion")?.id;
  if (!ext) {
    const b = layers.find((l) => l["source-layer"] === "building");
    if (b) {
      map.addLayer({
        id: "landier-3d-buildings", type: "fill-extrusion", source: b.source, "source-layer": "building", minzoom: 14,
        paint: {
          "fill-extrusion-color": "#d8d2c9",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
          "fill-extrusion-opacity": 0.85
        }
      }, firstSymbol);
      ext = "landier-3d-buildings";
    }
  } else if (firstSymbol) {
    try { map.moveLayer(ext, firstSymbol); } catch (_) {}
  }
  map.__extrusion = ext;
  map.__flatBuildings = layers.filter((l) => l.type === "fill" && (l["source-layer"] === "building" || /building/i.test(l.id))).map((l) => l.id);
  map.__firstSymbol = firstSymbol;
  setSatellite(map, satellite);
}

function setVis(map, id, on) {
  if (id && map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

function setSatellite(map, on) {
  map.__satellite = on;
  setVis(map, "satellite", on);
  (map.__fillsAboveSat || []).forEach((id) => setVis(map, id, !on));
  if (map.__extrusion && map.getLayer(map.__extrusion)) {
    try { map.setPaintProperty(map.__extrusion, "fill-extrusion-opacity", on ? 0.55 : 0.85); } catch (_) {}
  }
  // Labels: white text with a dark halo over imagery; original colours on the street map.
  for (const s of map.__symbolLayers || []) {
    try {
      map.setPaintProperty(s.id, "text-color", on ? "#ffffff" : s.color);
      map.setPaintProperty(s.id, "text-halo-color", on ? "rgba(0,0,0,0.85)" : s.halo);
      map.setPaintProperty(s.id, "text-halo-width", on ? 1.6 : s.haloWidth);
    } catch (_) {}
  }
}

function set3D(map, on, { animate = true } = {}) {
  map.__3d = on;
  try {
    map.setTerrain(on ? { source: "terrain", exaggeration: 1.4 } : null);
  } catch (e) { console.warn("terrain", e); }
  setVis(map, "hillshade", on);
  setVis(map, map.__extrusion, on);
  (map.__flatBuildings || []).forEach((id) => setVis(map, id, !on && !map.__satellite));
  try {
    map.setProjection({ type: on ? "globe" : "mercator" });
  } catch (_) {}
  try {
    if (on && map.setSky) map.setSky({ "sky-color": "#7FB8E6", "horizon-color": "#DDEFF8", "fog-color": "#F3F6F9", "sky-horizon-blend": 0.5, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0] });
  } catch (_) {}
  const pitch = on ? Math.max(map.getPitch(), map.getZoom() >= 12 ? 60 : 45) : 0;
  if (animate) map.easeTo({ pitch, bearing: on ? map.getBearing() : 0, duration: 800 });
  else map.jumpTo({ pitch });
}

function createMap(el, opts = {}) {
  const map = new maplibregl.Map({
    container: el,
    style: MAP_CONFIG.styleUrl,
    center: opts.center || [NAIROBI.lng, NAIROBI.lat],
    zoom: opts.zoom ?? 10,
    pitch: opts.pitch ?? 0,
    maxPitch: 80,
    attributionControl: { compact: true },
    interactive: opts.interactive !== false,
    cooperativeGestures: false,
    fadeDuration: 150,
    ...opts.extra
  });
  map.on("error", (e) => console.warn("map error", e?.error?.message || e));
  return map;
}

function onStyle(map, fn) {
  if (map.isStyleLoaded()) fn();
  else map.once("style.load", fn);
}

// Leaflet-style resize after overlays slide in.
function settle(map) {
  setTimeout(() => map.resize(), 60);
  setTimeout(() => map.resize(), 380);
}

// MapLibre positions markers by setting `transform` on the marker element, so pin shapes live
// in an inner element and the outer wrapper is what MapLibre moves.
function pinWrap(innerClass) {
  const w = document.createElement("div");
  w.className = "pin-wrap";
  w.innerHTML = `<div class="${innerClass}"></div>`;
  return w;
}

// ---------- Map mode controls (2D/3D, Map/Satellite) ----------
function modeButtons(map, container, { onChange } = {}) {
  container.innerHTML = `
    <button type="button" class="map-btn" data-mode="3d" aria-label="Toggle 3D">${map.__3d ? "2D" : "3D"}</button>
    <button type="button" class="map-btn" data-mode="sat" aria-label="Toggle satellite"><i class="${map.__satellite ? "icon-map" : "icon-satellite"}"></i></button>`;
  container.onclick = (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.mode === "3d") set3D(map, !map.__3d);
    else setSatellite(map, !map.__satellite);
    if (onChange) onChange();
    modeButtons(map, container, { onChange });
  };
}

// ---------- Explore map ----------
let exploreMap = null;
let exploreReady = false;
let geolocate = null;
let searchMarker = null;
const htmlMarkers = new Map(); // listing id -> maplibregl.Marker
let activeId = null;

function listingFeatures() {
  return filteredListings()
    .filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.longitude, l.latitude] },
      properties: { id: l.id, price: l.price, label: shortKsh(l.price) }
    }));
}
function boundaryFeatures() {
  return filteredListings()
    .filter((l) => Array.isArray(l.boundary?.points) && l.boundary.points.length >= 3)
    .map((l) => boundaryToGeoJSON(l.boundary.points, { id: l.id }));
}

function addListingLayers(map) {
  map.addSource("listings", { type: "geojson", data: fc(listingFeatures()), cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
  map.addSource("boundaries", { type: "geojson", data: fc(boundaryFeatures()) });
  map.addLayer({ id: "boundary-fill", type: "fill", source: "boundaries", minzoom: 11,
    paint: { "fill-color": "#10B981", "fill-opacity": 0.18 } });
  map.addLayer({ id: "boundary-line", type: "line", source: "boundaries", minzoom: 11,
    paint: { "line-color": "#10B981", "line-width": 2.5, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "clusters", type: "circle", source: "listings", filter: ["has", "point_count"],
    paint: {
      "circle-color": "#10B981", "circle-opacity": 0.9, "circle-stroke-color": "#fff", "circle-stroke-width": 3,
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 30]
    } });
  map.addLayer({ id: "cluster-count", type: "symbol", source: "listings", filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true },
    paint: { "text-color": "#fff" } });

  map.on("click", "clusters", async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    try {
      const zoom = await map.getSource("listings").getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.5 });
    } catch (_) { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }); }
  });
  map.on("click", "boundary-fill", (e) => {
    const id = e.features?.[0]?.properties?.id;
    const l = id && state.listingById.get(id);
    if (l) selectListing(l);
  });
  ["clusters", "boundary-fill"].forEach((id) => {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  });
  // Price pins for unclustered listings as HTML markers (crisp text, easy taps).
  let raf = 0;
  const sync = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => syncMarkers(map)); };
  map.on("render", () => { if (map.isSourceLoaded?.("listings")) sync(); });
  map.on("moveend", sync);
  map.on("sourcedata", (e) => { if (e.sourceId === "listings" && e.isSourceLoaded) sync(); });
}

function pinEl(l, active) {
  const el = document.createElement("div");
  el.className = "pin-wrap" + (active ? " active" : "");
  el.innerHTML = `<div class="price-pin"><b>${esc(shortKsh(l.price))}</b>${l.size ? `<small>${esc(l.size)}</small>` : ""}</div>`;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `${l.title}, ${formatKsh(l.price)}`);
  el.addEventListener("click", (ev) => { ev.stopPropagation(); selectListing(l); });
  return el;
}

function syncMarkers(map) {
  const seen = new Set();
  let feats = [];
  try { feats = map.querySourceFeatures("listings", { filter: ["!", ["has", "point_count"]] }); } catch (_) {}
  for (const f of feats) {
    const id = f.properties?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!htmlMarkers.has(id)) {
      const l = state.listingById.get(id);
      if (!l) continue;
      const m = new maplibregl.Marker({ element: pinEl(l, id === activeId), anchor: "bottom" })
        .setLngLat(f.geometry.coordinates).addTo(map);
      htmlMarkers.set(id, m);
    }
  }
  for (const [id, m] of htmlMarkers) {
    if (!seen.has(id)) { m.remove(); htmlMarkers.delete(id); }
  }
}

function refreshListingData() {
  if (!exploreMap || !exploreReady) return;
  exploreMap.getSource("listings")?.setData(fc(listingFeatures()));
  exploreMap.getSource("boundaries")?.setData(fc(boundaryFeatures()));
  for (const m of htmlMarkers.values()) m.remove();
  htmlMarkers.clear();
  syncMarkers(exploreMap);
  const n = listingFeatures().length;
  const count = $("#mapCount");
  count.hidden = !$("#mapPreview").hidden;
  count.textContent = `${n} listing${n === 1 ? "" : "s"} on map`;
}

function fitToListings() {
  const feats = listingFeatures();
  if (!exploreMap || !feats.length) return;
  const b = new maplibregl.LngLatBounds();
  feats.forEach((f) => b.extend(f.geometry.coordinates));
  exploreMap.fitBounds(b, { padding: 70, maxZoom: 13, duration: 900 });
}

function selectListing(l) {
  activeId = l.id;
  for (const [id, m] of htmlMarkers) m.getElement().classList.toggle("active", id === l.id);
  showPreview(l);
}

function showPreview(l) {
  const p = $("#mapPreview");
  const hasBoundary = Array.isArray(l.boundary?.points) && l.boundary.points.length >= 3;
  p.innerHTML = `
    <img src="${safeImg(l.coverThumb)}" alt="">
    <div class="mp-body">
      <div class="card-price">${formatKsh(l.price)}</div>
      <div class="card-title">${esc(l.title)}</div>
      <div class="card-loc"><i class="icon-map-pin"></i> ${esc(listingLocation(l))}</div>
      <div class="mp-tags">
        ${l.size ? `<span class="card-size">${esc(l.size)}</span>` : ""}
        <span class="avail">Available</span>
        ${hasBoundary ? `<span class="card-size">Boundary</span>` : ""}
      </div>
    </div>
    <button class="mp-close" data-action="closePreview" aria-label="Close"><i class="icon-x"></i></button>`;
  p.dataset.id = l.id;
  p.hidden = false;
  $("#mapCount").hidden = true;
}

function hidePreview() {
  $("#mapPreview").hidden = true;
  activeId = null;
  for (const m of htmlMarkers.values()) m.getElement().classList.remove("active");
  if (exploreMap) $("#mapCount").hidden = false;
}

async function initExplore() {
  const el = $("#exploreMap");
  if (exploreMap) { exploreMap.resize(); refreshListingData(); return; }
  if (!state.listings.length) loadListings();
  try { await loadMaps(); }
  catch (e) { explainMapError(el, e); return; }
  el.innerHTML = "";
  exploreMap = createMap(el, { center: KENYA_VIEW.center, zoom: KENYA_VIEW.zoom, extra: { maxBounds: [[25, -15], [52, 15]] } });
  const map = exploreMap;
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 15000 }, trackUserLocation: true, showAccuracyCircle: true
  });
  map.addControl(geolocate, "top-right");
  geolocate.on("error", (e) => toast(e?.code === 1 ? "Location permission denied. Enable it in your phone settings." : "Couldn't get your location. Make sure GPS is on.", "error"));
  geolocate.on("geolocate", (pos) => { state.myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; });
  map.on("click", (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: ["clusters", "boundary-fill"].filter((id) => map.getLayer(id)) });
    if (!hits.length) hidePreview();
  });
  onStyle(map, () => {
    prepareStyle(map, { satellite: prefersSatellite() });
    addListingLayers(map);
    set3D(map, prefers3D(), { animate: false });
    modeButtons(map, $("#mapModes"), { onChange: () => { savePref("landier-map3d", map.__3d ? "1" : "0"); savePref("landier-mapsat", map.__satellite ? "1" : "0"); } });
    exploreReady = true;
    refreshListingData();
    if (!pendingFocus) fitToListings();
    else { const l = pendingFocus; pendingFocus = null; focusNow(l); }
  });
  settle(map);
}

// ---------- Search (explore) ----------
let suggestTimer = null;
function localSuggestions(q) {
  const ql = q.trim().toLowerCase();
  if (ql.length < 2) return [];
  const out = [];
  COUNTIES.filter((c) => c.toLowerCase().startsWith(ql)).slice(0, 3)
    .forEach((c) => out.push({ type: "place", label: `${c} County`, query: `${c} County, Kenya`, kind: "County" }));
  const seen = new Set();
  for (const l of state.listings) {
    if (out.length >= 7) break;
    const hay = `${l.title} ${l.town} ${l.county}`.toLowerCase();
    if (hay.includes(ql) && !seen.has(l.id) && Number.isFinite(l.latitude)) {
      seen.add(l.id);
      out.push({ type: "listing", id: l.id, label: l.title, kind: `${formatKsh(l.price)} · ${listingLocation(l)}` });
    }
  }
  return out;
}
function renderSuggestions(items, { note = "" } = {}) {
  const box = $("#mapSuggest");
  if (!items.length && !note) { box.hidden = true; box.innerHTML = ""; return; }
  box.innerHTML = items.map((s, i) => `
      <button type="button" class="sg" data-i="${i}">
        <i class="${s.type === "listing" ? "icon-land-plot" : "icon-map-pin"}"></i>
        <span><b>${esc(s.label)}</b><small>${esc(s.kind || "")}</small></span>
      </button>`).join("") + (note ? `<div class="sg-note">${esc(note)}</div>` : "");
  box.hidden = false;
  box.onclick = (e) => {
    const b = e.target.closest(".sg");
    if (!b) return;
    chooseSuggestion(items[Number(b.dataset.i)]);
  };
}
async function chooseSuggestion(s) {
  $("#mapSuggest").hidden = true;
  $("#mapSearchInput").blur();
  if (s.type === "listing") {
    const l = state.listingById.get(s.id);
    if (l) focusNow(l);
    return;
  }
  if (s.type === "result") return showSearchResult(s.result);
  const [r] = await geocode(s.query, 1);
  if (r) showSearchResult(r);
  else toast(`Couldn't find "${s.label}"`, "error");
}
function showSearchResult(r) {
  if (!exploreMap) return;
  const pos = [r.location.lng, r.location.lat];
  if (!searchMarker) {
    searchMarker = new maplibregl.Marker({ element: pinWrap("drop-pin search"), anchor: "bottom" });
  }
  searchMarker.setLngLat(pos)
    .setPopup(new maplibregl.Popup({ offset: 32, closeButton: false, className: "search-label" }).setText(shortLabel(r.label)))
    .addTo(exploreMap);
  searchMarker.togglePopup();
  if (!searchMarker.getPopup().isOpen()) searchMarker.togglePopup();
  if (r.bounds) exploreMap.fitBounds(r.bounds, { padding: 60, maxZoom: 16, duration: 1200 });
  else exploreMap.flyTo({ center: pos, zoom: 16, duration: 1200 });
}
async function searchExplore(q) {
  q = q.trim();
  if (!q || !exploreMap) return;
  const results = await geocode(q, 5);
  if (results.length === 1) return showSearchResult(results[0]);
  if (results.length > 1) {
    return renderSuggestions(results.map((r) => ({ type: "result", result: r, label: shortLabel(r.label), kind: r.kind })), { note: "Choose a place" });
  }
  const locals = localSuggestions(q).filter((s) => s.type === "listing");
  if (locals.length) return chooseSuggestion(locals[0]);
  toast(`Couldn't find "${q}"`, "error");
}

// ---------- Focus a listing on the explore map ----------
let pendingFocus = null;
function focusNow(l) {
  exploreMap.flyTo({ center: [l.longitude, l.latitude], zoom: 16, pitch: exploreMap.__3d ? 60 : 0, duration: 1400 });
  selectListing(l);
}
export function focusOnMap(l) {
  if (!Number.isFinite(l?.latitude)) return;
  closeAllOverlays({ rewind: true });
  setTimeout(() => {
    switchTab("explore");
    if (exploreReady) focusNow(l);
    else pendingFocus = l;
  }, 80);
}

// ---------- Route (only when a routing server is configured) ----------
export function routingAvailable() { return !!MAP_CONFIG.routingUrl; }
export async function showRoute(l, mode = "driving") {
  if (!routingAvailable()) return false;
  let me;
  try { me = await getMyLocation(); } catch (e) { toast(e.message, "error"); return false; }
  const url = `${MAP_CONFIG.routingUrl.replace(/\/$/, "")}/route/v1/${mode === "walking" ? "foot" : "driving"}/${me.lng},${me.lat};${l.longitude},${l.latitude}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) throw new Error("No route found");
    focusOnMap(l);
    const draw = () => {
      if (!exploreReady) return setTimeout(draw, 300);
      const src = exploreMap.getSource("route");
      const feature = { type: "Feature", properties: {}, geometry: route.geometry };
      if (src) src.setData(feature);
      else {
        exploreMap.addSource("route", { type: "geojson", data: feature });
        exploreMap.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#3B82F6", "line-width": 6, "line-opacity": 0.85 } }, exploreMap.__firstSymbol);
      }
      const b = new maplibregl.LngLatBounds();
      route.geometry.coordinates.forEach((c) => b.extend(c));
      exploreMap.fitBounds(b, { padding: 70, duration: 1000 });
      toast(`${(route.distance / 1000).toFixed(1)} km · about ${Math.round(route.duration / 60)} min`, "success");
    };
    draw();
    return true;
  } catch (e) {
    toast("Couldn't calculate a route right now", "error");
    return false;
  }
}

// ---------- Location picker + boundary drawing (listing form) ----------
export async function createPicker(el, initial, onChange, opts = {}) {
  let map = null;
  let pin = null;
  let current = initial ? { lat: Number(initial.lat), lng: Number(initial.lng) } : null;
  let mode = "pin";
  let points = (opts.boundary || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  let vertexMarkers = [];
  const onBoundary = opts.onBoundary || (() => {});

  const emitBoundary = () => onBoundary(points.slice(), polygonAreaSqm(points), validateBoundary(points));

  const drawBoundary = () => {
    if (!map || !map.getSource("draw")) return;
    drawBoundaryShapeOnly();
    vertexMarkers.forEach((m) => m.remove());
    vertexMarkers = points.map((p, i) => {
      const v = document.createElement("div");
      v.className = "vertex" + (mode === "boundary" ? "" : " passive");
      v.textContent = String(i + 1);
      const m = new maplibregl.Marker({ element: v, draggable: mode === "boundary" }).setLngLat([p.lng, p.lat]).addTo(map);
      let dragged = false;
      m.on("dragstart", () => { dragged = true; });
      m.on("drag", () => { const ll = m.getLngLat(); points[i] = { lat: ll.lat, lng: ll.lng }; drawBoundaryShapeOnly(); });
      m.on("dragend", () => { emitBoundary(); setTimeout(() => (dragged = false), 0); });
      v.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (dragged || mode !== "boundary") return;
        points.splice(i, 1); // tap a point to remove it
        drawBoundary(); emitBoundary();
      });
      return m;
    });
  };
  const drawBoundaryShapeOnly = () => {
    const feats = [];
    if (points.length >= 3) feats.push(boundaryToGeoJSON(points));
    else if (points.length === 2) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) } });
    map.getSource("draw")?.setData(fc(feats));
  };

  // Insert a new point into the nearest edge (so tapping near an edge refines it).
  const addPoint = (p) => {
    if (points.length >= 60) return toast("Maximum 60 points", "error");
    if (points.length < 3) { points.push(p); return; }
    let best = points.length, bestCost = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const cost = haversineKm(a, p) + haversineKm(p, b) - haversineKm(a, b);
      if (cost < bestCost) { bestCost = cost; best = i + 1; }
    }
    points.splice(best, 0, p);
  };

  const setPin = (pos, { fly = false, zoom = null } = {}) => {
    current = { lat: Number(pos.lat), lng: Number(pos.lng) };
    if (map) {
      if (!pin) {
        pin = new maplibregl.Marker({ element: pinWrap("drop-pin"), anchor: "bottom", draggable: true }).setLngLat([current.lng, current.lat]).addTo(map);
        pin.on("dragend", () => { const ll = pin.getLngLat(); setPin({ lat: ll.lat, lng: ll.lng }); });
      } else pin.setLngLat([current.lng, current.lat]);
      if (fly) map.flyTo({ center: [current.lng, current.lat], zoom: zoom || Math.max(map.getZoom(), 16), duration: 900 });
    }
    onChange(current);
  };

  try {
    await loadMaps();
    el.innerHTML = "";
    const start = initial || NAIROBI;
    map = createMap(el, { center: [start.lng, start.lat], zoom: initial ? 16 : 11 });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("click", (e) => {
      const p = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (mode === "boundary") { addPoint(p); drawBoundary(); emitBoundary(); }
      else setPin(p);
    });
    await new Promise((resolve) => onStyle(map, () => {
      prepareStyle(map, { satellite: true });
      set3D(map, false, { animate: false });
      map.addSource("draw", { type: "geojson", data: fc([]) });
      map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#F59E0B", "fill-opacity": 0.25 } });
      map.addLayer({ id: "draw-line", type: "line", source: "draw",
        paint: { "line-color": "#F59E0B", "line-width": 3 } });
      if (opts.modesEl) modeButtons(map, opts.modesEl);
      resolve();
    }));
    settle(map);
    if (current) setPin(current);
    if (points.length) { drawBoundary(); emitBoundary(); }
  } catch (e) {
    explainMapError(el, e);
    el.querySelector(".map-msg span")?.insertAdjacentText("beforeend", " You can still use “my location” to set the land's position.");
    if (current) onChange(current);
  }

  return {
    get: () => current,
    getBoundary: () => points.slice(),
    setMode(m) {
      mode = m;
      if (map) drawBoundary();
      if (m === "boundary" && map && points.length === 0 && current) map.flyTo({ center: [current.lng, current.lat], zoom: Math.max(map.getZoom(), 17) });
    },
    undo() { points.pop(); if (map) drawBoundary(); emitBoundary(); },
    clear() { points = []; if (map) drawBoundary(); emitBoundary(); },
    locate: async () => {
      const p = await getMyLocation();
      setPin(p, { fly: true, zoom: 17 });
      return p;
    },
    search: async (q) => {
      if (!map) throw new Error("Map isn't available.");
      const [r] = await geocode(q, 1);
      if (!r) throw new Error(`Couldn't find "${q}"`);
      if (r.bounds) map.fitBounds(r.bounds, { padding: 30, maxZoom: 17, duration: 900 });
      setPin(r.location, { fly: !r.bounds, zoom: 17 });
      toast(`Pin placed at ${shortLabel(r.label) || q} — drag it to the exact spot`, "success");
    },
    destroy() { try { map?.remove(); } catch (_) {} map = null; }
  };
}

// ---------- Detail mini map ----------
let detailMap = null;
async function renderDetailMap(l) {
  const el = $("#detailMap");
  if (!el) return;
  if (detailMap) { try { detailMap.remove(); } catch (_) {} detailMap = null; }
  try { await loadMaps(); }
  catch (e) { explainMapError(el, e); return; }
  if (!document.body.contains(el)) return;
  el.innerHTML = "";
  const pos = [l.longitude, l.latitude];
  const map = createMap(el, { center: pos, zoom: 15.5, interactive: false });
  detailMap = map;
  onStyle(map, () => {
    prepareStyle(map, { satellite: true });
    set3D(map, false, { animate: false });
    const pts = l.boundary?.points;
    if (Array.isArray(pts) && pts.length >= 3) {
      map.addSource("b", { type: "geojson", data: boundaryToGeoJSON(pts) });
      map.addLayer({ id: "b-fill", type: "fill", source: "b", paint: { "fill-color": "#10B981", "fill-opacity": 0.25 } });
      map.addLayer({ id: "b-line", type: "line", source: "b", paint: { "line-color": "#10B981", "line-width": 2.5 } });
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p.lng, p.lat]));
      map.fitBounds(b, { padding: 30, maxZoom: 18, duration: 0 });
    }
  });
  new maplibregl.Marker({ element: pinWrap("drop-pin"), anchor: "bottom" }).setLngLat(pos).addTo(map);
  el.onclick = () => focusOnMap(l);
  settle(map);
}

// ---------- Init ----------
export function initMap() {
  onTabShow("explore", initExplore);
  document.addEventListener("listings-loaded", () => { refreshListingData(); });
  document.addEventListener("filters-changed", () => { refreshListingData(); fitToListings(); });
  document.addEventListener("detail-rendered", (e) => renderDetailMap(e.detail));
  document.addEventListener("detail-closed", () => { if (detailMap) { try { detailMap.remove(); } catch (_) {} detailMap = null; } });

  const input = $("#mapSearchInput");
  input.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => renderSuggestions(localSuggestions(input.value), { note: input.value.trim().length >= 2 ? "Press search to look up any place in Kenya" : "" }), 250);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#tab-explore .map-top")) $("#mapSuggest").hidden = true;
  });
  $("#mapSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    input.blur();
    $("#mapSuggest").hidden = true;
    searchExplore(input.value);
  });

  registerActions({
    myLocation: () => {
      if (!exploreMap || !geolocate) return toast("Map isn't loaded yet", "info");
      geolocate.trigger();
    },
    closePreview: () => hidePreview()
  });
  $("#mapPreview").addEventListener("click", (e) => {
    if (e.target.closest("[data-action]")) return;
    const id = $("#mapPreview").dataset.id;
    if (id) openDetail(id);
  });
}
