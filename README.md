# LANDIER — Kenyan Land Marketplace

Buy and sell land across Kenya. Android app built with [Capacitor](https://capacitorjs.com) around a
plain HTML/JS front end, with Firebase (Auth + Firestore + Storage) and MapLibre GL 3D maps on free
OpenStreetMap data (no map API keys).

**Features:** email sign-up with verification · browse/search/filter land · listing detail with photo
gallery, mini map and directions · save listings · real-time buyer–seller chat (plus call / WhatsApp) ·
3D globe map with terrain, 3D buildings, Sentinel-2 satellite imagery, readable place names, clustered price
pins, property boundaries, place/coordinate search and GPS · list land with up to 6 photos, a map pin and an
optional drawn boundary (with area) · profile photos · My listings (edit, mark sold, relist, delete) · admin moderation queue · settings
(profile, password, dark mode, delete account) · Android back button support · offline cache.

## Get the APK

Every push builds the app in **GitHub Actions → Build Android APK** (the web version deploys to Vercel
from the same code). Open the latest run and download
the `landier-android-…` artifact:

| File | What it is |
| --- | --- |
| `landier-debug.apk` | Always built. Install on any phone for testing. |
| `landier-release.apk` | Signed release build (only when signing secrets are set). |
| `landier-release.aab` | Signed bundle for the Google Play Store. |

Push a tag like `v1.0.0` to also publish the files as a GitHub Release.

## One-time setup

### 1. Firebase (project `gumado`)
1. **Authentication → Sign-in method:** enable *Email/Password*.
2. **Firestore Database:** create it (production mode).
3. **Rules & indexes:** either paste `firestore.rules` into *Firestore → Rules* (re-paste after every
   update to that file) and create the two
   indexes in `firestore.indexes.json`, **or** add the `FIREBASE_SERVICE_ACCOUNT` secret (below) and
   run the *Deploy Firestore rules & indexes* workflow. The app still works before the indexes finish
   building; it just sorts on the device.
4. **Make yourself an admin:** sign up in the app, then in *Firestore → Data* open
   `users → <your user ID>` and add the field `role` (string) = `admin`. The app picks it up within
   seconds, no restart needed. (Tap the **ID** pill on the Account tab to see and copy your user ID.)
   Admins see *Account → Admin · Moderation*, can **Feature** listings on the home page, and their own
   listings go live immediately.
   To remove admin access, delete the `role` field. Users can't set their own role from the app.

Listing photos are stored inside Firestore (compressed, one document per photo). Only profile photos
use Firebase Storage (next step); everything else works without it.

### 2. Firebase Storage (profile photos)
1. In the Firebase console open **Storage → Get started**. Google requires the pay-as-you-go **Blaze**
   plan to create a Storage bucket; small apps normally stay inside the free allowance (5 GB stored,
   ~1 GB/day downloads), but a payment card is required. Set a **budget alert** in Google Cloud Billing.
2. Open **Storage → Rules**, paste the contents of `storage.rules` and **Publish**.
3. Photos are resized to 512×512 JPEG (~50–90 KB) on the phone before upload and stored at
   `avatars/{uid}/…`; only the URL is saved in Firestore (`users/{uid}.photoURL` and the public
   `profiles/{uid}` card shown on listings and in chat).

### 3. Maps — what's used and its limits
All map data is free and needs no API key. Every source is configurable in `www/js/config.js`
(`MAP_CONFIG`) so it can be moved to self-hosted servers without code changes.

| Layer | Source | Notes |
| --- | --- | --- |
| Engine | [MapLibre GL JS](https://maplibre.org) v5 (bundled from npm) | WebGL; globe, terrain, 3D. |
| Streets, labels, buildings | OpenStreetMap vector tiles via [OpenFreeMap](https://openfreemap.org) | Free incl. commercial use; self-hostable. Labels use English names, falling back to local names. |
| Satellite | [Sentinel-2 cloudless 2016](https://s2maps.eu) by EOX (CC BY 4.0) | **~10 m per pixel**: good for terrain, farms and roads, but individual plots/houses are blurry past zoom ~14. Not comparable to Google/Maxar 30–50 cm imagery. |
| Terrain | AWS Open Data Terrain Tiles (SRTM/GMTED…) | ~30 m elevation. Swap for self-hosted Copernicus DEM tiles if needed. |
| 3D buildings | OpenStreetMap building footprints | Only where buildings are mapped in OSM (good in Nairobi CBD, patchy in rural areas). |
| Place search | Nominatim (OpenStreetMap) | Public server is **light use only** (searches run on submit, not per keystroke, and are cached). Run your own or use a hosted Nominatim as traffic grows. Coordinates like `-1.2921, 36.8219` work offline. |
| Directions | Google Maps app/website link (drive/walk) | Free, no key. In-app route lines need an OSRM server: set `routingUrl`. |

Devices without WebGL see a message instead of the map; low-memory devices start in 2D (users can switch).
Seller-drawn boundaries are labelled **indicative only** everywhere — they are not surveys.

### 4. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Required | Purpose |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | for release builds | `base64 -w0 landier.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | for release builds | keystore password |
| `ANDROID_KEY_ALIAS` | for release builds | e.g. `landier` |
| `ANDROID_KEY_PASSWORD` | for release builds | key password |
| `FIREBASE_SERVICE_ACCOUNT` | optional | service-account JSON to auto-deploy rules |

Create the signing keystore once and **keep it safe** — Play Store updates must be signed with the same key:

```bash
keytool -genkeypair -v -keystore landier.jks -alias landier -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 landier.jks   # paste output into ANDROID_KEYSTORE_BASE64
```

## Develop locally

```bash
npm install
npm run serve                 # web version at http://localhost:5173
npx cap add android && node scripts/configure-android.mjs
npx cap sync android && npx cap open android   # run from Android Studio
```

## Project layout

```
www/                 the app (index.html, css/, js/)
  js/main.js         bootstrap, sign-in/out
  js/auth.js         login, register, reset, email verification
  js/listings.js     feed, filters, saved, detail page
  js/seller.js       listing form, photos, My listings
  js/map.js          MapLibre 3D map, search, boundary drawing, mini map
  js/avatar.js       profile photo crop + upload (Firebase Storage)
  js/profiles.js     public profile cards (name + photo)
  js/chat.js         real-time messaging
  js/admin.js        moderation queue
  js/settings.js     profile, password, theme, delete account
firestore.rules      Firestore security rules (listings moderated, chats private, roles console-only)
storage.rules        Storage rules (users can only write their own small image avatars)
scripts/             icons, icon font, Android project patching
.github/workflows/   APK build + Firestore rules deploy
vercel.json          web deployment (serves www/)
```

## Before publishing on Play Store
- Set `SUPPORT_EMAIL` in `www/js/config.js` to a real inbox.
- Host a privacy policy page (Play Console requires a URL); the in-app text in *Settings → Terms & Privacy* is a starting point — have it reviewed.
- Push notifications for new messages are not included yet (needs Firebase Cloud Messaging + a Cloud Function).
