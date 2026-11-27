// state.js — shared in-memory state.
export const state = {
  user: null,          // Firebase auth user
  profile: null,       // users/{uid} document data
  isAdmin: false,
  listings: [],        // approved listings (home feed)
  listingById: new Map(),
  saved: new Set(),    // ids of saved listings
  conversations: [],
  filters: { category: "All", search: "", minPrice: null, maxPrice: null, county: "", sort: "newest" },
  unsubscribers: []    // Firestore listeners to stop on sign-out
};

export function cacheListing(listing) {
  if (listing && listing.id) state.listingById.set(listing.id, listing);
  return listing;
}

export function resetState() {
  state.unsubscribers.forEach((fn) => { try { fn(); } catch (_) {} });
  state.unsubscribers = [];
  state.user = null;
  state.profile = null;
  state.isAdmin = false;
  state.listings = [];
  state.listingById.clear();
  state.saved = new Set();
  state.conversations = [];
}
