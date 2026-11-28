// listings.js — home feed, filters, saved listings, listing detail.
import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy,
  onSnapshot, serverTimestamp
} from "./firebase.js";
import { state, cacheListing } from "./state.js";
import {
  $, esc, safeImg, formatKsh, timeAgo, toast, friendlyError, registerActions, openOverlay,
  switchTab, openExternal, onTabShow, initials, getCurrentTab, onOverlayClose
} from "./ui.js";
import { avatarHtml, hydrateAvatars } from "./profiles.js";
import { LAND_USES, COUNTIES } from "./config.js";

export const STATUS_LABEL = {
  pending: ["Pending review", "warn"],
  approved: ["Live", ""],
  rejected: ["Rejected", "danger"],
  sold: ["Sold", "gray"]
};

export function fromSnap(d) {
  return { id: d.id, ...d.data() };
}

export function listingLocation(l) {
  return [l.town, l.county].filter(Boolean).join(", ") || l.location || "Kenya";
}

// ---------- Data ----------
export async function fetchListing(id, { fresh = false } = {}) {
  if (!fresh && state.listingById.has(id)) return state.listingById.get(id);
  try {
    const snap = await getDoc(doc(db, "landListings", id));
    return snap.exists() ? cacheListing(fromSnap(snap)) : null;
  } catch (e) {
    if (e?.code === "permission-denied") return null; // pending/removed listing we can't see
    throw e;
  }
}

export async function fetchImages(listing) {
  try {
    const snap = await getDocs(query(collection(db, "landListings", listing.id, "images"), orderBy("order")));
    const imgs = snap.docs.map((d) => d.data().data).filter(Boolean);
    return imgs.length ? imgs : [listing.coverThumb];
  } catch (e) {
    console.warn("images", e);
    return [listing.coverThumb];
  }
}

// Query helper: try the indexed (sorted) query; fall back to an unsorted one if the
// composite index hasn't been deployed yet, then sort on the device.
export async function queryWithFallback(col, filters, sortField = "createdAt") {
  try {
    return await getDocs(query(col, ...filters, orderBy(sortField, "desc")));
  } catch (e) {
    if (e?.code !== "failed-precondition") throw e;
    console.warn("Missing Firestore index — deploy firestore.indexes.json. Falling back.", e.message);
    return await getDocs(query(col, ...filters));
  }
}

export function byNewest(a, b) {
  return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
}

let loading = null;
export async function loadListings(force = false) {
  if (loading) return loading;
  if (!force && state.listings.length) { renderHome(); return; }
  const grid = $("#propertyGrid");
  if (!state.listings.length) grid.innerHTML = '<div class="skeleton"></div>'.repeat(4);
  loading = (async () => {
    try {
      const snap = await queryWithFallback(collection(db, "landListings"), [where("status", "==", "approved")]);
      state.listings = snap.docs.map(fromSnap).sort(byNewest);
      state.listings.forEach(cacheListing);
      renderHome();
      document.dispatchEvent(new CustomEvent("listings-loaded"));
    } catch (e) {
      grid.innerHTML = emptyState("icon-wifi-off", "Couldn't load land", friendlyError(e), `<button class="btn btn-ghost sm" data-action="refreshListings">Try again</button>`);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function filteredListings(list = state.listings, f = state.filters) {
  const q = f.search.trim().toLowerCase();
  let out = list.filter((l) => {
    if (f.category !== "All" && l.landUse !== f.category) return false;
    if (f.county && l.county !== f.county) return false;
    if (f.minPrice != null && l.price < f.minPrice) return false;
    if (f.maxPrice != null && l.price > f.maxPrice) return false;
    if (q) {
      const hay = [l.title, l.town, l.county, l.location, l.landUse, l.size].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  if (f.sort === "priceAsc") out.sort((a, b) => a.price - b.price);
  else if (f.sort === "priceDesc") out.sort((a, b) => b.price - a.price);
  else out.sort(byNewest);
  return out;
}

// ---------- Rendering ----------
export function emptyState(icon, title, text = "", extra = "") {
  return `<div class="empty"><i class="${icon}"></i><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ""}${extra}</div>`;
}

function availabilityHtml(l) {
  if (!l.status || l.status === "approved") return `<span class="avail">Available</span>`;
  const [label, cls] = STATUS_LABEL[l.status] || ["", ""];
  return `<span class="avail ${cls}">${esc(label)}</span>`;
}

// variant: "wide" (spans two columns), "feature" (carousel), or "" (standard)
export function cardHtml(l, variant = "") {
  const saved = state.saved.has(l.id);
  return `
    <article class="card-l ${variant}" data-action="openListing" data-id="${esc(l.id)}">
      <div class="card-img">
        <img src="${safeImg(l.coverThumb)}" alt="" loading="lazy">
        ${l.landUse ? `<span class="tag">${esc(l.landUse)}</span>` : ""}
        <button class="fav ${saved ? "on" : ""}" data-action="toggleSave" data-id="${esc(l.id)}" aria-label="${saved ? "Remove from saved" : "Save"}"><i class="icon-heart"></i></button>
        ${variant ? `<div class="card-img-price">${formatKsh(l.price)}</div>` : ""}
      </div>
      <div class="card-body">
        ${variant ? "" : `<div class="card-price">${formatKsh(l.price)}</div>`}
        <div class="card-title">${esc(l.title)}</div>
        <div class="card-loc"><i class="icon-map-pin"></i> <span>${esc(listingLocation(l))}</span></div>
        <div class="card-foot">
          ${l.size ? `<span class="card-size"><i class="icon-ruler"></i> ${esc(l.size)}</span>` : ""}
          ${availabilityHtml(l)}
        </div>
      </div>
    </article>`;
}

// Alternating mosaic: one wide card, then two standard cards, repeated.
function mosaicHtml(list) {
  return list.map((l, i) => cardHtml(l, i % 3 === 0 ? "wide" : "")).join("");
}

function filtersActive() {
  const f = state.filters;
  return f.minPrice != null || f.maxPrice != null || !!f.county || f.sort !== "newest";
}

export function renderHome() {
  const list = filteredListings();
  const grid = $("#propertyGrid");
  $("#filterDot").hidden = !filtersActive();
  const f = state.filters;
  const searching = !!(f.search || filtersActive() || f.category !== "All");
  $("#resultsTitle").textContent = searching ? `${list.length} result${list.length === 1 ? "" : "s"}` : "Recently added";

  // Featured row (admin-picked listings) and the map call-to-action show on the default view only.
  $("#homeSections").hidden = searching;
  const featured = state.listings.filter((l) => l.featured === true);
  $("#featuredSection").hidden = !featured.length;
  $("#featuredRow").innerHTML = featured.map((l) => cardHtml(l, "feature")).join("");
  $("#featuredCount").textContent = featured.length ? `${featured.length} picked by Landier` : "";
  const onMap = state.listings.filter((l) => Number.isFinite(l.latitude)).length;
  $("#exploreCtaCount").textContent = onMap
    ? `${onMap} listing${onMap === 1 ? "" : "s"} on the map · satellite, terrain and boundaries`
    : "Satellite view, terrain and property boundaries";

  if (!state.listings.length) {
    grid.innerHTML = emptyState("icon-map", "No land listed yet", "Be the first to list land on Landier.", `<button class="btn btn-primary sm" data-action="newListing">List your land</button>`);
    return;
  }
  grid.innerHTML = list.length
    ? mosaicHtml(list)
    : emptyState("icon-search-x", "No matching land", "Try a different search or clear your filters.", `<button class="btn btn-ghost sm" data-action="resetFilters">Clear filters</button>`);
}

function renderChips(container, current, action) {
  container.innerHTML = ["All", ...LAND_USES]
    .map((c) => `<button class="chip ${c === current ? "active" : ""}" data-action="${action}" data-cat="${esc(c)}">${c === "All" ? "All land" : esc(c)}</button>`)
    .join("");
}
export function renderCategoryChips() {
  renderChips($("#categoryChips"), state.filters.category, "setCategory");
  renderChips($("#mapChips"), state.filters.category, "setCategory");
}

function refreshHearts() {
  document.querySelectorAll(".fav[data-id]").forEach((b) => {
    const on = state.saved.has(b.dataset.id);
    b.classList.toggle("on", on);
    b.setAttribute("aria-label", on ? "Remove from saved" : "Save");
  });
  const dsave = $("#detailSaveBtn");
  if (dsave) {
    const on = state.saved.has(dsave.dataset.id);
    dsave.classList.toggle("on", on);
    dsave.innerHTML = `<i class="icon-heart"></i>`;
  }
}

// ---------- Saved ----------
export function subscribeSaved(uid) {
  const unsub = onSnapshot(collection(db, "users", uid, "saved"), (snap) => {
    state.saved = new Set(snap.docs.map((d) => d.id));
    refreshHearts();
    if (getCurrentTab() === "saved") renderSaved();
    document.dispatchEvent(new CustomEvent("saved-changed"));
  }, (e) => console.warn("saved listener", e));
  state.unsubscribers.push(unsub);
}

export async function toggleSave(id) {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "saved", id);
  const was = state.saved.has(id);
  // Optimistic update
  was ? state.saved.delete(id) : state.saved.add(id);
  refreshHearts();
  try {
    if (was) await deleteDoc(ref);
    else await setDoc(ref, { savedAt: serverTimestamp() });
    toast(was ? "Removed from saved" : "Saved ❤", "success");
  } catch (e) {
    was ? state.saved.add(id) : state.saved.delete(id);
    refreshHearts();
    toast(friendlyError(e), "error");
  }
}

let savedRenderToken = 0;
export async function renderSaved() {
  const grid = $("#savedGrid");
  const ids = [...state.saved];
  const token = ++savedRenderToken;
  if (!ids.length) {
    grid.innerHTML = emptyState("icon-heart", "No saved land yet", "Tap the heart on any listing to save it here.", `<button class="btn btn-ghost sm" data-action="tab" data-tab="home">Browse land</button>`);
    return;
  }
  if (!grid.children.length || grid.querySelector(".empty")) grid.innerHTML = '<div class="skeleton"></div>'.repeat(Math.min(ids.length, 4));
  const results = await Promise.all(ids.map((id) => fetchListing(id).catch(() => null)));
  if (token !== savedRenderToken) return;
  const html = ids.map((id, i) => {
    const l = results[i];
    if (l) return cardHtml(l, i % 3 === 0 ? "wide" : "");
    return `<article class="card-l"><div class="card-img"><img src="${safeImg()}" alt=""></div>
      <div class="card-body"><div class="card-title">No longer available</div>
      <button class="btn btn-ghost sm" data-action="toggleSave" data-id="${esc(id)}">Remove</button></div></article>`;
  });
  grid.innerHTML = html.join("");
}

// ---------- Detail ----------
let currentDetail = null;
export function getCurrentDetail() { return currentDetail; }

export async function openDetail(id) {
  const body = $("#detailBody");
  const cta = $("#detailCta");
  body.innerHTML = `<div class="empty"><span class="spinner dark"></span></div>`;
  cta.innerHTML = "";
  openOverlay("ov-detail");
  let l;
  try {
    l = await fetchListing(id, { fresh: true });
  } catch (e) {
    body.innerHTML = emptyState("icon-wifi-off", "Couldn't load this listing", friendlyError(e));
    return;
  }
  if (!l) {
    body.innerHTML = emptyState("icon-circle-off", "Listing not available", "It may have been sold or removed.");
    return;
  }
  currentDetail = l;
  renderDetail(l, [l.coverThumb]);
  const imgs = await fetchImages(l);
  if (currentDetail?.id === l.id) renderGallery(imgs);
  document.dispatchEvent(new CustomEvent("detail-rendered", { detail: l }));
}

function renderGallery(imgs) {
  const g = $("#detailGallery");
  if (!g) return;
  g.innerHTML = `
    <div class="gallery-track">${imgs.map((src) => `<img src="${safeImg(src)}" alt="">`).join("")}</div>
    ${imgs.length > 1 ? `<span class="gallery-count">1 / ${imgs.length}</span>` : ""}`;
  const track = g.querySelector(".gallery-track");
  const count = g.querySelector(".gallery-count");
  if (count) track.addEventListener("scroll", () => {
    const i = Math.round(track.scrollLeft / track.clientWidth) + 1;
    count.textContent = `${i} / ${imgs.length}`;
  }, { passive: true });
}

export function renderDetail(l, imgs) {
  const me = state.user?.uid;
  const isOwner = l.sellerId === me;
  const status = STATUS_LABEL[l.status] || ["", ""];
  const hasLoc = Number.isFinite(l.latitude) && Number.isFinite(l.longitude);
  const hasBoundary = Array.isArray(l.boundary?.points) && l.boundary.points.length >= 3;

  let notice = "";
  if (l.status === "pending") notice = `<div class="notice warn"><i class="icon-clock"></i><span>This listing is awaiting review and isn't visible to buyers yet.</span></div>`;
  if (l.status === "rejected") notice = `<div class="notice danger"><i class="icon-circle-x"></i><span><b>Not approved.</b> ${esc(l.rejectionReason || "Please edit the listing and resubmit.")}</span></div>`;
  if (l.status === "sold") notice = `<div class="notice info"><i class="icon-badge-check"></i><span>This land has been marked as sold.</span></div>`;

  let ownerTools = "";
  if (isOwner) {
    ownerTools = `<div class="row-actions">
      <button class="btn btn-ghost sm" data-action="editListing" data-id="${esc(l.id)}"><i class="icon-pencil"></i> Edit</button>
      ${l.status === "approved" ? `<button class="btn btn-ghost sm" data-action="markSold" data-id="${esc(l.id)}"><i class="icon-badge-check"></i> Mark sold</button>` : ""}
      ${l.status === "sold" ? `<button class="btn btn-ghost sm" data-action="relist" data-id="${esc(l.id)}"><i class="icon-rotate-ccw"></i> Relist</button>` : ""}
      <button class="btn btn-ghost sm" data-action="deleteListing" data-id="${esc(l.id)}" style="color:var(--danger)"><i class="icon-trash-2"></i> Delete</button>
    </div>`;
  }
  let adminTools = "";
  if (state.isAdmin) {
    adminTools = `<div class="card" style="margin:0"><b><i class="icon-shield-check"></i> Admin</b>
      <div class="row-actions" style="margin-top:10px">
        ${l.status !== "approved" ? `<button class="btn btn-primary sm" data-action="adminApprove" data-id="${esc(l.id)}">Approve</button>` : ""}
        ${l.status !== "rejected" ? `<button class="btn btn-ghost sm" data-action="adminReject" data-id="${esc(l.id)}">${l.status === "approved" ? "Unpublish" : "Reject"}</button>` : ""}
        ${l.status === "approved" ? `<button class="btn btn-ghost sm" data-action="adminFeature" data-id="${esc(l.id)}"><i class="icon-star"></i> ${l.featured ? "Unfeature" : "Feature"}</button>` : ""}
        <button class="btn btn-ghost sm" data-action="adminDelete" data-id="${esc(l.id)}" style="color:var(--danger)">Delete</button>
      </div></div>`;
  }

  $("#detailBody").innerHTML = `
    <div class="gallery" id="detailGallery"></div>
    <div class="detail">
      ${notice}
      <div>
        <div class="price-xl">${formatKsh(l.price)}</div>
        <h2>${esc(l.title)}</h2>
        <p class="muted"><i class="icon-map-pin"></i> ${esc(listingLocation(l))}</p>
      </div>
      <div class="meta">
        ${l.size ? `<span><i class="icon-ruler"></i> ${esc(l.size)}</span>` : ""}
        ${l.landUse ? `<span><i class="icon-landmark"></i> ${esc(l.landUse)}</span>` : ""}
        ${l.titleStatus ? `<span><i class="icon-file-check"></i> ${esc(l.titleStatus)}</span>` : ""}
        <span><i class="icon-calendar"></i> ${esc(timeAgo(l.createdAt))}</span>
        ${isOwner || state.isAdmin ? `<span class="pill ${status[1]}">${esc(status[0])}</span>` : ""}
      </div>
      ${ownerTools}
      ${adminTools}
      <div><div class="section-title">About this land</div><p class="desc">${esc(l.description)}</p></div>
      ${hasLoc ? `<div>
        <div class="section-title" style="margin-bottom:8px">Location</div>
        <div id="detailMap" class="map mini"></div>
        ${hasBoundary ? `<p class="muted small" style="margin-top:6px"><i class="icon-pentagon"></i> Seller-drawn boundary${l.boundary.areaSqm ? ` · ${esc(formatAreaShort(l.boundary.areaSqm))}` : ""} — indicative only, not an official survey.</p>` : ""}
        <div class="distance" id="detailDistance"><button class="link" data-action="detailDistance"><i class="icon-locate-fixed"></i> How far is this from me?</button></div>
        <div class="row-actions" style="margin-top:8px">
          <button class="btn btn-ghost sm" data-action="directions" data-mode="driving"><i class="icon-car"></i> Drive</button>
          <button class="btn btn-ghost sm" data-action="directions" data-mode="walking"><i class="icon-footprints"></i> Walk</button>
          <button class="btn btn-ghost sm" data-action="viewOnMap"><i class="icon-globe"></i> 3D map</button>
        </div></div>` : ""}
      <div class="seller">
        <span data-avatar-uid="${esc(l.sellerId)}" data-avatar-cls="sm">${avatarHtml(l.sellerName, "", "sm")}</span>
        <div><b>${esc(l.sellerName || "Seller")}</b><div class="muted small">${isOwner ? "You" : "Seller"}</div></div>
      </div>
      <div class="notice info"><i class="icon-shield-alert"></i><span><b>Stay safe:</b> visit the land, do an official search on Ardhisasa, and never pay before signing an agreement with an advocate.</span></div>
    </div>`;
  renderGallery(imgs);
  hydrateAvatars($("#detailBody"));
  if (state.myLocation && hasLoc) showDistance(l, state.myLocation);

  const saved = state.saved.has(l.id);
  $("#detailCta").innerHTML = isOwner
    ? ""
    : `<button class="btn btn-ghost icon-only fav-detail ${saved ? "on" : ""}" id="detailSaveBtn" data-action="toggleSave" data-id="${esc(l.id)}" aria-label="Save"><i class="icon-heart"></i></button>
       ${l.sellerPhone ? `<button class="btn btn-ghost icon-only" data-action="callSeller" aria-label="Call"><i class="icon-phone"></i></button>
       <button class="btn btn-ghost icon-only" data-action="whatsappSeller" aria-label="WhatsApp"><i class="icon-message-square-text"></i></button>` : ""}
       <button class="btn btn-primary" data-action="chatSeller"><i class="icon-message-circle"></i> Chat</button>`;
}

function formatAreaShort(sqm) {
  const acres = sqm / 4046.8564;
  return acres < 1 ? `${Math.round(sqm).toLocaleString("en-KE")} m² (${acres.toFixed(2)} acres)` : `${acres.toFixed(2)} acres`;
}

function distanceKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

function showDistance(l, me) {
  const el = $("#detailDistance");
  if (!el) return;
  const km = distanceKm(me, { lat: l.latitude, lng: l.longitude });
  el.innerHTML = `<i class="icon-locate-fixed"></i> <b>${km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(km < 10 ? 1 : 0) + " km"}</b> <span class="muted">from you in a straight line — road distance is longer.</span>`;
}

// ---------- Init ----------
export function initListings() {
  renderCategoryChips();
  const countySel = $("#filterCounty");
  countySel.insertAdjacentHTML("beforeend", COUNTIES.map((c) => `<option>${esc(c)}</option>`).join(""));

  let t;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.filters.search = e.target.value; renderHome(); }, 200);
  });

  $("#filterForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const num = (v) => (v === "" ? null : Math.max(0, Number(v)));
    state.filters.minPrice = num(f.minPrice.value);
    state.filters.maxPrice = num(f.maxPrice.value);
    state.filters.county = f.county.value;
    state.filters.sort = f.sort.value;
    history.back();
    renderHome();
    document.dispatchEvent(new CustomEvent("filters-changed"));
  });

  onTabShow("saved", renderSaved);
  onOverlayClose("ov-detail", () => document.dispatchEvent(new CustomEvent("detail-closed")));

  registerActions({
    tab: (el) => switchTab(el.dataset.tab),
    openListing: (el) => openDetail(el.dataset.id),
    toggleSave: (el) => toggleSave(el.dataset.id),
    refreshListings: () => loadListings(true),
    setCategory: (el) => {
      state.filters.category = el.dataset.cat;
      renderCategoryChips();
      renderHome();
      document.dispatchEvent(new CustomEvent("filters-changed"));
    },
    openFilters: () => {
      const f = $("#filterForm");
      f.minPrice.value = state.filters.minPrice ?? "";
      f.maxPrice.value = state.filters.maxPrice ?? "";
      f.county.value = state.filters.county;
      f.sort.value = state.filters.sort;
      openOverlay("ov-filters");
    },
    resetFilters: () => {
      Object.assign(state.filters, { category: "All", search: "", minPrice: null, maxPrice: null, county: "", sort: "newest" });
      $("#searchInput").value = "";
      $("#filterForm").reset();
      renderCategoryChips();
      renderHome();
      document.dispatchEvent(new CustomEvent("filters-changed"));
    },
    callSeller: () => currentDetail?.sellerPhone && openExternal("tel:+" + currentDetail.sellerPhone),
    whatsappSeller: () => {
      if (!currentDetail?.sellerPhone) return;
      const text = `Hi, I'm interested in your land on Landier: "${currentDetail.title}" (${formatKsh(currentDetail.price)}). Is it still available?`;
      openExternal(`https://wa.me/${currentDetail.sellerPhone}?text=${encodeURIComponent(text)}`);
    },
    directions: (el) => {
      const l = currentDetail;
      if (!l) return;
      const mode = el.dataset.mode === "walking" ? "walking" : "driving";
      // Free turn-by-turn navigation in the Google Maps app (or browser); no API key involved.
      openExternal(`https://www.google.com/maps/dir/?api=1&destination=${l.latitude},${l.longitude}&travelmode=${mode}`);
    },
    detailDistance: async () => {
      const l = currentDetail;
      if (!l) return;
      const el = $("#detailDistance");
      el.innerHTML = `<span class="spinner dark" style="width:16px;height:16px"></span> <span class="muted">Getting your location…</span>`;
      try {
        const { getMyLocation } = await import("./map.js");
        state.myLocation = await getMyLocation();
        showDistance(l, state.myLocation);
      } catch (e) {
        el.innerHTML = `<span class="muted">${esc(e.message)}</span>`;
      }
    },
    viewOnMap: async () => {
      const l = currentDetail;
      if (!l) return;
      const { focusOnMap } = await import("./map.js");
      focusOnMap(l);
    },
    shareListing: async () => {
      const l = currentDetail;
      if (!l) return;
      const text = `${l.title} — ${formatKsh(l.price)} · ${listingLocation(l)}. Find it on Landier.`;
      const url = Number.isFinite(l.latitude) ? `https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}` : undefined;
      try {
        if (navigator.share) await navigator.share({ title: l.title, text, url });
        else { await navigator.clipboard.writeText(url ? `${text} ${url}` : text); toast("Copied to clipboard", "success"); }
      } catch (_) { /* user cancelled */ }
    }
  });
}
