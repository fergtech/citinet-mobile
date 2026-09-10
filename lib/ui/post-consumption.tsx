import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { recordPostView } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

// Not hub-scoped, same as reasonsRef itself below — post ids are UUIDs, so
// mixing ids across hubs in one set/one storage slot carries no real
// collision risk, just avoids the ceremony of a per-hub key for what's
// already a single global in-memory set.
const SEEN_IDS_STORAGE_KEY = 'post-consumption.seen-post-ids';
// Caps local growth — oldest entries fall off first (Map preserves insertion
// order, so a plain slice(-N) on its keys is a real LRU-by-insertion, not an
// arbitrary truncation). A post old enough to fall off here is already far
// down a reverse-chronological feed regardless of seen state, so it
// reappearing as "unseen" after eviction is a harmless edge case, not a bug.
const MAX_PERSISTED_SEEN = 300;

// Cross-screen "has the user actually seen/engaged with this post" state —
// deliberately a single Provider mounted once at the root (see app/_layout.tsx)
// rather than something each screen tracks locally. A post can be scrolled
// past in the Feed tab, liked from Home's single preview, tapped open from
// Discover's grid, or read in full on its own post/[id] screen — all the
// same post, all valid "consumed" signals, and they need to land in one
// shared set or e.g. liking it on post/[id] wouldn't be visible back on the
// Feed tab that's still mounted underneath it.
export type PostConsumedReason = 'dwell' | 'engagement' | 'opened';

type PostConsumptionContextValue = {
  consumedIds: ReadonlySet<string>;
  isConsumed: (postId: string) => boolean;
  // A like/vote/RSVP/comment — an explicit interaction, so it counts
  // immediately regardless of how long the post was actually on screen.
  markEngaged: (postId: string) => void;
  // Navigated into the post's own detail screen (app/post/[id].tsx) — reading
  // the full post there is itself the strongest possible "seen it" signal,
  // no dwell timer needed on top.
  markOpened: (postId: string) => void;
  // Crossed the ≥60%-visible-for-≥2.0s viewport threshold while scrolling a
  // feed list. Not meant to be called directly from screen code — this is
  // what lib/ui/post-dwell-tracking.ts's per-FlatList hook calls internally;
  // exposed on the context only so that hook doesn't have to live inside
  // this file too.
  markDwelled: (postId: string) => void;
};

const PostConsumptionContext = createContext<PostConsumptionContextValue | null>(null);

export function PostConsumptionProvider({ children }: { children: ReactNode }) {
  // Reason is kept per post (first reason wins — later calls for an
  // already-consumed post are no-ops) even though nothing reads it back
  // yet, the same way the original per-screen version did — cheap to keep,
  // and it's what a future telemetry call would want to report.
  const reasonsRef = useRef(new Map<string, PostConsumedReason>());
  const [consumedIds, setConsumedIds] = useState<ReadonlySet<string>>(new Set());

  const { session } = useSession();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Seeds reasonsRef from last session's persisted ids, once, at Provider
  // mount — so Feed's unseen-first sort (see app/(tabs)/feed.tsx) still
  // knows what was already seen after an app relaunch, not just within the
  // current runtime. Server-side hub_post_views is the actual source of
  // truth for view_count, but nothing reads a per-user "have I seen this"
  // flag back from it — this local cache is just enough to sort a feed on
  // this device, not a second source of truth to keep server-consistent.
  useEffect(() => {
    AsyncStorage.getItem(SEEN_IDS_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const ids = JSON.parse(raw) as string[];
        for (const id of ids) {
          if (!reasonsRef.current.has(id)) reasonsRef.current.set(id, 'dwell');
        }
        if (ids.length > 0) setConsumedIds(new Set(reasonsRef.current.keys()));
      })
      .catch(() => {});
  }, []);

  // POST /api/posts/:id/view — a real, server-side, per-viewer tally (see
  // api/server.js in the citinet-web repo: hub_post_views, one row per
  // post+user, so the server itself dedupes a given user to a single count
  // no matter how many times they view it). Fired once per post per app
  // session, right here, rather than scattering a network call across every
  // markEngaged/markOpened/markDwelled call site — that's just an
  // optimization to skip the redundant request within a session, not what
  // makes the count correct; the server-side UNIQUE constraint is. Read
  // from a ref (not closed over directly) for the same reason markConsumed
  // itself stays on an empty deps array — this needs to keep working
  // correctly even though the session can log out/switch hubs after this
  // closure was created.
  //
  // A batch of posts can legitimately cross the dwell threshold within the
  // same instant (a fast fling past several rows, or many rows already on
  // screen when Feed first mounts) — queued and drained one at a time with a
  // short stagger, rather than firing recordPostView for all of them in one
  // burst, so that alone can't trip the hub's general API rate limit (see
  // server.js's apiLimiter — 300 req/min shared with every other request
  // this device makes).
  const viewQueueRef = useRef<string[]>([]);
  const drainingViewQueueRef = useRef(false);
  const VIEW_QUEUE_STAGGER_MS = 150;

  const drainViewQueue = useCallback(async () => {
    if (drainingViewQueueRef.current) return;
    drainingViewQueueRef.current = true;
    try {
      while (viewQueueRef.current.length > 0) {
        const postId = viewQueueRef.current.shift();
        const s = sessionRef.current;
        if (postId && s) await recordPostView(s.hub.tunnelUrl, s.token, postId).catch(() => {});
        if (viewQueueRef.current.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, VIEW_QUEUE_STAGGER_MS));
        }
      }
    } finally {
      drainingViewQueueRef.current = false;
    }
  }, []);

  const markConsumed = useCallback(
    (postId: string, reason: PostConsumedReason) => {
      if (reasonsRef.current.has(postId)) return;
      reasonsRef.current.set(postId, reason);
      setConsumedIds(new Set(reasonsRef.current.keys()));
      const persisted = [...reasonsRef.current.keys()].slice(-MAX_PERSISTED_SEEN);
      AsyncStorage.setItem(SEEN_IDS_STORAGE_KEY, JSON.stringify(persisted)).catch(() => {});
      viewQueueRef.current.push(postId);
      drainViewQueue();
    },
    [drainViewQueue]
  );

  const isConsumed = useCallback((postId: string) => reasonsRef.current.has(postId), []);
  // Each a thin, permanently-stable wrapper around markConsumed (own empty
  // deps, not just useMemo'd alongside consumedIds) — code elsewhere closes
  // over these once and expects that to never go stale, same as markConsumed
  // itself. lib/ui/post-dwell-tracking.ts's onViewableItemsChanged is the
  // concrete case: it's captured via useRef at first render (FlatList
  // requires that prop's identity never change) and calls markDwelled from
  // that captured closure for the FlatList's entire lifetime.
  const markEngaged = useCallback((postId: string) => markConsumed(postId, 'engagement'), [markConsumed]);
  const markOpened = useCallback((postId: string) => markConsumed(postId, 'opened'), [markConsumed]);
  const markDwelled = useCallback((postId: string) => markConsumed(postId, 'dwell'), [markConsumed]);

  const value = useMemo<PostConsumptionContextValue>(
    () => ({ consumedIds, isConsumed, markEngaged, markOpened, markDwelled }),
    [consumedIds, isConsumed, markEngaged, markOpened, markDwelled]
  );

  return <PostConsumptionContext.Provider value={value}>{children}</PostConsumptionContext.Provider>;
}

export function usePostConsumption(): PostConsumptionContextValue {
  const ctx = useContext(PostConsumptionContext);
  if (!ctx) throw new Error('usePostConsumption must be used within PostConsumptionProvider');
  return ctx;
}
