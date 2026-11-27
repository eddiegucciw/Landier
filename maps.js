// maps.js - Google Maps integration
let map = null;
let marker = null;
let selectedLocation = null;

window.initMap = function() {
  const container = document.getElementById('mapContainer');
  const fallback = document.getElementById('mapFallback');
  
  if (typeof google === 'undefined' || !google.maps) {
    container.style.display = 'none';
    fallback.classList.remove('hidden');
    return;
  }

  if (map) return;

  map = new google.maps.Map(container, {
    center: { lat: -1.286, lng: 36.817 },
    zoom: 10,
    mapTypeId: 'roadmap',
    mapTypeControl: true,
    streetViewControl: false
  });
};

window.initLocationSelectionMap = function(containerId, onSelectCallback) {
  if (typeof google === 'undefined' || !google.maps) {
    document.getElementById(containerId).innerHTML = '<p style="padding:20px; color:red; font-size:12px;">Map requires API Key</p>';
    return null;
  }

  const locMap = new google.maps.Map(document.getElementById(containerId), {
    center: { lat: -1.286, lng: 36.817 },
    zoom: 10,
    mapTypeId: 'hybrid'
  });

  locMap.addListener('click', (e) => {
    selectedLocation = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    
    if (marker) marker.setMap(null);
    marker = new google.maps.Marker({
      position: selectedLocation,
      map: locMap,
      animation: google.maps.Animation.DROP
    });

    if (onSelectCallback) onSelectCallback(selectedLocation);
  });

  return locMap;
};

window.searchMapLocation = function(query, mapInstance) {
  if (!mapInstance || !google.maps) return;
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: query + ', Kenya' }, (results, status) => {
    if (status === 'OK' && results[0]) {
      mapInstance.setCenter(results[0].geometry.location);
      mapInstance.setZoom(14);
    } else {
      alert('Location not found in Kenya.');
    }
  });
};

window.getSelectedLocation = function() {
  return selectedLocation;
};
