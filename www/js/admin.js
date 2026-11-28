// admin.js — moderation queue for users listed in the Firestore `admins` collection.
import { db, collection, doc, updateDoc, where, serverTimestamp } from "./firebase.js";
import { state, cacheListing } from "./state.js";
import {
  $, $$, esc, safeImg, formatKsh, timeAgo, toast, friendlyError, registerActions,
  openOverlay, closeOverlay, promptDialog, confirmDialog
} from "./ui.js";
import { fromSnap, queryWithFallback, byNewest, emptyState, listingLocation, loadListings, openDetail } from "./listings.js";
import { deleteListingById } from "./seller.js";

let currentStatus = "pending";

export async function refreshPendingCount() {
  if (!state.isAdmin) return;
  try {
    const snap = await queryWithFallback(collection(db, "landListings"), [where("status", "==", "pending")]);
    const n = snap.size;
    $("#pendingCount").textContent = n ? String(n) : "";
    $("#pendingCount").hidden = !n;
  } catch (e) { console.warn(e); }
}

function row(l) {
  return `
    <div class="row-card">
      <img src="${safeImg(l.coverThumb)}" alt="" data-action="openListing" data-id="${esc(l.id)}">
      <div class="rc-body">
        <b>${esc(l.title)}</b>
        <span class="card-price">${formatKsh(l.price)}</span>
        <span class="muted small">${esc(listingLocation(l))} · ${esc(l.size || "")}</span>
        <span class="muted small">By ${esc(l.sellerName || "?")} · ${l.sellerPhone ? "+" + esc(l.sellerPhone) : "no phone"} · ${esc(timeAgo(l.createdAt))}</span>
        ${l.rejectionReason ? `<span class="small" style="color:var(--danger)">${esc(l.rejectionReason)}</span>` : ""}
        <div class="rc-actions">
          <button class="btn btn-ghost" data-action="openListing" data-id="${esc(l.id)}"><i class="icon-eye"></i> View</button>
          ${l.status !== "approved" ? `<button class="btn btn-primary" data-action="adminApprove" data-id="${esc(l.id)}"><i class="icon-check"></i> Approve</button>` : ""}
          ${l.status !== "rejected" ? `<button class="btn btn-ghost" data-action="adminReject" data-id="${esc(l.id)}"><i class="icon-x"></i> ${l.status === "approved" ? "Unpublish" : "Reject"}</button>` : ""}
          <button class="btn btn-ghost" data-action="adminDelete" data-id="${esc(l.id)}" style="color:var(--danger)"><i class="icon-trash-2"></i></button>
        </div>
      </div>
    </div>`;
}

async function loadQueue() {
  const body = $("#adminBody");
  body.innerHTML = `<div class="empty"><span class="spinner dark"></span></div>`;
  try {
    const snap = await queryWithFallback(collection(db, "landListings"), [where("status", "==", currentStatus)]);
    const items = snap.docs.map(fromSnap).sort(currentStatus === "pending" ? (a, b) => -byNewest(a, b) : byNewest);
    items.forEach(cacheListing);
    body.innerHTML = items.length
      ? `<div class="rows">${items.map(row).join("")}</div>`
      : emptyState("icon-circle-check", currentStatus === "pending" ? "All caught up" : "Nothing here", currentStatus === "pending" ? "No listings waiting for review." : "");
  } catch (e) {
    body.innerHTML = emptyState("icon-shield-x", "Couldn't load", friendlyError(e));
  }
  refreshPendingCount();
}

async function moderate(id, status, reason = "") {
  try {
    await updateDoc(doc(db, "landListings", id), {
      status, rejectionReason: reason, moderatedBy: state.user.uid, moderatedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    const l = state.listingById.get(id);
    if (l) Object.assign(l, { status, rejectionReason: reason });
    toast(status === "approved" ? "Approved — now live" : "Listing rejected", "success");
    loadListings(true);
    if ($("#ov-detail").classList.contains("active")) { closeOverlay(); setTimeout(() => openDetail(id), 350); }
    if ($("#ov-admin").classList.contains("active")) loadQueue();
  } catch (e) {
    toast(friendlyError(e), "error");
  }
}

export function initAdmin() {
  registerActions({
    openAdmin: () => {
      if (!state.isAdmin) return;
      openOverlay("ov-admin");
      loadQueue();
    },
    refreshAdmin: () => loadQueue(),
    adminTab: (el) => {
      currentStatus = el.dataset.status;
      $$("#adminSeg button").forEach((b) => b.classList.toggle("active", b === el));
      loadQueue();
    },
    adminApprove: (el) => moderate(el.dataset.id, "approved"),
    adminFeature: async (el) => {
      const id = el.dataset.id;
      const l = state.listingById.get(id);
      const featured = !l?.featured;
      try {
        await updateDoc(doc(db, "landListings", id), { featured, updatedAt: serverTimestamp() });
        if (l) l.featured = featured;
        toast(featured ? "Featured on the home page" : "Removed from featured", "success");
        loadListings(true);
        if ($("#ov-detail").classList.contains("active")) { closeOverlay(); setTimeout(() => openDetail(id), 350); }
      } catch (e) { toast(friendlyError(e), "error"); }
    },
    adminReject: async (el) => {
      const reason = await promptDialog({
        title: "Reason for rejection",
        message: "The seller will see this message.",
        confirmText: "Reject",
        input: { placeholder: "e.g. Photos don't show the land; add a title deed status" }
      });
      if (reason === null) return;
      moderate(el.dataset.id, "rejected", reason.trim().slice(0, 300) || "Didn't meet our listing guidelines.");
    },
    adminDelete: async (el) => {
      if (!(await confirmDialog({ title: "Delete permanently?", message: "Use this for spam or fraud.", confirmText: "Delete", danger: true }))) return;
      try {
        await deleteListingById(el.dataset.id);
        toast("Deleted", "success");
        if ($("#ov-detail").classList.contains("active")) closeOverlay();
        if ($("#ov-admin").classList.contains("active")) loadQueue();
      } catch (e) { toast(friendlyError(e), "error"); }
    }
  });
}
