import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Small persisted "ids this user has opened on this device" store, for the
// things the server keeps no per-viewer record of (Atlas pins, marketplace
// listings, initiative updates — posts have hub_post_views instead, see
// lib/ui/post-consumption.tsx). Local-only: something opened on another
// device still reads as unseen here. Backs Home's seen rule.
//
// Not hub-scoped — ids are UUIDs, so mixing hubs in one set can't collide.
// Oldest entries fall off first once past MAX_PERSISTED (Set keeps insertion
// order).
const MAX_PERSISTED = 300;

export function createSeenStore(storageKey: string) {
  let seen: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();

  function publish(next: Set<string>) {
    seen = next;
    listeners.forEach((l) => l());
  }

  AsyncStorage.getItem(storageKey)
    .then((raw) => {
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      // Merge, don't overwrite — an id could have been marked before this read finished.
      publish(new Set([...ids, ...seen]));
    })
    .catch(() => {});

  function markSeen(id: string): void {
    if (seen.has(id)) return;
    const next = new Set(seen);
    next.add(id);
    publish(next);
    AsyncStorage.setItem(storageKey, JSON.stringify([...next].slice(-MAX_PERSISTED))).catch(() => {});
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function useSeenIds(): ReadonlySet<string> {
    return useSyncExternalStore(subscribe, () => seen);
  }

  return { markSeen, useSeenIds };
}
