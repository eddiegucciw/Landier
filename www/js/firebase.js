// firebase.js — single Firebase initialisation shared by every module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider, deleteUser, reload
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp,
  writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestore;
try {
  // Offline cache: listings and chats stay readable on a weak connection.
  firestore = initializeFirestore(app, { localCache: persistentLocalCache() });
} catch (e) {
  console.warn("Persistent cache unavailable, using memory cache", e);
  firestore = initializeFirestore(app, {});
}
export const db = firestore;

export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider, deleteUser, reload,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where,
  orderBy, limit, limitToLast, onSnapshot, serverTimestamp, writeBatch, Timestamp
};
