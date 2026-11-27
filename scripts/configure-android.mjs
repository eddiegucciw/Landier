// Patches the generated Capacitor Android project:
//  - adds location + camera permissions (map "my location", photo capture)
//  - sets versionCode / versionName from CI (or package.json)
// Safe to run more than once.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
const gradlePath = "android/app/build.gradle";

if (!existsSync(manifestPath)) {
  console.error("Android project not found. Run `npx cap add android` first.");
  process.exit(1);
}

// ---- Permissions ----
let manifest = readFileSync(manifestPath, "utf8");
const perms = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />'
];
const missing = perms.filter((p) => !manifest.includes(p.match(/name="([^"]+)"/)[1] + '"'));
if (missing.length) {
  manifest = manifest.replace(/(\s*)<application/, `\n    ${missing.join("\n    ")}\n$1<application`);
  writeFileSync(manifestPath, manifest);
  console.log("Added to AndroidManifest:", missing.length, "entries");
}

// ---- Version ----
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const versionName = process.env.VERSION_NAME || pkg.version;
const versionCode = parseInt(process.env.VERSION_CODE || "1", 10);
let gradle = readFileSync(gradlePath, "utf8");
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
writeFileSync(gradlePath, gradle);
console.log(`Version set to ${versionName} (${versionCode})`);
