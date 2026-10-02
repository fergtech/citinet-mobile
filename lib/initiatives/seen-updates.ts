import { createSeenStore } from '@/lib/ui/seen-store';

// Initiative activity entries (by entry id) the user has opened from Home's
// Initiatives card. There's no per-update detail screen, so tapping that card
// is the only "opening" there is. Local-only.
const store = createSeenStore('initiatives.seen-update-ids');
export const markInitiativeUpdateSeen = store.markSeen;
export const useSeenInitiativeUpdateIds = store.useSeenIds;
