import { createSeenStore } from '@/lib/ui/seen-store';

// Marketplace listings opened on this device (no server-side per-viewer
// record). Marked from app/marketplace/[id].tsx; read by Home's Marketplace card.
const store = createSeenStore('marketplace.seen-listing-ids');
export const markListingSeen = store.markSeen;
export const useSeenListingIds = store.useSeenIds;
