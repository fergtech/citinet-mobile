import { sessionStorage } from '@/lib/session/storage';
import type { StoredSession } from '@/lib/session/types';

// citinet-web's own multi-hub model (src/app/services/hubService.ts) keeps
// every known hub connection in ONE localStorage blob keyed by slug — fine
// on web, but SecureStore is backed by the platform Keychain/Keystore, and
// on Android that has a practical ~2KB ceiling per value. Storing N hubs'
// sessions as one growing JSON blob would eventually hit that wall, so this
// instead keeps a small index (just the slugs) plus one SecureStore key per
// hub session — each read/write only ever touches the hub it's about, and
// there's no per-value size risk regardless of how many hubs are stored.
const INDEX_KEY = 'citinet-sessions-index';
const ACTIVE_HUB_KEY = 'citinet-active-hub-slug';
const LEGACY_SESSION_KEY = 'citinet-session'; // pre-multi-hub single-session key
// expo-secure-store keys are restricted to [A-Za-z0-9._-] on native (SecureStore
// throws otherwise) -- ':' isn't allowed, same constraint lib/crypto/storage.ts
// already works around with '.' separators.
const sessionKeyFor = (slug: string) => `citinet-session.${slug}`;

async function readIndex(): Promise<string[]> {
  try {
    const raw = await sessionStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(slugs: string[]): Promise<void> {
  await sessionStorage.setItem(INDEX_KEY, JSON.stringify(slugs));
}

/** Upserts a hub's session and adds it to the index if it's new. */
export async function saveHubSession(session: StoredSession): Promise<void> {
  const slug = session.hub.slug;
  await sessionStorage.setItem(sessionKeyFor(slug), JSON.stringify(session));
  const index = await readIndex();
  if (!index.includes(slug)) await writeIndex([...index, slug]);
}

export async function getHubSession(slug: string): Promise<StoredSession | null> {
  try {
    const raw = await sessionStorage.getItem(sessionKeyFor(slug));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

/** All stored sessions, newest-added last. A corrupt/missing entry for a
 *  slug still in the index is silently dropped rather than thrown, same
 *  tolerance-for-partial-data approach as nearbyHubs.ts. */
export async function getAllHubSessions(): Promise<StoredSession[]> {
  const index = await readIndex();
  const sessions = await Promise.all(index.map(getHubSession));
  return sessions.filter((s): s is StoredSession => s !== null);
}

export async function removeHubSession(slug: string): Promise<void> {
  await sessionStorage.deleteItem(sessionKeyFor(slug));
  const index = await readIndex();
  if (index.includes(slug)) await writeIndex(index.filter((s) => s !== slug));
}

export async function getActiveHubSlug(): Promise<string | null> {
  return sessionStorage.getItem(ACTIVE_HUB_KEY);
}

export async function setActiveHubSlug(slug: string | null): Promise<void> {
  if (slug) await sessionStorage.setItem(ACTIVE_HUB_KEY, slug);
  else await sessionStorage.deleteItem(ACTIVE_HUB_KEY);
}

/** One-time upgrade path for installs that signed in before multi-hub
 *  support existed — folds the old single `citinet-session` key into the
 *  new index/per-hub-key format (as the active hub) and removes it, so an
 *  existing user's login survives the upgrade instead of silently signing
 *  them out. No-ops once already migrated (or on a fresh install with
 *  nothing to migrate). Safe to call on every startup. */
export async function migrateLegacySessionIfNeeded(): Promise<void> {
  const legacyRaw = await sessionStorage.getItem(LEGACY_SESSION_KEY);
  if (!legacyRaw) return;
  try {
    const legacy = JSON.parse(legacyRaw) as StoredSession;
    await saveHubSession(legacy);
    await setActiveHubSlug(legacy.hub.slug);
  } catch {
    // Corrupt legacy value — nothing worth migrating, just clear it below.
  }
  await sessionStorage.deleteItem(LEGACY_SESSION_KEY);
}
