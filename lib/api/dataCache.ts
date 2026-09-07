import AsyncStorage from '@react-native-async-storage/async-storage';

// Mirrors citinet web's own dataCache.ts (readCache/writeCache/clearCache) —
// a lightweight per-hub cache so a screen can seed its state instantly from
// the last response it got instead of a blank loading state on mount, and
// fall back to it if a refresh fails (e.g. the hub machine is mid-restart).
// AsyncStorage rather than localStorage since this is React Native, but the
// read/write/clear shape is deliberately the same.
function storageKey(hubSlug: string, key: string): string {
  return `data-cache.${hubSlug}.${key}`;
}

export async function readCache<T>(hubSlug: string, key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(hubSlug, key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(hubSlug: string, key: string, data: T): void {
  AsyncStorage.setItem(storageKey(hubSlug, key), JSON.stringify(data)).catch(() => {});
}

export function clearCache(hubSlug: string, key: string): void {
  AsyncStorage.removeItem(storageKey(hubSlug, key)).catch(() => {});
}
