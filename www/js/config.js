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

export const APP_VERSION = "1.0.0";
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
