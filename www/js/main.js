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

function show(id) {
  ["splash", "authScreen", "mainApp"].forEach((x) => ($("#" + x).hidden = x !== id));
}

function greetingText() {
  const h = new Date().getHours();
  const first = (state.profile?.fullName || "").split(" ")[0];
  const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return first ? `${g}, ${first}` : "Karibu Landier";
}

function renderAccount() {
  const p = state.profile || {};
  const u = auth.currentUser;
  if (!u) return;
  $("#greeting").textContent = greetingText();
  $("#accountAvatar").textContent = initials(p.fullName || u.email);
  $("#accountName").textContent = p.fullName || u.email.split("@")[0];
  $("#accountEmail").textContent = u.email;
  $("#accountBadges").innerHTML = [
    u.emailVerified ? `<span class="pill"><i class="icon-badge-check"></i> Verified</span>` : `<span class="pill warn">Email not verified</span>`,
    state.isAdmin ? `<span class="pill info"><i class="icon-shield-check"></i> Admin</span>` : "",
    p.phone ? "" : `<span class="pill warn">Add phone in Settings</span>`,
    state.adminCheckError === "permission-denied" ? `<span class="pill danger">Firestore rules not published</span>` : "",
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
  copyUid: async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try { await navigator.clipboard.writeText(uid); toast("User ID copied", "success"); }
    catch (_) { alertDialog("Your user ID", uid); }
  }
});

function onSignedIn(user) {
  show("mainApp");
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
  initAuth({ onSignedIn, onSignedOut });

  ["profile-updated", "saved-changed", "my-listings-changed"].forEach((ev) => document.addEventListener(ev, renderAccount));
  onTabShow("account", async () => {
    renderAccount();
    fetchMyListings().catch(() => {});
    if (auth.currentUser) {
      const was = state.isAdmin;
      state.isAdmin = await checkAdmin(auth.currentUser.uid);
      renderAccount();
      if (state.isAdmin && !was) toast("Admin access enabled", "success");
    }
    refreshPendingCount();
  });

  window.addEventListener("offline", () => toast("You're offline — showing saved data", "error"));
  window.addEventListener("online", () => { toast("Back online", "success"); if (state.user) loadListings(true); });

  // Safety net: if Firebase can't be reached at all, don't leave users on the splash screen.
  setTimeout(() => { if (!$("#splash").hidden) { show("authScreen"); toast("Slow connection…", "info"); } }, 12000);
});

export { esc };
