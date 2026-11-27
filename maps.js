// maps.js
let mapInstance = null;

window.initMap = function() {
  const mapContainer = document.getElementById('mapContainer');
  if (!mapContainer) return;

  // Prevent re-rendering if map is already loaded
  if (mapInstance) return;

  // Check if Google Maps script is already loaded
  if (window.google && window.google.maps) {
    renderMap(mapContainer);
    return;
  }

  // ⚠️ REPLACE WITH YOUR GOOGLE MAPS API KEY
  const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY'; 
  
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
  script.async = true;
  script.defer = true;
  
  script.onload = () => {
    renderMap(mapContainer);
  };

  script.onerror = () => {
    mapContainer.innerHTML = `
      <div style="padding:20px; text-align:center; color:var(--gray-muted);">
        <i class="lucide icon-lucide-map" style="font-size:2rem; margin-bottom:8px;"></i>
        <p>Failed to load Google Maps. Please check your API key.</p>
      </div>
    `;
  };

  document.head.appendChild(script);
};

function renderMap(container) {
  mapInstance = new google.maps.Map(container, {
    center: { lat: -1.286, lng: 36.817 }, // Nairobi
    zoom: 10,
    mapTypeId: 'roadmap',
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: true
  });
}