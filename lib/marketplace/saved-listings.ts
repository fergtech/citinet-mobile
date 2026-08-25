import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSession } from '@/lib/session/session-context';

// Same rationale as lib/atlas/saved-pins.ts: citinet web itself keeps saved
// listings in localStorage only (MarketplaceScreen.tsx's ListingCard,
// 'saved_listings' key) — there's no server-side saved-listing endpoint, so
// this mirrors that with AsyncStorage rather than inventing one. Also the
// same useSyncExternalStore fix for the cross-screen desync bug found on
// Atlas: a toggle from Listing Detail must be visible on the Marketplace
// grid underneath without a forced remount.
function storageKey(hubSlug: string): string {
  return `marketplace-saved-listings.${hubSlug}`;
}

const EMPTY: string[] = [];
const cache = new Map<string, string[]>();
const listeners = new Map<string, Set<() => void>>();

function getListeners(hubSlug: string): Set<() => void> {
  let set = listeners.get(hubSlug);
  if (!set) {
    set = new Set();
    listeners.set(hubSlug, set);
  }
  return set;
}

function notify(hubSlug: string) {
  getListeners(hubSlug).forEach((fn) => fn());
}

function ensureLoaded(hubSlug: string) {
  if (cache.has(hubSlug)) return;
  AsyncStorage.getItem(storageKey(hubSlug))
    .then((raw) => {
      cache.set(hubSlug, raw ? (JSON.parse(raw) as string[]) : []);
      notify(hubSlug);
    })
    .catch(() => {
      cache.set(hubSlug, []);
      notify(hubSlug);
    });
}

export function useSavedListings(): {
  savedIds: string[];
  isSaved: (listingId: string) => boolean;
  toggleSaved: (listingId: string) => void;
} {
  const { session } = useSession();
  const hubSlug = session?.hub.slug;

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!hubSlug) return () => {};
      const set = getListeners(hubSlug);
      set.add(callback);
      ensureLoaded(hubSlug);
      return () => set.delete(callback);
    },
    [hubSlug]
  );

  const getSnapshot = useCallback(() => (hubSlug ? (cache.get(hubSlug) ?? EMPTY) : EMPTY), [hubSlug]);

  const savedIds = useSyncExternalStore(subscribe, getSnapshot);

  const toggleSaved = useCallback(
    (listingId: string) => {
      if (!hubSlug) return;
      const current = cache.get(hubSlug) ?? [];
      const next = current.includes(listingId) ? current.filter((id) => id !== listingId) : [...current, listingId];
      cache.set(hubSlug, next);
      notify(hubSlug);
      AsyncStorage.setItem(storageKey(hubSlug), JSON.stringify(next)).catch(() => {});
    },
    [hubSlug]
  );

  const isSaved = useCallback((listingId: string) => savedIds.includes(listingId), [savedIds]);

  return { savedIds, isSaved, toggleSaved };
}
