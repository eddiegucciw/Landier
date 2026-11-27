// Copies the Lucide icon font into www/vendor so icons work offline inside the APK.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
const src = "node_modules/lucide-static/font";
const dest = "www/vendor/lucide";
if (!existsSync(src)) { console.warn("lucide-static not installed; icons will load from CDN"); process.exit(0); }
mkdirSync(dest, { recursive: true });
for (const f of ["lucide.css", "lucide.woff2", "lucide.woff", "lucide.ttf"]) {
  if (existsSync(`${src}/${f}`)) copyFileSync(`${src}/${f}`, `${dest}/${f}`);
}
console.log("Lucide icon font copied to", dest);
