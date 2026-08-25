import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSession } from '@/lib/session/session-context';

// No server-side "starred" concept anywhere in citinet's real API (confirmed
// against api/server.js — hub_files has no such column) — citinet web itself
// keeps this in localStorage only, so this mirrors that with AsyncStorage.
// Same useSyncExternalStore external-store shape as lib/atlas/saved-pins.ts /
// lib/marketplace/saved-listings.ts (this app's standing pattern for any
// shared-across-screens client-local state, see that memory's "how to apply").
function storageKey(hubSlug: string): string {
  return `files-starred.${hubSlug}`;
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

export function useStarredFiles(): { isStarred: (fileId: string) => boolean; toggleStarred: (fileId: string) => void } {
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

  const starredIds = useSyncExternalStore(subscribe, getSnapshot);

  const toggleStarred = useCallback(
    (fileId: string) => {
      if (!hubSlug) return;
      const current = cache.get(hubSlug) ?? [];
      const next = current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId];
      cache.set(hubSlug, next);
      notify(hubSlug);
      AsyncStorage.setItem(storageKey(hubSlug), JSON.stringify(next)).catch(() => {});
    },
    [hubSlug]
  );

  const isStarred = useCallback((fileId: string) => starredIds.includes(fileId), [starredIds]);

  return { isStarred, toggleStarred };
}
