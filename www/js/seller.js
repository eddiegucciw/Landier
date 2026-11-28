// seller.js — create/edit listings (photos + map location), My listings, sold/relist/delete.
import {
  auth, db, collection, doc, getDocs, setDoc, updateDoc, writeBatch, where, serverTimestamp, deleteField
} from "./firebase.js";
import { state, cacheListing } from "./state.js";
import {
  $, esc, safeImg, formatKsh, timeAgo, toast, friendlyError, setBusy, registerActions,
  openOverlay, closeOverlay, onOverlayClose, confirmDialog, alertDialog, switchTab
} from "./ui.js";
import { LAND_USES, TITLE_STATUSES, COUNTIES, MAX_PHOTOS } from "./config.js";
import {
  fromSnap, fetchListing, queryWithFallback, byNewest, STATUS_LABEL, emptyState,
  listingLocation, openDetail, loadListings, renderHome
} from "./listings.js";
import { createPicker, formatArea } from "./map.js";
import { refreshVerification, resendVerification } from "./auth.js";

// ---------- Image processing ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });
}

function toJpeg(img, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

// Each photo is stored in its own Firestore document (1 MiB limit), so keep it < ~700 KB.
const MAX_PHOTO_CHARS = 700_000;
async function processPhoto(src) {
  const img = await loadImage(src);
  let dim = 1280, q = 0.75;
  let data = toJpeg(img, dim, q);
  while (data.length > MAX_PHOTO_CHARS && (q > 0.45 || dim > 800)) {
    if (q > 0.45) q -= 0.1; else dim -= 160;
    data = toJpeg(img, dim, q);
  }
  return data;
}
async function makeThumb(dataUrl) {
  return toJpeg(await loadImage(dataUrl), 480, 0.6);
}

// ---------- Form state ----------
let editing = null;       // listing being edited (or null for new)
let photos = [];          // [{ data }]
let photosDirty = false;
let picker = null;
let location = null;
let boundary = { points: [], area: 0, error: null };

function fillSelect(sel, items, placeholder) {
  sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") +
    items.map((v) => `<option>${esc(v)}</option>`).join("");
}

function renderThumbs() {
  $("#photoThumbs").innerHTML = photos.map((p, i) => `
    <div class="thumb" data-action="makeCover" data-i="${i}">
      <img src="${safeImg(p.data)}" alt="">
      ${i === 0 ? '<span class="cover">Cover</span>' : ""}
      <button type="button" data-action="removePhoto" data-i="${i}" aria-label="Remove"><i class="icon-x"></i></button>
    </div>`).join("");
  $(".upload b").textContent = photos.length ? `Add more (${photos.length}/${MAX_PHOTOS})` : "Add photos";
}

function setCoordsLabel() {
  $("#pickerCoords").textContent = location
    ? `📍 ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
    : "No location selected";
}

export async function openListingForm(listing = null) {
  if (!state.user) return;
  editing = listing;
  photos = [];
  photosDirty = false;
  location = listing && Number.isFinite(listing.latitude) ? { lat: listing.latitude, lng: listing.longitude } : null;
  boundary = { points: (listing?.boundary?.points || []).slice(), area: listing?.boundary?.areaSqm || 0, error: null };
  setPickerMode("pin");
  renderBoundaryInfo();

  const f = $("#listingForm");
  f.reset();
  f.querySelectorAll(".fg.invalid").forEach((x) => x.classList.remove("invalid"));
  $("#formTitle").textContent = listing ? "Edit listing" : "List new land";
  $("#publishBtn").innerHTML = listing ? 'Save changes <i class="icon-check"></i>' : 'Submit for review <i class="icon-check"></i>';
  $("#formNote").textContent = state.isAdmin
    ? "As an admin, your listings go live immediately."
    : listing
      ? "Edited listings are re-checked by our team before going live again."
      : "Listings are reviewed by our team before they go live — usually within 24 hours.";
  if (listing) {
    f.title.value = listing.title || "";
    f.price.value = listing.price || "";
    f.size.value = listing.size || "";
    f.landUse.value = listing.landUse || LAND_USES[0];
    f.titleStatus.value = listing.titleStatus || TITLE_STATUSES[0];
    f.county.value = listing.county || "";
    f.town.value = listing.town || "";
    f.description.value = listing.description || "";
  }
  renderThumbs();
  setCoordsLabel();
  openOverlay("ov-form");

  if (listing) {
    try {
      const snap = await getDocs(collection(db, "landListings", listing.id, "images"));
      photos = snap.docs.map((d) => d.data()).sort((a, b) => a.order - b.order).map((d) => ({ data: d.data }));
      renderThumbs();
    } catch (e) { console.warn(e); }
  }

  // Fresh map each time (the container is re-used).
  picker?.destroy?.();
  $("#pickerMap").innerHTML = "";
  picker = await createPicker($("#pickerMap"), location, (pos) => {
    location = pos;
    setCoordsLabel();
    $("#pickerMap").closest(".fg").classList.remove("invalid");
  }, {
    boundary: boundary.points,
    modesEl: $("#pickerModes"),
    onBoundary: (points, area, error) => {
      boundary = { points, area, error };
      renderBoundaryInfo();
    }
  });
}

function setPickerMode(mode) {
  document.querySelectorAll("#pickerSeg [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("#boundaryTools").hidden = mode !== "boundary";
  $("#pickerHint").textContent = mode === "boundary"
    ? "Tap each corner of the land in order. Switch to satellite to see the plot."
    : "Tap the map or drag the pin to the land's position.";
  picker?.setMode?.(mode);
}

function renderBoundaryInfo() {
  const n = boundary.points.length;
  $("#boundaryArea").textContent = n >= 3 && boundary.area
    ? `${n} points · ≈ ${formatArea(boundary.area)}`
    : n ? `${n} point${n === 1 ? "" : "s"} — add ${3 - n} more` : "No boundary";
  const err = $("#boundaryError");
  err.hidden = !boundary.error || n < 3;
  err.textContent = boundary.error || "";
}

function validate(f) {
  const errors = [];
  const mark = (name, bad, msg) => {
    const fg = (f[name] || f.querySelector(`[name=${name}]`))?.closest(".fg");
    fg?.classList.toggle("invalid", bad);
    if (bad) errors.push(msg);
  };
  const title = f.title.value.trim();
  const price = Number(f.price.value);
  mark("title", title.length < 5, "Title must be at least 5 characters");
  mark("price", !(price >= 1000 && price <= 1e11), "Enter a valid price in KSh");
  mark("size", f.size.value.trim().length < 1, "Enter the land size");
  mark("county", !f.county.value, "Choose a county");
  mark("town", f.town.value.trim().length < 2, "Enter the town or area");
  mark("description", f.description.value.trim().length < 20, "Description must be at least 20 characters");
  $("#photoInput").closest(".fg").classList.toggle("invalid", photos.length === 0);
  if (!photos.length) errors.push("Add at least one photo");
  $("#pickerMap").closest(".fg").classList.toggle("invalid", !location);
  if (!location) errors.push("Set the land's location on the map");
  if (boundary.points.length && boundary.error) errors.push("Boundary: " + boundary.error);
  return errors;
}

async function ensureCanPublish() {
  const user = auth.currentUser;
  if (!user.emailVerified) {
    const ok = await refreshVerification().catch(() => false);
    if (!ok) {
      const resend = await confirmDialog({
        title: "Verify your email first",
        message: `To keep Landier free of fake listings, please verify ${user.email} before listing land. Check your inbox for the link.`,
        confirmText: "Resend link", cancelText: "Close"
      });
      if (resend) resendVerification();
      return false;
    }
  }
  if (!state.profile?.phone) {
    const go = await confirmDialog({
      title: "Add your phone number",
      message: "Buyers need a phone number to reach you. Add one in Settings.",
      confirmText: "Open settings"
    });
    if (go) { closeOverlay(); setTimeout(() => import("./settings.js").then((m) => m.openSettings()), 350); }
    return false;
  }
  return true;
}

async function submitListing(e) {
  e.preventDefault();
  const f = e.target;
  const errors = validate(f);
  if (errors.length) return toast(errors[0], "error");
  const btn = $("#publishBtn");
  setBusy(btn, true, "Checking…");
  try {
    if (!(await ensureCanPublish())) return;

    setBusy(btn, true, "Preparing photos…");
    const coverThumb = photosDirty || !editing ? await makeThumb(photos[0].data) : editing.coverThumb;
    const town = f.town.value.trim();
    const county = f.county.value;
    const status = state.isAdmin ? (editing?.status === "sold" ? "sold" : "approved") : "pending";
    const data = {
      title: f.title.value.trim(),
      price: Math.round(Number(f.price.value)),
      size: f.size.value.trim(),
      landUse: f.landUse.value,
      titleStatus: f.titleStatus.value,
      county, town,
      location: `${town}, ${county}`,
      description: f.description.value.trim(),
      latitude: location.lat,
      longitude: location.lng,
      ...boundaryField(),
      sellerName: state.profile.fullName || state.user.displayName || "Seller",
      sellerPhone: state.profile.phone,
      coverThumb,
      imageCount: photos.length,
      status,
      rejectionReason: "",
      updatedAt: serverTimestamp()
    };

    setBusy(btn, true, editing ? "Saving…" : "Publishing…");
    let ref;
    if (editing) {
      ref = doc(db, "landListings", editing.id);
      await updateDoc(ref, data);
    } else {
      ref = doc(collection(db, "landListings"));
      await setDoc(ref, { ...data, sellerId: state.user.uid, createdAt: serverTimestamp() });
    }

    if (photosDirty || !editing) {
      const imgCol = collection(db, "landListings", ref.id, "images");
      if (editing) {
        const old = await getDocs(imgCol);
        const b = writeBatch(db);
        old.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
      }
      for (let i = 0; i < photos.length; i++) {
        setBusy(btn, true, `Uploading photo ${i + 1} of ${photos.length}…`);
        await setDoc(doc(imgCol, String(i)), { data: photos[i].data, order: i });
      }
    }

    if (data.boundary && !Array.isArray(data.boundary.points)) data.boundary = null;
    cacheListing({ ...(editing || {}), ...data, id: ref.id, sellerId: state.user.uid, createdAt: editing?.createdAt || { seconds: Date.now() / 1000 } });
    closeOverlay();
    if (state.isAdmin) {
      toast(editing ? "Listing updated" : "Listing is live!", "success");
      loadListings(true);
    } else {
      // Remove from public feed until re-approved.
      state.listings = state.listings.filter((l) => l.id !== ref.id);
      renderHome();
      alertDialog(editing ? "Changes submitted" : "Listing submitted 🎉",
        "Our team will review it shortly. You can track its status in My listings.");
    }
    refreshMyListings();
  } catch (err) {
    toast(friendlyError(err), "error");
  } finally {
    setBusy(btn, false);
  }
}

// Boundary is optional. Saved as {points:[{lat,lng}], areaSqm} (Firestore has no nested arrays;
// map.js converts it to a GeoJSON Polygon for display).
function boundaryField() {
  if (boundary.points.length >= 3 && !boundary.error) {
    return { boundary: {
      points: boundary.points.map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })),
      areaSqm: Math.round(boundary.area)
    } };
  }
  return editing?.boundary ? { boundary: deleteField() } : {};
}

// ---------- My listings ----------
export let myListings = [];

export async function fetchMyListings() {
  if (!state.user) return [];
  const snap = await queryWithFallback(collection(db, "landListings"), [where("sellerId", "==", state.user.uid)]);
  myListings = snap.docs.map(fromSnap).sort(byNewest);
  myListings.forEach(cacheListing);
  document.dispatchEvent(new CustomEvent("my-listings-changed"));
  return myListings;
}

function rowHtml(l) {
  const [label, cls] = STATUS_LABEL[l.status] || ["", ""];
  return `
    <div class="row-card">
      <img src="${safeImg(l.coverThumb)}" alt="" data-action="openListing" data-id="${esc(l.id)}">
      <div class="rc-body">
        <b>${esc(l.title)}</b>
        <span class="card-price">${formatKsh(l.price)}</span>
        <span class="muted small">${esc(listingLocation(l))} · ${esc(timeAgo(l.createdAt))}</span>
        <span><span class="pill ${cls}">${esc(label)}</span></span>
        ${l.status === "rejected" && l.rejectionReason ? `<span class="small" style="color:var(--danger)">${esc(l.rejectionReason)}</span>` : ""}
        <div class="rc-actions">
          <button class="btn btn-ghost" data-action="editListing" data-id="${esc(l.id)}"><i class="icon-pencil"></i> Edit</button>
          ${l.status === "approved" ? `<button class="btn btn-ghost" data-action="markSold" data-id="${esc(l.id)}"><i class="icon-badge-check"></i> Sold</button>` : ""}
          ${l.status === "sold" ? `<button class="btn btn-ghost" data-action="relist" data-id="${esc(l.id)}"><i class="icon-rotate-ccw"></i> Relist</button>` : ""}
          <button class="btn btn-ghost" data-action="deleteListing" data-id="${esc(l.id)}" style="color:var(--danger)"><i class="icon-trash-2"></i></button>
        </div>
      </div>
    </div>`;
}

async function refreshMyListings() {
  const body = $("#myListingsBody");
  try {
    await fetchMyListings();
    body.innerHTML = myListings.length
      ? `<div class="rows">${myListings.map(rowHtml).join("")}</div>`
      : emptyState("icon-map-pin-plus", "You haven't listed any land", "List your first plot — it's free.", `<button class="btn btn-primary sm" data-action="newListing">List land</button>`);
  } catch (e) {
    body.innerHTML = emptyState("icon-wifi-off", "Couldn't load your listings", friendlyError(e));
  }
}

async function openMyListings() {
  $("#myListingsBody").innerHTML = `<div class="empty"><span class="spinner dark"></span></div>`;
  openOverlay("ov-mylistings");
  refreshMyListings();
}

async function setStatus(id, status, msg) {
  try {
    await updateDoc(doc(db, "landListings", id), { status, updatedAt: serverTimestamp() });
    const l = state.listingById.get(id);
    if (l) l.status = status;
    if (status !== "approved") state.listings = state.listings.filter((x) => x.id !== id);
    renderHome();
    toast(msg, "success");
    refreshMyListings();
    if ($("#ov-detail").classList.contains("active")) { closeOverlay(); setTimeout(() => openDetail(id), 350); }
  } catch (e) {
    toast(friendlyError(e), "error");
  }
}

export async function deleteListingById(id) {
  const imgs = await getDocs(collection(db, "landListings", id, "images"));
  const b = writeBatch(db);
  imgs.docs.forEach((d) => b.delete(d.ref));
  b.delete(doc(db, "landListings", id));
  await b.commit();
  state.listings = state.listings.filter((x) => x.id !== id);
  state.listingById.delete(id);
  renderHome();
}

export function initSeller() {
  fillSelect($("#formLandUse"), LAND_USES);
  fillSelect($("#formTitleStatus"), TITLE_STATUSES);
  fillSelect($("#formCounty"), COUNTIES, "Select…");

  $("#listingForm").addEventListener("submit", submitListing);
  $("#listingForm").addEventListener("input", (e) => e.target.closest(".fg")?.classList.remove("invalid"));

  $("#photoInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const room = MAX_PHOTOS - photos.length;
    if (!room) return toast(`Maximum ${MAX_PHOTOS} photos`, "error");
    if (files.length > room) toast(`Only the first ${room} photo(s) were added (max ${MAX_PHOTOS})`, "info");
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith("image/")) continue;
      const url = URL.createObjectURL(file);
      try {
        photos.push({ data: await processPhoto(url) });
        photosDirty = true;
        renderThumbs();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    $("#photoInput").closest(".fg").classList.remove("invalid");
  });

  $("#pickerSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("[data-action=pickerSearch]").click(); }
  });

  onOverlayClose("ov-form", () => { picker?.destroy?.(); picker = null; });

  registerActions({
    newListing: () => openListingForm(null),
    openMyListings,
    editListing: async (el) => {
      const l = await fetchListing(el.dataset.id, { fresh: true }).catch(() => null);
      if (l) openListingForm(l);
    },
    removePhoto: (el) => {
      photos.splice(Number(el.dataset.i), 1);
      photosDirty = true;
      renderThumbs();
    },
    makeCover: (el) => {
      const i = Number(el.dataset.i);
      if (i === 0) return;
      photos.unshift(...photos.splice(i, 1));
      photosDirty = true;
      renderThumbs();
      toast("Cover photo updated", "success");
    },
    pickerMode: (el) => setPickerMode(el.dataset.mode),
    boundaryUndo: () => picker?.undo?.(),
    boundaryClear: async () => {
      if (!boundary.points.length) return;
      if (await confirmDialog({ title: "Clear boundary?", message: "All boundary points will be removed.", confirmText: "Clear" })) picker?.clear?.();
    },
    pickerSearch: async () => {
      const q = $("#pickerSearch").value.trim();
      if (!q || !picker) return;
      try { await picker.search(q); } catch (e) { toast(e.message, "error"); }
    },
    pickerLocate: async (el) => {
      if (!picker) return;
      setBusy(el, true, "");
      try { await picker.locate(); toast("Location set — drag the pin to adjust", "success"); }
      catch (e) { toast(e.message, "error"); }
      finally { setBusy(el, false); }
    },
    markSold: async (el) => {
      if (await confirmDialog({ title: "Mark as sold?", message: "It will be removed from search results.", confirmText: "Mark sold" }))
        setStatus(el.dataset.id, "sold", "Marked as sold");
    },
    relist: async (el) => {
      if (await confirmDialog({ title: "Relist this land?", message: "It will be reviewed again before going live.", confirmText: "Relist" }))
        setStatus(el.dataset.id, state.isAdmin ? "approved" : "pending", "Submitted for review");
    },
    deleteListing: async (el) => {
      const ok = await confirmDialog({ title: "Delete listing?", message: "This permanently removes the listing and its photos.", confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteListingById(el.dataset.id);
        toast("Listing deleted", "success");
        if ($("#ov-detail").classList.contains("active")) closeOverlay();
        refreshMyListings();
      } catch (e) { toast(friendlyError(e), "error"); }
    }
  });
}
