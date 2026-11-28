// main.js — app bootstrap: wires modules together and handles sign-in / sign-out.
import { auth } from "./firebase.js";
import { state, resetState } from "./state.js";
import { $, esc, initials, switchTab, closeAllOverlays, onTabShow, toast, registerActions, alertDialog } from "./ui.js";
import { initAuth, checkAdmin } from "./auth.js";
import { initListings, loadListings, subscribeSaved, renderHome } from "./listings.js";
import { initMap } from "./map.js";
import { initSeller, fetchMyListings, myListings } from "./seller.js";
import { initChat, subscribeConversations, stopChat } from "./chat.js";
import { initAdmin, refreshPendingCount } from "./admin.js";
import { initSettings } from "./settings.js";
import { initAvatar } from "./avatar.js";
import { getProfile, savePublicProfile, isSafePhotoURL } from "./profiles.js";

function show(id) {
  ["splash", "authScreen", "mainApp"].forEach((x) => ($("#" + x).hidden = x !== id));
}

function greetingText() {
  const h = new Date().getHours();
  const first = (state.profile?.fullName || "").split(" ")[0];
  const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return first ? `${g}, ${first} · discover verified land across Kenya` : "Discover verified land across Kenya";
}

function renderAvatars(p, u) {
  const photo = isSafePhotoURL(p.photoURL) ? p.photoURL : "";
  const acc = $("#accountAvatar");
  acc.classList.toggle("has-photo", !!photo);
  acc.innerHTML = photo ? `<img src="${esc(photo)}" alt="Profile photo">` : esc(initials(p.fullName || u.email));
  const nav = $("#navAvatar");
  nav.classList.toggle("has-photo", !!photo);
  nav.innerHTML = photo ? `<img src="${esc(photo)}" alt="">` : `<i class="icon-user"></i>`;
}

function renderAccount() {
  const p = state.profile || {};
  const u = auth.currentUser;
  if (!u) return;
  $("#greeting").textContent = greetingText();
  renderAvatars(p, u);
  $("#accountName").textContent = p.fullName || u.email.split("@")[0];
  $("#accountEmail").textContent = u.email;
  $("#accountBadges").innerHTML = [
    u.emailVerified ? `<span class="pill"><i class="icon-badge-check"></i> Verified</span>` : `<span class="pill warn">Email not verified</span>`,
    state.isAdmin ? `<span class="pill info"><i class="icon-shield-check"></i> Admin</span>` : "",
    p.phone ? "" : `<span class="pill warn">Add phone in Settings</span>`,
    `<button class="pill gray" data-action="copyUid" title="Copy your user ID"><i class="icon-copy"></i> ID: ${esc(u.uid.slice(0, 8))}…</button>`
  ].join("");
  $("#verifyBanner").hidden = u.emailVerified;
  $("#adminMenuItem").hidden = !state.isAdmin;
  const live = myListings.filter((l) => l.status === "approved").length;
  const pending = myListings.filter((l) => l.status === "pending").length;
  $("#accountStats").innerHTML = `
    <div class="stat"><b>${live}</b><span>Live</span></div>
    <div class="stat"><b>${pending}</b><span>In review</span></div>
    <div class="stat"><b>${state.saved.size}</b><span>Saved</span></div>`;
}

registerActions({
  // Copies the UID and shows exactly what the admin check sees, to debug admin setup.
  copyUid: async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try { await navigator.clipboard.writeText(uid); } catch (_) {}
    state.isAdmin = await checkAdmin(uid);
    renderAccount();
    const result = state.isAdmin
      ? "you are an admin."
      : `not an admin. In Firestore, open users/${uid} and add the field role = admin (string).`;
    alertDialog("Your user ID (copied)", `${uid}\n\nRole: ${state.profile?.role || "(none)"}\nAdmin: ${result}`);
  }
});

// Keep the public profile card (name + photo shown to other users) in sync with the private profile.
async function syncPublicProfile(uid) {
  const p = state.profile || {};
  const pub = await getProfile(uid);
  if (!pub || pub.fullName !== p.fullName || (pub.photoURL || "") !== (p.photoURL || "")) {
    try { await savePublicProfile(uid, { fullName: p.fullName, photoURL: p.photoURL }); } catch (e) { console.warn("public profile", e); }
  }
}

function onSignedIn(user) {
  show("mainApp");
  syncPublicProfile(user.uid);
  switchTab("home");
  renderAccount();
  loadListings(true);
  subscribeSaved(user.uid);
  subscribeConversations(user.uid);
  fetchMyListings().then(renderAccount).catch(() => {});
  refreshPendingCount();
}

function onSignedOut() {
  stopChat();
  closeAllOverlays();
  resetState();
  renderHome();
  show("authScreen");
}

document.addEventListener("DOMContentLoaded", () => {
  initListings();
  initMap();
  initSeller();
  initChat();
  initAdmin();
  initSettings();
  initAvatar();
  initAuth({ onSignedIn, onSignedOut });

  ["profile-updated", "saved-changed", "my-listings-changed"].forEach((ev) => document.addEventListener(ev, renderAccount));
  document.addEventListener("admin-changed", () => { refreshPendingCount(); loadListings(true); });
  onTabShow("account", async () => {
    renderAccount();
    fetchMyListings().catch(() => {});
    if (auth.currentUser) {
      state.isAdmin = await checkAdmin(auth.currentUser.uid);
      renderAccount();
    }
    refreshPendingCount();
  });

  window.addEventListener("offline", () => toast("You're offline — showing saved data", "error"));
  window.addEventListener("online", () => { toast("Back online", "success"); if (state.user) loadListings(true); });

  // Safety net: if Firebase can't be reached at all, don't leave users on the splash screen.
  setTimeout(() => { if (!$("#splash").hidden) { show("authScreen"); toast("Slow connection…", "info"); } }, 12000);
});

export { esc };
