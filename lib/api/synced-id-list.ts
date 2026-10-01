import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSession } from '@/lib/session/session-context';

// One shared implementation for any "list of ids this account saved" that the
// hub keeps per account in hub_user_preferences (GET/PATCH /api/me/preferences
// — the same store citinet web's useSavedIds reads), so a bookmark made on the
// web, on this app, or on another phone is the same bookmark everywhere.
//
// Why this exists: saved pins / saved listings used to live in AsyncStorage
// alone, on the (then-true) belief that the hub had no endpoint for them.
// Web later moved to the account-synced preference, and this app never did, so
// the same account showed 3 saved pins on web and 1 on a phone.
//
// AsyncStorage stays as an instant-paint cache and offline fallback only.
//
// Sync rules (kept deliberately simple, last-write-wins like the web):
//  - First load on a device that has never synced this list: UNION the local
//    ids with the server's and push the result, so nothing saved only on this
//    phone is lost when it first joins the account-wide list.
//  - Later loads: the server wins (so an un-save made elsewhere sticks)...
//  - ...unless a local toggle never reached the server (offline/failed PATCH),
//    marked "dirty": then local is pushed instead of being overwritten.

type Conn = { tunnelUrl: string; token: string };

const EMPTY: string[] = [];

async function fetchServerIds(conn: Conn, prefKey: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${conn.tunnelUrl}/api/me/preferences`, {
      headers: { Authorization: `Bearer ${conn.token}` },
    });
    if (!res.ok) return null;
    const prefs = (await res.json()) as Record<string, string | undefined>;
    const raw = prefs[prefKey];
    if (raw === undefined) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return null; // offline / hub unreachable — caller keeps the local copy
  }
}

async function pushServerIds(conn: Conn, prefKey: string, ids: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${conn.tunnelUrl}/api/me/preferences`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [prefKey]: JSON.stringify(ids) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function createSyncedIdListHook(opts: { prefKey: string; storagePrefix: string }) {
  const { prefKey, storagePrefix } = opts;
  const dataKey = (slug: string) => `${storagePrefix}.${slug}`;
  const syncedKey = (slug: string) => `${storagePrefix}.${slug}.synced`;
  const dirtyKey = (slug: string) => `${storagePrefix}.${slug}.dirty`;

  const cache = new Map<string, string[]>();
  const listeners = new Map<string, Set<() => void>>();
  const started = new Set<string>();

  const getListeners = (slug: string) => {
    let set = listeners.get(slug);
    if (!set) listeners.set(slug, (set = new Set()));
    return set;
  };
  const notify = (slug: string) => getListeners(slug).forEach((fn) => fn());
  const setIds = (slug: string, ids: string[]) => {
    cache.set(slug, ids);
    notify(slug);
    AsyncStorage.setItem(dataKey(slug), JSON.stringify(ids)).catch(() => {});
  };

  async function load(slug: string, conn: Conn) {
    // 1. Instant paint from the on-device cache.
    let local: string[] = [];
    try {
      const raw = await AsyncStorage.getItem(dataKey(slug));
      local = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      local = [];
    }
    cache.set(slug, local);
    notify(slug);

    // 2. Reconcile with the account's real list on the hub.
    const server = await fetchServerIds(conn, prefKey);
    if (server === null) return; // couldn't reach the hub; keep local, retry next launch

    const [synced, dirty] = await Promise.all([
      AsyncStorage.getItem(syncedKey(slug)).catch(() => null),
      AsyncStorage.getItem(dirtyKey(slug)).catch(() => null),
    ]);

    // A toggle made while the fetch was in flight may have changed the cache
    // since step 1 — always reconcile against the latest local state.
    const current = cache.get(slug) ?? local;

    if (!synced || dirty) {
      // First sync on this device, or unsynced local edits: merge, then push.
      const merged = !synced ? Array.from(new Set([...server, ...current])) : current;
      setIds(slug, merged);
      if (await pushServerIds(conn, prefKey, merged)) {
        AsyncStorage.setItem(syncedKey(slug), '1').catch(() => {});
        AsyncStorage.removeItem(dirtyKey(slug)).catch(() => {});
      }
      return;
    }
    setIds(slug, server);
  }

  return function useSyncedIds(): {
    savedIds: string[];
    isSaved: (id: string) => boolean;
    toggleSaved: (id: string) => void;
  } {
    const { session } = useSession();
    const hubSlug = session?.hub.slug;
    const tunnelUrl = session?.hub.tunnelUrl;
    const token = session?.token;

    const subscribe = useCallback(
      (callback: () => void) => {
        if (!hubSlug) return () => {};
        const set = getListeners(hubSlug);
        set.add(callback);
        if (tunnelUrl && token && !started.has(hubSlug)) {
          started.add(hubSlug);
          load(hubSlug, { tunnelUrl, token }).catch(() => started.delete(hubSlug));
        }
        return () => set.delete(callback);
      },
      [hubSlug, tunnelUrl, token]
    );

    const getSnapshot = useCallback(() => (hubSlug ? (cache.get(hubSlug) ?? EMPTY) : EMPTY), [hubSlug]);
    const savedIds = useSyncExternalStore(subscribe, getSnapshot);

    const toggleSaved = useCallback(
      (id: string) => {
        if (!hubSlug) return;
        const current = cache.get(hubSlug) ?? [];
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        setIds(hubSlug, next);
        if (!tunnelUrl || !token) return;
        // Mark dirty first so a failed/interrupted PATCH is retried on next load
        // instead of being overwritten by the (older) server copy.
        AsyncStorage.setItem(dirtyKey(hubSlug), '1').catch(() => {});
        pushServerIds({ tunnelUrl, token }, prefKey, next).then((ok) => {
          if (ok) {
            AsyncStorage.removeItem(dirtyKey(hubSlug)).catch(() => {});
            AsyncStorage.setItem(syncedKey(hubSlug), '1').catch(() => {});
          }
        });
      },
      [hubSlug, tunnelUrl, token]
    );

    const isSaved = useCallback((id: string) => savedIds.includes(id), [savedIds]);
    return { savedIds, isSaved, toggleSaved };
  };
}
