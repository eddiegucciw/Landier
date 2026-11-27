// app.js - Main application logic & Buyer features
import { auth, db, loginUser, registerUser, logoutUser, resetPassword, onAuthStateChanged, collection, query, where, getDocs, doc, setDoc, serverTimestamp } from './firebase.js';

const authScreen = document.getElementById('authScreen');
const mainApp = document.getElementById('mainApp');
const screens = document.querySelectorAll('.screen');
const navItems = document.querySelectorAll('.nav-item');

let currentUser = null;
let allListings = [];
let currentCategory = 'All';

// ================= AUTHENTICATION =================
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    await loadListings();
    await loadUserProfile();
  } else {
    authScreen.classList.remove('hidden');
    mainApp.classList.add('hidden');
    allListings = [];
  }
});

document.getElementById('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.remove('hidden');
});
document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
});
document.getElementById('showForgot').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('forgotForm').classList.remove('hidden');
});
document.getElementById('backToLogin').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgotForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPassword').value;
  if (!email || !pass) return alert('Please enter email and password');
  try {
    await loginUser(email, pass);
  } catch (err) {
    alert('Login failed: ' + err.message);
  }
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  const name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const phone = document.getElementById('regPhone').value;
  const pass = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  
  if (!name || !email || !phone || !pass) return alert('Please fill all fields');
  if (pass !== confirm) return alert('Passwords do not match');
  
  try {
    const cred = await registerUser(email, pass);
    await setDoc(doc(db, 'users', cred.user.uid), {
      fullName: name,
      email: email,
      phone: phone,
      sellerEnabled: false,
      createdAt: serverTimestamp()
    });
    alert('Registration successful!');
  } catch (err) {
    alert('Registration failed: ' + err.message);
  }
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  const email = document.getElementById('resetEmail').value;
  if (!email) return alert('Please enter email');
  try {
    await resetPassword(email);
    alert('Password reset link sent to your email.');
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => logoutUser());

// ================= NAVIGATION =================
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(tab + 'Screen').classList.add('active');
    
    if (tab === 'explore' && window.initMap) window.initMap();
    if (tab === 'saved') loadSavedListings();
  });
});

// ================= BUYER FEATURES =================
async function loadListings() {
  const grid1 = document.getElementById('featuredGrid');
  const grid2 = document.getElementById('recentGrid');
  grid1.innerHTML = '<p class="empty-state">Loading...</p>';
  grid2.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const q = query(collection(db, 'landListings'), where('moderationStatus', '==', 'Approved'));
    const snapshot = await getDocs(q);
    allListings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListings(allListings);
  } catch (err) {
    console.error(err);
    grid1.innerHTML = '<p class="empty-state">Error loading listings. Check Firestore rules.</p>';
    grid2.innerHTML = '';
  }
}

function renderListings(listings) {
  const featured = listings.filter(l => l.featured).slice(0, 4);
  const recent = listings.slice(0, 6);
  
  document.getElementById('featuredGrid').innerHTML = featured.length 
    ? featured.map(createCard).join('') 
    : '<p class="empty-state">No featured land available.</p>';
    
  document.getElementById('recentGrid').innerHTML = recent.length 
    ? recent.map(createCard).join('') 
    : '<p class="empty-state">No recent land available.</p>';
}

function createCard(land) {
  const img = land.imageUrls && land.imageUrls[0] ? land.imageUrls[0] : 'https://via.placeholder.com/300?text=No+Image';
  return `
    <div class="property-card">
      <img src="${img}" alt="${land.title}" loading="lazy">
      <div class="info">
        <h3>${land.title}</h3>
        <div class="price">KSh ${land.price?.toLocaleString()}</div>
        <div class="location">${land.county || 'Kenya'}, ${land.town || ''}</div>
        <div class="meta">${land.size || 'N/A'}</div>
      </div>
    </div>
  `;
}

document.getElementById('searchBtn').addEventListener('click', () => {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const filtered = allListings.filter(l =>
    (l.title && l.title.toLowerCase().includes(q)) || 
    (l.county && l.county.toLowerCase().includes(q)) ||
    (l.town && l.town.toLowerCase().includes(q))
  );
  renderListings(filtered);
});

document.querySelectorAll('.category-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    const filtered = currentCategory === 'All'
      ? allListings
      : allListings.filter(l => l.landUse === currentCategory);
    renderListings(filtered);
  });
});

async function loadSavedListings() {
  if (!currentUser) return;
  const grid = document.getElementById('savedGrid');
  grid.innerHTML = '<p class="empty-state">Loading...</p>';
  
  try {
    const q = query(collection(db, 'savedListings'), where('userId', '==', currentUser.uid));
    const snap = await getDocs(q);
    const savedIds = snap.docs.map(d => d.data().listingId);
    
    const saved = allListings.filter(l => savedIds.includes(l.id));
    grid.innerHTML = saved.length 
      ? saved.map(createCard).join('') 
      : '<p class="empty-state">No saved land yet.</p>';
  } catch (err) {
    grid.innerHTML = '<p class="empty-state">Error loading saved land.</p>';
  }
}

async function loadUserProfile() {
  if (!currentUser) return;
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', currentUser.email)));
    if (!snap.empty) {
      const data = snap.docs[0].data();
      document.getElementById('profileInfo').innerHTML = `
        <p><strong>Name:</strong> ${data.fullName}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Phone:</strong> ${data.phone || 'N/A'}</p>
        <p><strong>Role:</strong> ${data.sellerEnabled ? 'Buyer & Seller' : 'Buyer'}</p>
      `;
      if (data.sellerEnabled) {
        document.getElementById('sellerDashboardBtn').classList.remove('hidden');
        document.getElementById('activateSellerBtn').classList.add('hidden');
      }
    }
  } catch (err) {
    document.getElementById('profileInfo').innerHTML = 'Error loading profile.';
  }
}
