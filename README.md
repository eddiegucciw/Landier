# LANDIER - Kenyan Land Marketplace

This project uses your **gumado** Firebase project.

## 🚀 Final Setup Steps

1. **Google Maps API Key:** 
   You MUST get a Google Maps API key from [Google Cloud Console](https://console.cloud.google.com) and replace `YOUR_GOOGLE_MAPS_API_KEY` in `index.html`.

2. **Firebase Console Setup:**
   Go to your [Firebase Console](https://console.firebase.google.com/project/gumado):
   - Enable **Authentication** (Email/Password).
   - Enable **Firestore Database**.
   - Enable **Storage**.

3. **Security Rules (IMPORTANT):**
   Paste these rules into Firestore to secure your database:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /landListings/{id} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && resource.data.sellerId == request.auth.uid;
    }
    match /savedListings/{id} {
      allow read, write: if request.auth != null && resource.data.userId == request.auth.uid;
    }
  }
}
