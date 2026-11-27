// seller.js
import { db, auth, collection, addDoc, doc, setDoc, serverTimestamp, getDocs, query, where } from './firebase.js';

let currentStep = 1;
let locMapInstance = null;

// Helper function to resize and convert image to Base64
function processImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; // Resize to keep Base64 string small
        const scale = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Compress as JPEG to save space
        resolve(canvas.toDataURL('image/jpeg', 0.7)); 
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
}

document.getElementById('activateSellerBtn')?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, 'users', user.uid), { sellerEnabled: true }, { merge: true });
    alert('Seller account activated! You can now list land.');
    document.getElementById('sellerDashboardBtn').classList.remove('hidden');
    document.getElementById('activateSellerBtn').classList.add('hidden');
  } catch (err) {
    alert('Failed to activate seller: ' + err.message);
  }
});

document.getElementById('sellerDashboardBtn')?.addEventListener('click', () => {
  document.getElementById('sellerModal').classList.remove('hidden');
  loadMyListings();
});

document.getElementById('closeSellerModal')?.addEventListener('click', () => {
  document.getElementById('sellerModal').classList.add('hidden');
});

async function loadMyListings() {
  const user = auth.currentUser;
  if (!user) return;
  const container = document.getElementById('myListings');
  container.innerHTML = '<p>Loading...</p>';

  try {
    const q = query(collection(db, 'landListings'), where('sellerId', '==', user.uid));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      container.innerHTML = '<p>No listings yet. Click "+ Add New Land" to get started.</p>';
      return;
    }

    container.innerHTML = snap.docs.map(d => {
      const data = d.data();
      return `<div style="background: #f1f5f9; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
        <h4 style="margin-bottom:4px;">${data.title}</h4>
        <p style="font-size: 0.8rem; color: #64748b;">Status: <strong>${data.moderationStatus}</strong></p>
        <p style="font-size: 0.8rem; color: #64748b;">Price: KSh ${data.price}</p>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p>Error loading listings.</p>';
  }
}

document.getElementById('addLandBtn')?.addEventListener('click', () => {
  document.getElementById('addLandModal').classList.remove('hidden');
  showStep(1);
});

document.getElementById('closeAddLand')?.addEventListener('click', () => {
  document.getElementById('addLandModal').classList.add('hidden');
});

function showStep(step) {
  document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
  document.getElementById('step' + step).classList.remove('hidden');
  currentStep = step;
}

document.getElementById('nextStep2')?.addEventListener('click', () => showStep(2));

document.getElementById('landImages')?.addEventListener('change', (e) => {
  const preview = document.getElementById('imagePreview');
  preview.innerHTML = '';
  Array.from(e.target.files).forEach(file => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.width = '60px';
    img.style.height = '60px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    preview.appendChild(img);
  });
});

document.getElementById('nextStep3')?.addEventListener('click', () => {
  showStep(3);
  if (!locMapInstance && window.initLocationSelectionMap) {
    locMapInstance = window.initLocationSelectionMap('locationMap', (loc) => {
      document.getElementById('selectedCoords').textContent = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
    });
  }
});

document.getElementById('searchMapBtn')?.addEventListener('click', () => {
  const q = document.getElementById('mapSearch').value;
  if (locMapInstance && window.searchMapLocation) window.searchMapLocation(q, locMapInstance);
});

document.getElementById('nextStep4')?.addEventListener('click', () => {
  const loc = window.getSelectedLocation();
  if (!loc) return alert('Please select a location on the map first.');
  showStep(4);
});

document.getElementById('publishLandBtn')?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  const loc = window.getSelectedLocation();
  if (!loc) return alert('Location required.');

  const btn = document.getElementById('publishLandBtn');
  btn.textContent = 'Processing Images & Publishing...';
  btn.disabled = true;

  try {
    const files = document.getElementById('landImages').files;
    const base64Images = [];
    
    // Convert images to Base64 instead of uploading to Storage
    for (const file of files) {
      const base64Str = await processImageToBase64(file);
      base64Images.push(base64Str);
    }

    // Save to Firestore with Base64 images inside the array
    await addDoc(collection(db, 'landListings'), {
      sellerId: user.uid,
      title: document.getElementById('landTitle').value,
      price: Number(document.getElementById('landPrice').value),
      size: document.getElementById('landSize').value,
      landUse: document.getElementById('landCategory').value,
      county: document.getElementById('landCounty').value,
      town: document.getElementById('landTown').value,
      description: document.getElementById('landDescription').value,
      latitude: loc.lat,
      longitude: loc.lng,
      imageUrls: base64Images, // Array of Base64 strings
      moderationStatus: 'Pending Approval',
      listingStatus: 'Pending Approval',
      createdAt: serverTimestamp()
    });

    alert('Land published successfully! Pending admin approval.');
    document.getElementById('addLandModal').classList.add('hidden');
    document.getElementById('sellerModal').classList.add('hidden');
    
    // Reset form
    document.getElementById('landTitle').value = '';
    document.getElementById('landPrice').value = '';
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('selectedCoords').textContent = 'None';
  } catch (err) {
    alert('Publishing failed: ' + err.message);
  } finally {
    btn.textContent = 'Publish Land';
    btn.disabled = false;
  }
});
