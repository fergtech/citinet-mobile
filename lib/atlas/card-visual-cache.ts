import AsyncStorage from '@react-native-async-storage/async-storage';

// Persistent cache for the lookups behind Home's Atlas/Event card visuals
// (place photo, Panoramax still, location geocode). Those are third-party
// network calls (Wikidata/Wikipedia, Panoramax, Nominatim) whose answers for a
// given coordinate/location essentially never change, so there's no reason to
// repeat them on every Home load/remount. Memory layer in front of
// AsyncStorage so a remount within one app run reads synchronously (no flash
// of the map fallback); AsyncStorage so it survives app restarts.
//
// Misses ("no photo here", "location not found") are cached too, but for a
// much shorter time (see MISS_TTL_MS).
const KEY_PREFIX = 'card-visual-cache.';
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Short on purpose: the lookup helpers swallow network errors into null, so a
// genuine "nothing here" and a transient failure look identical — a long miss
// TTL would hide a card's photo/map for a day after one bad request.
const MISS_TTL_MS = 2 * 60 * 60 * 1000;

type Entry<T> = { at: number; value: T | null };

const memory = new Map<string, Entry<unknown>>();

function fresh<T>(entry: Entry<T>): boolean {
  return Date.now() - entry.at < (entry.value === null ? MISS_TTL_MS : HIT_TTL_MS);
}

// Synchronous, memory-only — undefined means "not known (yet)", null means
// "known to have no result".
export function peekCardVisual<T>(key: string): T | null | undefined {
  const entry = memory.get(key) as Entry<T> | undefined;
  return entry && fresh(entry) ? entry.value : undefined;
}

export async function readCardVisual<T>(key: string): Promise<T | null | undefined> {
  const hit = peekCardVisual<T>(key);
  if (hit !== undefined) return hit;
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!fresh(entry)) return undefined;
    memory.set(key, entry);
    return entry.value;
  } catch {
    return undefined;
  }
}

export function writeCardVisual<T>(key: string, value: T | null): void {
  const entry: Entry<T> = { at: Date.now(), value };
  memory.set(key, entry);
  AsyncStorage.setItem(KEY_PREFIX + key, JSON.stringify(entry)).catch(() => {});
}
