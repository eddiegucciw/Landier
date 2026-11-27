// maps.js

let mapInstance = null;

export function initExploreMap() {
  const mapContainer = document.getElementById('mapContainer');
  
  // If Google Maps script is already loaded, just render
  if (window.google && window.google.maps) {
    renderMap(mapContainer);
    return;
  }

  // Replace with your actual API key
  const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY'; 
  
  // Create script tag
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
  script.async = true;
  script.defer = true;
  
  script.onload = () => {
    renderMap(mapContainer);
  };

  script.onerror = () => {
    mapContainer.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Failed to load Google Maps. Check API key.</div>';
  };

  document.head.appendChild(script);
}

function renderMap(container) {
  if (mapInstance) return; // Already rendered

  mapInstance = new google.maps.Map(container, {
    center: { lat: -1.286, lng: 36.817 }, // Nairobi
    zoom: 10,
    mapTypeId: 'roadmap',
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: true
  });
}
