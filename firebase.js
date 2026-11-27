// firebase.js - Firebase initialization and shared services
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyACuvTi-yMGkQ4nojapLYeJ8tOZlty2fpI",
  authDomain: "gumado.firebaseapp.com",
  projectId: "gumado",
  storageBucket: "gumado.firebasestorage.app",
  messagingSenderId: "220205636823",
  appId: "1:220205636823:web:e194c0bdf9f0e94dfe6492",
  measurementId: "G-P9B3XKTYDS"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app);

// Auth helpers
export const registerUser = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const loginUser = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logoutUser = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export { onAuthStateChanged };

// Firestore helpers
export const createDoc = (col, data) => addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
export const getDocById = (col, id) => getDoc(doc(db, col, id));
export const updateDocById = (col, id, data) => updateDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() });
export const deleteDocById = (col, id) => deleteDoc(doc(db, col, id));
export { collection, query, where, orderBy, limit, getDocs, onSnapshot, doc, setDoc, serverTimestamp };

// Storage helpers
export const uploadFile = async (path, file) => {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
};
export { deleteObject, ref };
