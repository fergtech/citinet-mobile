import { useSyncExternalStore } from 'react';

// GET /api/auth/avatar/:userId is served with `max-age=86400` and lives at a
// URL that never changes, so after someone uploads a new photo every cache in
// between (expo-image's disk cache included) keeps showing the old one for up
// to a day. Bumping a per-user version and appending it as `?v=` gives the new
// photo a URL nothing has cached yet. Session-local by design: it fixes what
// THIS device shows immediately; other devices pick the change up as their own
// cache entry expires.
const versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function bumpAvatarVersion(userId: string): void {
  versions.set(userId, Date.now());
  listeners.forEach((l) => l());
}

export function getAvatarVersion(userId: string | null): number {
  return userId ? (versions.get(userId) ?? 0) : 0;
}

export function useAvatarVersion(userId: string | null): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => getAvatarVersion(userId),
    () => 0
  );
}
