// settings.js — profile, password, theme, legal, support, account deletion.
import {
  auth, db, doc, collection, getDocs, setDoc, deleteDoc, writeBatch, serverTimestamp,
  updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser, signOut
} from "./firebase.js";
import { state } from "./state.js";
import {
  $, toast, friendlyError, setBusy, registerActions, openOverlay, normalizeKePhone,
  applyTheme, savedTheme, promptDialog, confirmDialog, openExternal
} from "./ui.js";
import { APP_VERSION, SUPPORT_EMAIL } from "./config.js";
import { fetchMyListings, deleteListingById } from "./seller.js";
import { savePublicProfile } from "./profiles.js";
import { deleteAvatarFile } from "./avatar.js";

export function openSettings() {
  const f = $("#profileForm");
  f.name.value = state.profile?.fullName || "";
  f.phone.value = state.profile?.phone ? "0" + state.profile.phone.slice(3) : "";
  $("#passwordForm").reset();
  $("#darkToggle").checked = savedTheme() === "dark";
  $("#appVersion").textContent = APP_VERSION;
  openOverlay("ov-settings");
}

async function reauth(password) {
  const cred = EmailAuthProvider.credential(auth.currentUser.email, password);
  await reauthenticateWithCredential(auth.currentUser, cred);
}

export function initSettings() {
  $("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const fullName = f.name.value.trim();
    const phone = normalizeKePhone(f.phone.value);
    if (fullName.length < 2) return toast("Enter your full name", "error");
    if (!phone) return toast("Enter a valid Kenyan phone number", "error");
    const btn = f.querySelector("[type=submit]");
    setBusy(btn, true, "Saving…");
    try {
      await setDoc(doc(db, "users", state.user.uid), { fullName, phone, email: auth.currentUser.email, updatedAt: serverTimestamp() }, { merge: true });
      await updateProfile(auth.currentUser, { displayName: fullName });
      Object.assign(state.profile, { fullName, phone });
      await savePublicProfile(state.user.uid, { fullName, photoURL: state.profile.photoURL });
      // Keep contact details on existing listings in sync.
      const mine = await fetchMyListings().catch(() => []);
      const stale = mine.filter((l) => l.sellerName !== fullName || l.sellerPhone !== phone);
      for (let i = 0; i < stale.length; i += 400) {
        const b = writeBatch(db);
        stale.slice(i, i + 400).forEach((l) => b.update(doc(db, "landListings", l.id), { sellerName: fullName, sellerPhone: phone }));
        await b.commit();
      }
      document.dispatchEvent(new CustomEvent("profile-updated"));
      toast("Profile saved", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });

  $("#passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value.length < 8) return toast("New password must be at least 8 characters", "error");
    if (f.next.value !== f.confirm.value) return toast("New passwords don't match", "error");
    const btn = f.querySelector("[type=submit]");
    setBusy(btn, true, "Updating…");
    try {
      await reauth(f.current.value);
      await updatePassword(auth.currentUser, f.next.value);
      f.reset();
      toast("Password changed", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });

  $("#darkToggle").addEventListener("change", (e) => {
    applyTheme(e.target.checked ? "dark" : "light");
    document.dispatchEvent(new CustomEvent("theme-changed"));
  });

  registerActions({
    openSettings,
    openLegal: () => openOverlay("ov-legal"),
    contactSupport: () => openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Landier support")}`),
    deleteAccount: async () => {
      const ok = await confirmDialog({
        title: "Delete your account?",
        message: "This permanently deletes your profile, all your listings and saved land. This can't be undone.",
        confirmText: "Continue", danger: true
      });
      if (!ok) return;
      const password = await promptDialog({
        title: "Confirm with your password",
        confirmText: "Delete account",
        danger: true,
        input: { type: "password", placeholder: "Password" }
      });
      if (!password) return;
      toast("Deleting account…");
      try {
        await reauth(password);
        const uid = state.user.uid;
        const mine = await fetchMyListings().catch(() => []);
        for (const l of mine) await deleteListingById(l.id);
        const saved = await getDocs(collection(db, "users", uid, "saved"));
        for (const d of saved.docs) await deleteDoc(d.ref);
        await deleteAvatarFile();
        try { await deleteDoc(doc(db, "profiles", uid)); } catch (_) {}
        await deleteDoc(doc(db, "users", uid));
        await deleteUser(auth.currentUser);
        toast("Your account has been deleted", "success");
      } catch (err) {
        toast(friendlyError(err), "error");
        if (err?.code === "auth/requires-recent-login") await signOut(auth);
      }
    }
  });
}
