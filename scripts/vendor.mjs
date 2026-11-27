// Copies third-party browser files from node_modules into www/vendor so the APK works
// without CDNs: the Lucide icon font and Leaflet (maps) + the marker-cluster plugin.
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";

function copy(srcDir, destDir, files) {
  if (!existsSync(srcDir)) { console.warn(`${srcDir} missing; the app will fall back to the CDN`); return; }
  mkdirSync(destDir, { recursive: true });
  for (const f of files) if (existsSync(`${srcDir}/${f}`)) copyFileSync(`${srcDir}/${f}`, `${destDir}/${f}`);
}

copy("node_modules/lucide-static/font", "www/vendor/lucide",
  ["lucide.css", "lucide.woff2", "lucide.woff", "lucide.ttf"]);

copy("node_modules/leaflet/dist", "www/vendor/leaflet", ["leaflet.js", "leaflet.css"]);
if (existsSync("node_modules/leaflet/dist/images")) {
  copy("node_modules/leaflet/dist/images", "www/vendor/leaflet/images", readdirSync("node_modules/leaflet/dist/images"));
}
copy("node_modules/leaflet.markercluster/dist", "www/vendor/leaflet",
  ["leaflet.markercluster.js", "MarkerCluster.css", "MarkerCluster.Default.css"]);

console.log("Vendor files copied to www/vendor");
