// avatar.js — profile photo: choose → crop/zoom preview → compress → upload to Firebase Storage
// (avatars/{uid}/…) → save URL on users/{uid} and the public profiles/{uid} card. Remove restores initials.
import {
  auth, db, storage, doc, setDoc, serverTimestamp, deleteField, updateProfile,
  storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "./firebase.js";
import { state } from "./state.js";
import { $, toast, registerActions, openOverlay, closeOverlay, onOverlayClose, confirmDialog, setBusy } from "./ui.js";
import { savePublicProfile } from "./profiles.js";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_INPUT_BYTES = 15 * 1024 * 1024;   // what users may pick
const OUTPUT_SIZE = 512;                      // stored photo is 512×512 JPEG (~40–90 KB)

let img = null;       // HTMLImageElement being cropped
let objectUrl = null;
let scale = 1, minScale = 1, offX = 0, offY = 0; // image placement on the 600px canvas
let busy = false;

const canvas = () => $("#cropCanvas");

function storageError(e) {
  const code = e?.code || "";
  if (code === "storage/unauthorized") return "Upload blocked by Firebase Storage rules. Publish storage.rules from the repo.";
  if (["storage/bucket-not-found", "storage/project-not-found", "storage/no-default-bucket"].includes(code) || /bucket/i.test(e?.message || ""))
    return "Firebase Storage isn't set up yet. Enable Storage in the Firebase console.";
  if (code === "storage/retry-limit-exceeded" || code === "storage/canceled") return "Upload failed — check your connection and try again.";
  if (code === "storage/quota-exceeded") return "Storage quota exceeded on the Firebase project.";
  return e?.message || "Upload failed.";
}

// ---------- Drawing ----------
function clampOffsets() {
  const c = canvas();
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  offX = Math.min(0, Math.max(c.width - w, offX));
  offY = Math.min(0, Math.max(c.height - h, offY));
}

function draw() {
  const c = canvas();
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, c.width, c.height);
  if (!img) return;
  clampOffsets();
  ctx.drawImage(img, offX, offY, img.naturalWidth * scale, img.naturalHeight * scale);
}

function setZoom(z, cx = canvas().width / 2, cy = canvas().height / 2) {
  const newScale = minScale * z;
  // Zoom around the given canvas point.
  offX = cx - ((cx - offX) * newScale) / scale;
  offY = cy - ((cy - offY) * newScale) / scale;
  scale = newScale;
  draw();
}

function resetEditor() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  img = null;
  $("#cropEmpty").hidden = false;
  $("#cropZoomWrap").hidden = true;
  $("#avatarSave").disabled = true;
  $("#avatarProgress").hidden = true;
  $("#cropZoom").value = 1;
  draw();
}

function loadImage(src, crossOrigin = false) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    if (crossOrigin) i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't open that image."));
    i.src = src;
  });
}

async function useFile(file) {
  if (!file) return;
  if (!TYPES.includes(file.type)) return toast("Please choose a JPG, PNG or WebP image.", "error");
  if (file.size > MAX_INPUT_BYTES) return toast("That image is larger than 15 MB. Choose a smaller one.", "error");
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  try {
    img = await loadImage(objectUrl);
  } catch (e) {
    return toast(e.message, "error");
  }
  const c = canvas();
  minScale = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
  scale = minScale;
  offX = (c.width - img.naturalWidth * scale) / 2;
  offY = (c.height - img.naturalHeight * scale) / 2;
  $("#cropZoom").value = 1;
  $("#cropEmpty").hidden = true;
  $("#cropZoomWrap").hidden = false;
  $("#avatarSave").disabled = false;
  $("#avatarPickLabel").textContent = "Choose a different photo";
  draw();
}

function exportBlob() {
  const out = document.createElement("canvas");
  out.width = out.height = OUTPUT_SIZE;
  const k = OUTPUT_SIZE / canvas().width;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, offX * k, offY * k, img.naturalWidth * scale * k, img.naturalHeight * scale * k);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/jpeg", 0.86));
}

// ---------- Save / remove ----------
async function writePhoto(url, path) {
  const uid = state.user.uid;
  await setDoc(doc(db, "users", uid), url
    ? { photoURL: url, photoPath: path, updatedAt: serverTimestamp() }
    : { photoURL: deleteField(), photoPath: deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  await savePublicProfile(uid, { fullName: state.profile?.fullName, photoURL: url || "" });
  try { await updateProfile(auth.currentUser, { photoURL: url || null }); } catch (_) {}
  state.profile = { ...state.profile, photoURL: url || undefined, photoPath: path || undefined };
  if (!url) { delete state.profile.photoURL; delete state.profile.photoPath; }
  document.dispatchEvent(new CustomEvent("profile-updated"));
}

async function deleteOldFile(path) {
  if (!path || !path.startsWith(`avatars/${state.user.uid}/`)) return;
  try { await deleteObject(storageRef(storage, path)); } catch (_) { /* already gone */ }
}

async function save() {
  if (!img || busy || !state.user) return;
  busy = true;
  const btn = $("#avatarSave");
  setBusy(btn, true, "Preparing…");
  const progress = $("#avatarProgress");
  const bar = $("#avatarProgressBar");
  const text = $("#avatarProgressText");
  try {
    const blob = await exportBlob();
    if (!blob) throw new Error("Couldn't process the image.");
    const uid = state.user.uid;
    const path = `avatars/${uid}/${Date.now()}.jpg`;
    const oldPath = state.profile?.photoPath;
    progress.hidden = false;
    bar.style.width = "0%";
    text.textContent = "Uploading… 0%";
    setBusy(btn, true, "Uploading…");
    const task = uploadBytesResumable(storageRef(storage, path), blob, {
      contentType: "image/jpeg", cacheControl: "public,max-age=31536000"
    });
    await new Promise((resolve, reject) => {
      task.on("state_changed", (snap) => {
        const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
        bar.style.width = pct + "%";
        text.textContent = `Uploading… ${pct}%`;
      }, reject, resolve);
    });
    text.textContent = "Saving…";
    const url = await getDownloadURL(task.snapshot.ref);
    await writePhoto(url, path);
    await deleteOldFile(oldPath);
    toast("Profile photo updated", "success");
    closeOverlay();
  } catch (e) {
    console.error(e);
    toast(storageError(e), "error");
    progress.hidden = true;
  } finally {
    busy = false;
    setBusy(btn, false);
  }
}

async function remove() {
  if (busy || !state.user) return;
  const ok = await confirmDialog({ title: "Remove profile photo?", message: "Your initials will be shown instead.", confirmText: "Remove", danger: true });
  if (!ok) return;
  busy = true;
  const btn = $("#avatarRemove");
  setBusy(btn, true, "Removing…");
  try {
    const oldPath = state.profile?.photoPath;
    await writePhoto(null, null);
    await deleteOldFile(oldPath);
    toast("Profile photo removed", "success");
    closeOverlay();
  } catch (e) {
    toast(storageError(e), "error");
  } finally {
    busy = false;
    setBusy(btn, false);
  }
}

// Used by account deletion.
export async function deleteAvatarFile() {
  await deleteOldFile(state.profile?.photoPath);
}

// ---------- Open editor ----------
async function openEditor() {
  if (!state.user) return;
  resetEditor();
  $("#avatarPickLabel").textContent = state.profile?.photoURL ? "Choose a new photo" : "Choose photo";
  $("#avatarRemove").hidden = !state.profile?.photoURL;
  openOverlay("ov-avatar");
  // Show the current photo as a preview (not editable until a new file is picked).
  if (state.profile?.photoURL) {
    try {
      const current = await loadImage(state.profile.photoURL);
      const c = canvas();
      c.getContext("2d").drawImage(current, 0, 0, c.width, c.height);
      $("#cropEmpty").hidden = true;
    } catch (_) {}
  }
}

export function initAvatar() {
  draw();
  $("#avatarInput").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    useFile(f);
  });
  $("#cropEmpty").addEventListener("click", () => $("#avatarInput").click());
  $("#cropZoom").addEventListener("input", (e) => img && setZoom(Number(e.target.value)));

  // Drag to reposition (mouse + touch via pointer events), pinch handled by the slider.
  const c = canvas();
  let drag = null;
  const toCanvas = (ev) => {
    const r = c.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * c.width, y: ((ev.clientY - r.top) / r.height) * c.height };
  };
  c.addEventListener("pointerdown", (ev) => {
    if (!img) return;
    c.setPointerCapture(ev.pointerId);
    const p = toCanvas(ev);
    drag = { x: p.x, y: p.y, ox: offX, oy: offY };
  });
  c.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const p = toCanvas(ev);
    offX = drag.ox + (p.x - drag.x);
    offY = drag.oy + (p.y - drag.y);
    draw();
  });
  const end = () => { drag = null; };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  c.addEventListener("wheel", (ev) => {
    if (!img) return;
    ev.preventDefault();
    const z = Math.min(4, Math.max(1, Number($("#cropZoom").value) * (ev.deltaY < 0 ? 1.08 : 0.92)));
    $("#cropZoom").value = z;
    const p = toCanvas(ev);
    setZoom(z, p.x, p.y);
  }, { passive: false });

  onOverlayClose("ov-avatar", resetEditor);
  registerActions({ editAvatar: openEditor, saveAvatar: save, removeAvatar: remove });
}
