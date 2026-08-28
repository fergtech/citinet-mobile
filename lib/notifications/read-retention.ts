import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { HubNotification } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

// How long a notification keeps showing in the notifications screen after
// being read, and the max number of read-but-still-visible items kept at
// once — whichever limit is hit first prunes it. Genuinely unread
// notifications aren't subject to either limit: they keep coming back from
// GET /api/notifications/unread (see hubService.ts's listUnreadNotifications)
// for as long as the server has them, however old — this store only ever
// tracks items once the user has actually read one, so there's nothing to
// "reset the day count" on for an unread item; it was never started.
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_RETAINED = 25;

export type RetainedNotification = {
  notification: HubNotification;
  // Epoch ms this device marked it read — not a server timestamp. The
  // server's `read` column is a plain boolean with no read_at of its own
  // (confirmed against api/server.js's hub_notifications table), so "when"
  // is purely local, per-device knowledge.
  readAt: number;
};

function storageKey(hubSlug: string): string {
  return `notifications-recently-read.${hubSlug}`;
}

const EMPTY: RetainedNotification[] = [];
const cache = new Map<string, RetainedNotification[]>();
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

// Drops anything past RETENTION_MS old, then — if still over MAX_RETAINED —
// the oldest-read of what's left. Applied on every load and every write, so
// neither limit needs its own timer/cron; a screen visit is what prunes.
function prune(entries: RetainedNotification[]): RetainedNotification[] {
  const now = Date.now();
  const fresh = entries.filter((e) => now - e.readAt <= RETENTION_MS);
  fresh.sort((a, b) => b.readAt - a.readAt);
  return fresh.slice(0, MAX_RETAINED);
}

function persist(hubSlug: string, entries: RetainedNotification[]) {
  cache.set(hubSlug, entries);
  notify(hubSlug);
  AsyncStorage.setItem(storageKey(hubSlug), JSON.stringify(entries)).catch(() => {});
}

function ensureLoaded(hubSlug: string) {
  if (cache.has(hubSlug)) return;
  AsyncStorage.getItem(storageKey(hubSlug))
    .then((raw) => {
      const parsed = raw ? (JSON.parse(raw) as RetainedNotification[]) : [];
      cache.set(hubSlug, prune(parsed));
      notify(hubSlug);
    })
    .catch(() => {
      cache.set(hubSlug, []);
      notify(hubSlug);
    });
}

// Same useSyncExternalStore external-store shape as lib/atlas/saved-pins.ts /
// lib/marketplace/saved-listings.ts / lib/files/starred-files.ts (this app's
// standing pattern for shared-across-screens client-local state) — only one
// screen (app/notifications.tsx) reads this today, but the pattern still
// buys correct behavior if a second surface (e.g. a future notifications
// widget) ever needs the same "recently read" set.
export function useRecentlyReadNotifications(): {
  recentlyRead: RetainedNotification[];
  markRead: (notification: HubNotification) => void;
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

  const recentlyRead = useSyncExternalStore(subscribe, getSnapshot);

  const markRead = useCallback(
    (notification: HubNotification) => {
      if (!hubSlug) return;
      const current = cache.get(hubSlug) ?? [];
      // Upsert, not append — replacing rather than duplicating is cheap
      // insurance against a double-tap or a re-render racing the server call.
      const withoutExisting = current.filter((e) => e.notification.id !== notification.id);
      persist(hubSlug, prune([...withoutExisting, { notification, readAt: Date.now() }]));
    },
    [hubSlug]
  );

  return { recentlyRead, markRead };
}
