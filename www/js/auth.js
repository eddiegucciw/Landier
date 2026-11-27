// auth.js — sign in, register, password reset, email verification, profile bootstrap.
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile, reload,
  doc, getDoc, setDoc, serverTimestamp
} from "./firebase.js";
import { state } from "./state.js";
import { $, $$, toast, friendlyError, setBusy, registerActions, normalizeKePhone, alertDialog } from "./ui.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function showView(view) {
  $$("#authScreen .auth-card").forEach((f) => (f.hidden = f.dataset.view !== view));
}

export async function loadProfile(user) {
  const ref = doc(db, "users", user.uid);
  let snap;
  try { snap = await getDoc(ref); } catch (e) { console.warn("profile read failed", e); }
  if (snap && snap.exists()) return snap.data();
  // Registration writes the profile right after creating the account; give it a moment.
  await new Promise((r) => setTimeout(r, 2000));
  try { snap = await getDoc(ref); } catch (_) {}
  if (snap && snap.exists()) return snap.data();
  // Account created elsewhere (e.g. Firebase console): create a minimal profile.
  const profile = {
    fullName: user.displayName || user.email.split("@")[0],
    email: user.email,
    phone: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  try { await setDoc(ref, profile, { merge: true }); } catch (e) { console.warn("profile create failed", e); }
  return profile;
}

export async function checkAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch (_) {
    return false;
  }
}

// Reload the auth user so a just-clicked verification link is picked up.
export async function refreshVerification() {
  if (!auth.currentUser) return false;
  await reload(auth.currentUser);
  if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
  return auth.currentUser.emailVerified;
}

export async function resendVerification() {
  if (!auth.currentUser) return;
  try {
    await sendEmailVerification(auth.currentUser);
    toast("Verification email sent to " + auth.currentUser.email, "success");
  } catch (e) {
    toast(friendlyError(e), "error");
  }
}

export function initAuth({ onSignedIn, onSignedOut }) {
  // Login
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!EMAIL_RE.test(email)) return toast("Enter a valid email address", "error");
    if (!password) return toast("Enter your password", "error");
    const btn = f.querySelector("[type=submit]");
    setBusy(btn, true, "Signing in…");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      f.reset();
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });

  // Register
  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    const phone = normalizeKePhone(f.phone.value);
    const email = f.email.value.trim();
    const password = f.password.value;
    if (name.length < 2) return toast("Enter your full name", "error");
    if (!phone) return toast("Enter a valid Kenyan phone number", "error");
    if (!EMAIL_RE.test(email)) return toast("Enter a valid email address", "error");
    if (password.length < 8) return toast("Password must be at least 8 characters", "error");
    if (password !== f.confirm.value) return toast("Passwords do not match", "error");
    if (!f.terms.checked) return toast("Please accept the Terms & Privacy Policy", "error");

    const btn = f.querySelector("[type=submit]");
    setBusy(btn, true, "Creating account…");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        fullName: name, email, phone,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      try { await sendEmailVerification(cred.user); } catch (_) {}
      f.reset();
      // onAuthStateChanged may have fired before the profile was written; refresh it.
      state.profile = { fullName: name, email, phone };
      document.dispatchEvent(new CustomEvent("profile-updated"));
      alertDialog("Welcome to Landier!", `We've sent a verification link to ${email}. Verify your email to start listing land.`);
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });

  // Forgot password
  $("#forgotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!EMAIL_RE.test(email)) return toast("Enter a valid email address", "error");
    const btn = f.querySelector("[type=submit]");
    setBusy(btn, true, "Sending…");
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      // Don't reveal whether an account exists, except for network errors.
      if (err?.code === "auth/network-request-failed") { setBusy(btn, false); return toast(friendlyError(err), "error"); }
    }
    setBusy(btn, false);
    f.reset();
    alertDialog("Check your inbox", "If an account exists for that email, a reset link is on its way.");
    showView("login");
  });

  registerActions({
    authView: (el) => showView(el.dataset.view),
    togglePwd: (el) => {
      const input = el.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      el.querySelector("i").className = show ? "icon-eye-off" : "icon-eye";
    },
    resendVerification: () => resendVerification(),
    checkVerified: async () => {
      try {
        const ok = await refreshVerification();
        document.dispatchEvent(new CustomEvent("profile-updated"));
        toast(ok ? "Email verified — you can now list land!" : "Not verified yet. Check your inbox (and spam).", ok ? "success" : "info");
      } catch (e) { toast(friendlyError(e), "error"); }
    },
    logout: async () => {
      try { await signOut(auth); } catch (e) { toast(friendlyError(e), "error"); }
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.user = user;
      const [profile, isAdmin] = await Promise.all([loadProfile(user), checkAdmin(user.uid)]);
      if (state.user !== user) return; // signed out meanwhile
      state.profile = profile;
      state.isAdmin = isAdmin;
      onSignedIn(user);
    } else {
      showView("login");
      onSignedOut();
    }
  });
}
