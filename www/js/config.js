// config.js — app-wide configuration.
// The Firebase web config is safe to ship in a client app; access is controlled
// by firestore.rules. Restrict the API key to your app in Google Cloud Console.
export const firebaseConfig = {
  apiKey: "AIzaSyACuvTi-yMGkQ4nojapLYeJ8tOZlty2fpI",
  authDomain: "gumado.firebaseapp.com",
  projectId: "gumado",
  storageBucket: "gumado.firebasestorage.app",
  messagingSenderId: "220205636823",
  appId: "1:220205636823:web:e194c0bdf9f0e94dfe6492",
  measurementId: "G-P9B3XKTYDS"
};

// ---------- Maps (all free, no API keys) ----------
// Every URL below can be pointed at your own self-hosted server later without code changes.
export const MAP_CONFIG = {
  // OpenStreetMap vector tiles + style with labels and 3D buildings (OpenFreeMap: free, no key,
  // commercial use allowed; self-hostable: https://openfreemap.org).
  styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  // Elevation tiles (Terrarium encoding) from the AWS Open Data "Terrain Tiles" dataset
  // (SRTM/GMTED and other public DEMs). Swap for self-hosted Copernicus DEM tiles if needed.
  terrainTiles: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  terrainAttribution: "Elevation: AWS Terrain Tiles (SRTM, GMTED and others)",
  // Sentinel-2 cloudless 2016 mosaic by EOX (CC BY 4.0, ~10 m per pixel, sharp up to zoom ~13).
  satelliteTiles: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
  satelliteMaxZoom: 14,
  satelliteAttribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
  // Place search: any Nominatim-compatible endpoint. The public one is for light use only;
  // run your own (https://nominatim.org) or use a hosted provider as traffic grows.
  geocoderUrl: "https://nominatim.openstreetmap.org/search",
  // Optional in-app route display: an OSRM-compatible routing server, e.g.
  // "https://your-osrm.example.com". Leave empty to open turn-by-turn directions in Google Maps.
  routingUrl: ""
};

export const APP_VERSION = "1.1.0";
export const SUPPORT_EMAIL = "support@landier.co.ke";

export const MAX_PHOTOS = 6;
export const KENYA_CENTER = { lat: -0.0236, lng: 37.9062 };
export const NAIROBI = { lat: -1.2864, lng: 36.8172 };

export const LAND_USES = ["Residential", "Commercial", "Agricultural", "Industrial", "Mixed Use"];
export const TITLE_STATUSES = ["Title deed ready", "Title in process", "Allotment letter", "Other"];

export const COUNTIES = [
  "Baringo", "Bomet", "Bungoma", "Busia", "Elgeyo-Marakwet", "Embu", "Garissa", "Homa Bay",
  "Isiolo", "Kajiado", "Kakamega", "Kericho", "Kiambu", "Kilifi", "Kirinyaga", "Kisii",
  "Kisumu", "Kitui", "Kwale", "Laikipia", "Lamu", "Machakos", "Makueni", "Mandera",
  "Marsabit", "Meru", "Migori", "Mombasa", "Murang'a", "Nairobi", "Nakuru", "Nandi",
  "Narok", "Nyamira", "Nyandarua", "Nyeri", "Samburu", "Siaya", "Taita-Taveta", "Tana River",
  "Tharaka-Nithi", "Trans Nzoia", "Turkana", "Uasin Gishu", "Vihiga", "Wajir", "West Pokot"
];
