import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { recordPostView } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

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
  const markConsumed = useCallback((postId: string, reason: PostConsumedReason) => {
    if (reasonsRef.current.has(postId)) return;
    reasonsRef.current.set(postId, reason);
    setConsumedIds(new Set(reasonsRef.current.keys()));
    const s = sessionRef.current;
    if (s) recordPostView(s.hub.tunnelUrl, s.token, postId).catch(() => {});
  }, []);

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
