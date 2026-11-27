// ui.js — DOM helpers, formatting, dialogs, navigation (tabs + overlay stack with Android back support).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- Escaping & safe values ----------
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#E2E8F0"/>' +
    '<path d="M0 230 L120 140 L200 200 L280 120 L400 220 L400 300 L0 300Z" fill="#CBD5E1"/>' +
    '<circle cx="310" cy="70" r="28" fill="#CBD5E1"/></svg>'
  );

export function safeImg(src) {
  return typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
    ? src
    : PLACEHOLDER_IMG;
}

// ---------- Formatting ----------
export function formatKsh(n) {
  const v = Number(n);
  return Number.isFinite(v) ? "KSh " + v.toLocaleString("en-KE") : "KSh —";
}

export function shortKsh(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(v % 1e9 ? 1 : 0) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return Math.round(v / 1e3) + "K";
  return String(v);
}

export function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
  return null;
}

export function timeAgo(ts) {
  const d = toDate(ts);
  if (!d) return "just now";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export function clockTime(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "";
}

// Kenyan phone → 2547XXXXXXXX (returns "" if invalid)
export function normalizeKePhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  let m = digits.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? "254" + m[1] : "";
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

// ---------- Toast ----------
let toastTimer;
export function toast(message, type = "info") {
  const t = $("#toast");
  t.textContent = message;
  t.className = "toast show " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

// ---------- Error messages ----------
const ERRORS = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Password must be at least 8 characters.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "No internet connection.",
  "auth/requires-recent-login": "Please confirm your password and try again.",
  "permission-denied": "You don't have permission to do that.",
  "unavailable": "You're offline. Changes will sync when you reconnect.",
  "resource-exhausted": "Too much data — try fewer or smaller photos."
};
export function friendlyError(err) {
  console.error(err);
  return ERRORS[err?.code] || (err?.message ? err.message.replace(/^Firebase:\s*/, "") : "Something went wrong.");
}

// ---------- Buttons ----------
export function setBusy(btn, busy, busyLabel = "Please wait…") {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${esc(busyLabel)}`;
    btn.disabled = true;
  } else {
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    btn.disabled = false;
  }
}

// ---------- Dialogs ----------
function showDialog({ title, message, confirmText = "OK", cancelText = "Cancel", danger = false, input = null }) {
  return new Promise((resolve) => {
    const wrap = $("#dialog");
    wrap.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ""}
        ${input ? `<input class="dialog-input" type="${esc(input.type || "text")}" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}">` : ""}
        <div class="dialog-actions">
          ${cancelText ? `<button class="btn btn-ghost" data-r="cancel">${esc(cancelText)}</button>` : ""}
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-r="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    wrap.hidden = false;
    const field = $(".dialog-input", wrap);
    if (field) setTimeout(() => field.focus(), 50);
    const done = (ok) => {
      wrap.hidden = true;
      wrap.innerHTML = "";
      resolve(input ? (ok ? field.value : null) : ok);
    };
    wrap.onclick = (e) => {
      const r = e.target.closest("[data-r]")?.dataset.r;
      if (r) done(r === "ok");
      else if (e.target === wrap) done(false);
    };
    if (field) field.onkeydown = (e) => { if (e.key === "Enter") done(true); };
  });
}
export const confirmDialog = (opts) => showDialog(opts);
export const alertDialog = (title, message) => showDialog({ title, message, cancelText: null });
export const promptDialog = (opts) => showDialog({ ...opts, input: opts.input || {} });

// ---------- Delegated actions ----------
const actions = {};
export function registerActions(map) { Object.assign(actions, map); }
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    e.stopPropagation();
    fn(el, e);
  }
});

// ---------- Tabs ----------
const tabHooks = {};
let currentTab = "home";
let tabHistoryPushed = false;
export function onTabShow(tab, fn) { (tabHooks[tab] ||= []).push(fn); }
export function getCurrentTab() { return currentTab; }

export function switchTab(tab, { fromHistory = false } = {}) {
  if (!document.getElementById("tab-" + tab)) return;
  if (tab === "home" && !fromHistory && tabHistoryPushed && overlayStack.length === 0) {
    history.back(); // popstate brings us home and consumes the extra entry
    return;
  }
  $$(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.tab === tab));
  // Back button on any non-home tab returns to Home before exiting the app.
  if (!fromHistory && tab !== "home" && !tabHistoryPushed && overlayStack.length === 0) {
    history.pushState({ landierTab: true }, "");
    tabHistoryPushed = true;
  }
  currentTab = tab;
  window.scrollTo(0, 0);
  (tabHooks[tab] || []).forEach((fn) => fn());
}

// ---------- Overlay stack (each overlay = one history entry, so Android back closes it) ----------
const overlayStack = [];
const closeHooks = {};
export function onOverlayClose(id, fn) { (closeHooks[id] ||= []).push(fn); }
export function isOverlayOpen(id) { return overlayStack.includes(id); }

export function openOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (overlayStack.includes(id)) {
    // Already open: bring to top without new history entry.
    el.style.zIndex = 200 + overlayStack.length;
    return;
  }
  overlayStack.push(id);
  el.style.zIndex = 200 + overlayStack.length;
  el.classList.add("active");
  el.setAttribute("aria-hidden", "false");
  const scroller = $(".overlay-scroll", el);
  if (scroller) scroller.scrollTop = 0;
  history.pushState({ landierOverlay: id }, "");
}

function hideTopOverlay() {
  const id = overlayStack.pop();
  if (!id) return false;
  const el = document.getElementById(id);
  el.classList.remove("active");
  el.setAttribute("aria-hidden", "true");
  (closeHooks[id] || []).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  return true;
}

export function closeOverlay() {
  if (overlayStack.length) history.back();
}

// Close every overlay at once. With rewind=true the matching history entries are
// dropped too (used when jumping from a detail page to the map).
let ignoreNextPop = false;
export function closeAllOverlays({ rewind = false } = {}) {
  const n = overlayStack.length;
  while (overlayStack.length) hideTopOverlay();
  if (rewind && n) {
    ignoreNextPop = true;
    history.go(-n);
  }
}

window.addEventListener("popstate", () => {
  if (ignoreNextPop) { ignoreNextPop = false; return; }
  if (!$("#dialog").hidden) {
    $("#dialog").hidden = true;
  }
  if (hideTopOverlay()) return;
  if (currentTab !== "home") {
    tabHistoryPushed = false;
    switchTab("home", { fromHistory: true });
  }
});

registerActions({ back: () => closeOverlay() });

// ---------- External links (tel:, WhatsApp, maps) ----------
export function openExternal(url) {
  const native = window.Capacitor?.isNativePlatform?.();
  if (native || url.startsWith("tel:") || url.startsWith("mailto:")) {
    // Capacitor hands non-app URLs to Android (dialer, WhatsApp, Maps, browser).
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}

// ---------- Theme ----------
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("landier-theme", theme); } catch (_) {}
}
export function savedTheme() {
  try { return localStorage.getItem("landier-theme") || "light"; } catch (_) { return "light"; }
}
