# LANDIER — Kenyan Land Marketplace

Buy and sell land across Kenya. Android app built with [Capacitor](https://capacitorjs.com) around a
plain HTML/JS front end, with Firebase (Auth + Firestore) and Leaflet + OpenStreetMap maps (no API key needed).

**Features:** email sign-up with verification · browse/search/filter land · listing detail with photo
gallery, mini map and directions · save listings · real-time buyer–seller chat (plus call / WhatsApp) ·
explore map with price pins, clustering, place search and "my location" · list land with up to 6 photos
and a map pin · My listings (edit, mark sold, relist, delete) · admin moderation queue · settings
(profile, password, dark mode, delete account) · Android back button support · offline cache.

## Turn on the APK build (one time)

GitHub only lets you (not apps) add workflow files, so the two workflows live in `ci/`. Move them:

1. On GitHub, open `ci/android.yml` → ✏️ Edit → change the file name box to `.github/workflows/android.yml` → Commit.
2. Do the same for `ci/firestore.yml` → `.github/workflows/firestore.yml`.

## Get the APK

Every push builds the app in **GitHub Actions → Build Android APK**. Open the latest run and download
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
3. **Rules & indexes:** either paste `firestore.rules` into *Firestore → Rules* and create the two
   indexes in `firestore.indexes.json`, **or** add the `FIREBASE_SERVICE_ACCOUNT` secret (below) and
   run the *Deploy Firestore rules & indexes* workflow. The app still works before the indexes finish
   building; it just sorts on the device.
4. **Make yourself an admin:** in Firestore create a document `admins/<your-user-UID>` (any field,
   e.g. `role: "admin"`). Find your UID under *Authentication → Users*. Admins see
   *Account → Admin · Moderation* and their own listings go live immediately.

Photos are stored inside Firestore (compressed, one document per photo), so Firebase Storage and the
Blaze plan are **not** required.

### 2. Maps
Nothing to set up. Maps use [Leaflet](https://leafletjs.com) (bundled into the app from npm) with free
OpenStreetMap street tiles, Esri satellite imagery and OpenStreetMap's Nominatim for place search.
None of these need an API key. If the app grows large (thousands of daily users), switch the tile URLs in
`www/js/map.js` to a paid tile provider to stay within OpenStreetMap's fair-use policy.

### 3. GitHub secrets (Settings → Secrets and variables → Actions)

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
  js/map.js          explore map, location picker, mini map
  js/chat.js         real-time messaging
  js/admin.js        moderation queue
  js/settings.js     profile, password, theme, delete account
firestore.rules      security rules (listings moderated, chats private)
scripts/             icons, icon font, Android project patching
ci/                  workflow files to move into .github/workflows/
```

## Before publishing on Play Store
- Set `SUPPORT_EMAIL` in `www/js/config.js` to a real inbox.
- Host a privacy policy page (Play Console requires a URL); the in-app text in *Settings → Terms & Privacy* is a starting point — have it reviewed.
- Push notifications for new messages are not included yet (needs Firebase Cloud Messaging + a Cloud Function).
