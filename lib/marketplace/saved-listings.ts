import { createSyncedIdListHook } from '@/lib/api/synced-id-list';

// Saved Marketplace listings are account-level ('saved_listings' in the hub's
// per-account preferences, shared with citinet web); AsyncStorage is only an
// on-device cache. See lib/api/synced-id-list.ts for the sync rules and
// lib/atlas/saved-pins.ts for the history.
export const useSavedListings = createSyncedIdListHook({
  prefKey: 'saved_listings',
  storagePrefix: 'marketplace-saved-listings',
});
