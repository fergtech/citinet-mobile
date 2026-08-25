import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSession } from '@/lib/session/session-context';

// There is no server-side "saved pin" endpoint anywhere in citinet's real
// API (confirmed directly from api/server.js and atlasService.ts) — citinet
// web itself keeps this in localStorage only, so this mirrors that with
// AsyncStorage rather than inventing server persistence that doesn't exist.
function storageKey(hubSlug: string): string {
  return `atlas-saved-pins.${hubSlug}`;
}

// A real bug once (2026-08-21): each screen's useSavedPins() call used to own
// its own local useState, loaded once on mount. Saving from Pin Detail wrote
// to storage and updated only that screen's own state — the Atlas list
// screen underneath, already mounted (React Navigation keeps prior stack
// screens alive on "back," it doesn't remount them), never heard about the
// change until something forced a fresh mount. Fixed by making the saved-ids
// list a genuine external store (module-level cache + subscribers), shared by
// every mounted consumer of this hook via useSyncExternalStore — a toggle
// anywhere notifies everywhere, no remount required.
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

export function useSavedPins(): { savedIds: string[]; isSaved: (pinId: string) => boolean; toggleSaved: (pinId: string) => void } {
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
    (pinId: string) => {
      if (!hubSlug) return;
      const current = cache.get(hubSlug) ?? [];
      const next = current.includes(pinId) ? current.filter((id) => id !== pinId) : [...current, pinId];
      cache.set(hubSlug, next);
      notify(hubSlug);
      AsyncStorage.setItem(storageKey(hubSlug), JSON.stringify(next)).catch(() => {});
    },
    [hubSlug]
  );

  const isSaved = useCallback((pinId: string) => savedIds.includes(pinId), [savedIds]);

  return { savedIds, isSaved, toggleSaved };
}
