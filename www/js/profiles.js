// profiles.js — public profile cards (name + photo) at profiles/{uid}, readable by signed-in users.
// The private users/{uid} document keeps email/phone; this one only holds what others may see.
import { db, doc, getDoc, setDoc, serverTimestamp } from "./firebase.js";
import { esc, initials } from "./ui.js";

const cache = new Map(); // uid -> Promise<{fullName, photoURL}|null>

export function getProfile(uid) {
  if (!uid) return Promise.resolve(null);
  if (!cache.has(uid)) {
    cache.set(uid, getDoc(doc(db, "profiles", uid))
      .then((s) => (s.exists() ? s.data() : null))
      .catch(() => null));
  }
  return cache.get(uid);
}

export function primeProfile(uid, data) {
  cache.set(uid, Promise.resolve(data));
}

export async function savePublicProfile(uid, { fullName, photoURL }) {
  const data = { fullName: fullName || "Landier user", updatedAt: serverTimestamp() };
  if (photoURL) data.photoURL = photoURL;
  await setDoc(doc(db, "profiles", uid), data);
  primeProfile(uid, { fullName: data.fullName, photoURL: photoURL || "" });
}

export function isSafePhotoURL(url) {
  return typeof url === "string" && /^https:\/\/firebasestorage\.googleapis\.com\//.test(url);
}

// <span class="avatar …"> with the photo, or initials when there's no photo.
export function avatarHtml(name, photoURL, cls = "") {
  if (isSafePhotoURL(photoURL)) {
    return `<span class="avatar ${cls} has-photo"><img src="${esc(photoURL)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  }
  return `<span class="avatar ${cls}">${esc(initials(name))}</span>`;
}

// Fill every [data-avatar-uid] placeholder inside root once the profile has loaded.
export function hydrateAvatars(root = document) {
  root.querySelectorAll("[data-avatar-uid]").forEach(async (el) => {
    const uid = el.dataset.avatarUid;
    const p = await getProfile(uid);
    if (!p || !el.isConnected) return;
    if (isSafePhotoURL(p.photoURL)) el.outerHTML = avatarHtml(p.fullName, p.photoURL, el.dataset.avatarCls || "");
  });
}
