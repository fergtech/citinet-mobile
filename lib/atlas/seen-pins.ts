import { createSeenStore } from '@/lib/ui/seen-store';

// Atlas pins opened on this device (the server keeps no per-viewer record for
// pins). Marked from app/atlas/[id].tsx; read by Home's Atlas card.
const store = createSeenStore('atlas.seen-pin-ids');
export const markPinSeen = store.markSeen;
export const useSeenPinIds = store.useSeenIds;
