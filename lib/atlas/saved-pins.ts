import { createSyncedIdListHook } from '@/lib/api/synced-id-list';

// Saved Atlas pins are account-level: they live in the hub's per-account
// preferences ('saved_atlas_pins', the same key citinet web reads), with
// AsyncStorage only as an on-device cache. See lib/api/synced-id-list.ts for
// the sync rules.
//
// History: this used to be AsyncStorage-only ("no server-side saved-pin
// endpoint exists"), which let the same account show 1 saved pin here and 3 on
// web. The cross-screen desync fix of 2026-08-21 (one shared external store
// instead of per-screen state) is preserved by the shared hook.
export const useSavedPins = createSyncedIdListHook({
  prefKey: 'saved_atlas_pins',
  // Same storage key as before, so pins already saved on this phone are kept
  // and merged into the account list on first sync.
  storagePrefix: 'atlas-saved-pins',
});
