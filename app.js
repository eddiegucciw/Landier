// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let properties = [];
let currentCategory = 'All';
let currentSearch = '';

// ---- INIT APP ----
document.addEventListener('DOMContentLoaded', () => {
  // Auth State Listener
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('mainApp').style.display = 'block';
      document.getElementById('bottomNav').style.display = 'flex';
      await loadListings();
      updateAccountUI();
    } else {
      document.getElementById('authScreen').style.display = 'block';
      document.getElementById('mainApp').style.display = 'none';
      document.getElementById('bottomNav').style.display = 'none';
    }
  });

  // Auth Buttons
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    try { await signInWithEmailAndPassword(auth, email, pass); } 
    catch (err) { alert('Login failed: ' + err.message); }
  });

  document.getElementById('registerBtn').addEventListener('click', async () => {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const pass = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;
    
    if (pass !== confirm) return alert('Passwords do not match');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db, 'users', cred.user.uid), {
        fullName: name, email: email, phone: phone, sellerEnabled: false, createdAt: serverTimestamp()
      });
      alert('Registration successful!');
    } catch (err) { alert('Registration failed: ' + err.message); }
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    const email = document.getElementById('resetEmail').value;
    try { await sendPasswordResetEmail(auth, email); alert('Reset link sent!'); } 
    catch (err) { alert(err.message); }
  });

  // Image Processing (Base64)
  document.getElementById('addImageFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scale = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64Str = canvas.toDataURL('image/jpeg', 0.7);
        document.getElementById('imagePreview').innerHTML = `<img src="${base64Str}" style="width:100px; border-radius:8px;">`;
        window.tempBase64Image = base64Str;
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Publish Land
  document.getElementById('publishBtn').addEventListener('click', async () => {
    if (!window.tempBase64Image) return alert('Please upload an image.');
    try {
      await addDoc(collection(db, 'landListings'), {
        sellerId: auth.currentUser.uid,
        title: document.getElementById('addTitle').value,
        price: Number(document.getElementById('addPrice').value),
        location: document.getElementById('addLocation').value,
        landUse: document.getElementById('addCategory').value,
        size: document.getElementById('addSize').value,
        description: document.getElementById('addDescription').value,
        imageUrls: [window.tempBase64Image],
        moderationStatus: 'Approved',
        createdAt: serverTimestamp()
      });
      alert('Land published successfully!');
      window.closeAddProperty();
      loadListings();
    } catch (err) { alert('Error: ' + err.message); }
  });
});

// ---- DATA FETCHING & RENDERING ----
async function loadListings() {
  const grid = document.getElementById('propertyGrid');
  grid.innerHTML = '<p style="grid-column:span 2; text-align:center; color:var(--gray-muted); padding:40px 0;">Loading...</p>';
  try {
    const q = query(collection(db, 'landListings'), where('moderationStatus', '==', 'Approved'));
    const snap = await getDocs(q);
    properties = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();
  } catch (err) {
    grid.innerHTML = '<p style="grid-column:span 2; text-align:center; color:red; padding:40px 0;">Error loading listings.</p>';
  }
}

function renderGrid() {
  let filtered = properties.filter(p => {
    const matchCat = currentCategory === 'All' || p.landUse === currentCategory;
    const matchSearch = currentSearch === '' || p.title.toLowerCase().includes(currentSearch.toLowerCase()) || p.location.toLowerCase().includes(currentSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const grid = document.getElementById('propertyGrid');
  if (filtered.length === 0) {
    grid.innerHTML = '<p style="grid-column:span 2; text-align:center; color:var(--gray-muted); padding:40px 0;">No land found.</p>';
    return;
  }

  grid.innerHTML = filtered.map(p => `
    <div class="property-card" onclick="openPropertyDetail('${p.id}')">
      <div class="card-image">
        <img src="${p.imageUrls[0]}" alt="${p.title}" loading="lazy">
      </div>
      <div class="card-content">
        <div class="card-title">${p.title}</div>
        <div class="card-price">KSh ${p.price.toLocaleString()}</div>
        <div class="card-location"><i class="lucide icon-lucide-map-pin"></i> ${p.location}</div>
        <div class="card-specs">${p.size}</div>
        <span class="availability">Available</span>
      </div>
    </div>
  `).join('');
}

function updateAccountUI() {
  if (!currentUser) return;
  document.getElementById('accountName').textContent = currentUser.email.split('@')[0];
  document.getElementById('accountEmail').textContent = currentUser.email;
}

// ---- GLOBAL FUNCTIONS (Called from index.html) ----
window.filterByCategory = (cat) => { currentCategory = cat; renderGrid(); };
window.filterBySearch = (q) => { currentSearch = q; renderGrid(); };

window.showPropertyDetail = (id) => {
  const p = properties.find(x => x.id === id);
  if (!p) return;
  document.getElementById('detailTitle').textContent = p.title;
  document.getElementById('detailContent').innerHTML = `
    <img src="${p.imageUrls[0]}" style="width:100%; height:260px; object-fit:cover;">
    <div style="padding:16px;">
      <h2 style="font-size:1.2rem;">${p.title}</h2>
      <div class="price" style="font-size:1.5rem;">KSh ${p.price.toLocaleString()}</div>
      <p style="color:var(--gray-muted); margin-top:8px;"><i class="lucide icon-lucide-map-pin"></i> ${p.location}</p>
      <p style="margin-top:16px; line-height:1.6;">${p.description}</p>
    </div>
  `;
  document.getElementById('detailScreen').classList.add('active');
};

window.logout = () => signOut(auth);