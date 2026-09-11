import { HubPost } from '@/lib/api/types';

// In-memory only (not persisted, lost on app restart) — a short-lived
// hand-off from wherever a post is already on screen (PostRow, Discover's
// grid/search, the Discover drawer, a freshly-created post/event) to
// app/post/[id].tsx, so tapping into a post you just saw renders instantly
// with the data already in hand instead of a blank screen while it
// re-fetches the exact same thing. NOT a source of truth or a substitute for
// that fetch: app/post/[id].tsx still always fetches fresh post+replies data
// and overwrites whatever's here — this only avoids the empty first paint,
// it never serves stale data in place of a real load.
const cache = new Map<string, HubPost>();
// Small and unbounded-growth-proofed, not tuned for hit rate — this only
// ever needs to cover "the post you just tapped," not a large working set.
const MAX_ENTRIES = 50;

export function cachePost(post: HubPost): void {
  // Re-inserting moves it to the end (Map preserves insertion order), so the
  // eviction below is a real LRU-by-recency, not an arbitrary drop.
  cache.delete(post.id);
  cache.set(post.id, post);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function getCachedPost(id: string): HubPost | undefined {
  return cache.get(id);
}
