// Copies third-party browser files from node_modules into www/vendor so the APK works
// without CDNs: the Lucide icon font and MapLibre GL JS (maps).
import { mkdirSync, copyFileSync, existsSync } from "node:fs";

function copy(srcDir, destDir, files) {
  if (!existsSync(srcDir)) { console.warn(`${srcDir} missing; the app will fall back to the CDN`); return; }
  mkdirSync(destDir, { recursive: true });
  for (const f of files) if (existsSync(`${srcDir}/${f}`)) copyFileSync(`${srcDir}/${f}`, `${destDir}/${f}`);
}

copy("node_modules/lucide-static/font", "www/vendor/lucide",
  ["lucide.css", "lucide.woff2", "lucide.woff", "lucide.ttf"]);

copy("node_modules/maplibre-gl/dist", "www/vendor/maplibre",
  ["maplibre-gl.js", "maplibre-gl.css"]);

console.log("Vendor files copied to www/vendor");
