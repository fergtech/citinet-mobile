import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PostRow } from '@/components/post-row';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PostListSkeleton } from '@/components/ui/list-skeleton';
import { Brand } from '@/constants/theme';
import { readCache, writeCache } from '@/lib/api/dataCache';
import { getPosts, toggleLike, toggleRsvp } from '@/lib/api/hubService';
import { HubPost } from '@/lib/api/types';
import { flushWriteQueue, voteOrQueue } from '@/lib/api/write-queue';
import { applyVote } from '@/lib/ui/poll';
import { usePostDwellTracking } from '@/lib/ui/post-dwell-tracking';
import { useTabBarVisibility } from '@/lib/ui/tab-bar-visibility';
import { useSession } from '@/lib/session/session-context';

const FEED_CACHE_KEY = 'feed-posts';
// A page size for infinite scroll, not "fetch everything" — matches GET
// /api/posts's own default (see lib/api/hubService.ts), passed explicitly
// here so the two stay in sync even if the server's default ever changes.
const PAGE_SIZE = 20;
// Higher than Files' own scroll-to-top threshold (280) — Feed's rows are
// much taller (title/body/media/footer vs. a compact file row), so this
// still lands around "a couple of posts deep," not "barely past the first."
const SCROLL_TOP_THRESHOLD = 600;

// The pagination cursor for "whatever comes after this page" — GET
// /api/posts sorts unseen-first, newest-first within each group (see
// server.js), so the cursor needs all three keys: my_viewed, created_at, id.
// Always derived from a page's own raw server order, which is now the only
// order Feed ever displays — the server is the single source of truth for
// both "is this post seen" (hub_post_views) and where it sorts, so there's
// no client-side re-sort to reconcile against it.
function cursorOf(page: HubPost[]): { viewed: boolean; createdAt: string; id: string } | null {
  const last = page[page.length - 1];
  return last ? { viewed: !!last.my_viewed, createdAt: last.created_at, id: last.id } : null;
}

// Used for the silent refocus reload below (coming back to Feed from a post
// you just opened, switching tabs and back, ...): `next` is a fresh page 1,
// already unseen-first/newest-first sorted server-side, so it's taken as-is
// rather than merged into whatever order `current`'s page-1 window had —
// that's the whole point of re-fetching it. Anything in `current` beyond
// that window (loaded by scrolling further, via loadMore below) wasn't
// re-fetched or re-sorted, so it's kept exactly as-is, appended after.
function mergeWithFreshFirstPage(current: HubPost[], next: HubPost[]): HubPost[] {
  const nextIds = new Set(next.map((p) => p.id));
  const beyondFirstPage = current.filter((p) => !nextIds.has(p.id));
  return [...next, ...beyondFirstPage];
}

export default function FeedScreen() {
  const { session } = useSession();
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Flips true once Feed has shown *something* (cache-seeded or fetched), so
  // a refocus refresh can run quietly instead of re-flashing the loading
  // spinner over content that's already on screen.
  const hasContentRef = useRef(false);

  // Pagination — cursorRef always tracks the end of the last page actually
  // fetched. Only a genuine fresh load (not a silent refocus reload) touches
  // it; see the "if (!opts?.silent)" branch below.
  const cursorRef = useRef<{ viewed: boolean; createdAt: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const loadingMoreRef = useRef(false);

  // Seed instantly from the last successful response, cached per hub, so
  // reopening Feed (cold start, or right after a hub restart) shows the
  // last-seen posts instead of a blank screen while the real fetch is still
  // in flight. Cached exactly as the server returned it (already unseen-
  // first/newest-first sorted), so no re-sort needed on read.
  useEffect(() => {
    if (!session) return;
    hasContentRef.current = false;
    readCache<HubPost[]>(session.hub.slug, FEED_CACHE_KEY).then((cached) => {
      if (cached && cached.length > 0) {
        setPosts(cached);
        hasContentRef.current = true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.hub.slug]);

  // Guards against two overlapping fetches to the same hub — e.g. the
  // silent refocus reload below (coming back from a post you just opened)
  // landing at the same moment as a manual pull-to-refresh. Each hub is a
  // single self-hosted machine reached over its own tunnel, not a scaled
  // cloud backend, and firing two concurrent GET /api/posts against it was
  // producing outright connection failures ("Network request failed"), not
  // just wasted duplicate work. A request that arrives mid-fetch is
  // remembered (not dropped) and replayed once the in-flight one settles, so
  // a pull-to-refresh during a silent reload still ends up doing one real,
  // non-silent fetch — just sequenced after, not layered on top.
  const loadInFlightRef = useRef(false);
  const pendingLoadRef = useRef<{ silent?: boolean } | null>(null);

  const load = useCallback(
    (opts?: { silent?: boolean; isRetry?: boolean }) => {
      if (!session) return;
      if (loadInFlightRef.current) {
        pendingLoadRef.current = opts ?? {};
        return;
      }
      loadInFlightRef.current = true;
      if (!opts?.silent) setLoading(true);
      setError(null);
      // Opportunistic retry of anything queued — sequenced ahead of the
      // actual fetch so a post this device just queued (offline compose,
      // now reconnected) shows up in this very refresh; a no-op, no network
      // call, when the queue's empty. See lib/api/write-queue.ts.
      flushWriteQueue()
        .catch(() => {})
        .then(() => getPosts(session.hub.tunnelUrl, session.token, { limit: PAGE_SIZE }))
        .then((page) => {
          // The server sorts unseen-first/newest-first (see server.js) and
          // re-evaluates that on every fetch — a post read earlier this
          // session keeps sinking toward the bottom as more posts get marked
          // seen there, not frozen in place after the first load. A silent
          // reload takes the fresh page 1 as-is (already correctly sorted)
          // and keeps whatever's loaded beyond it untouched; see
          // mergeWithFreshFirstPage's own note.
          setPosts((prev) => (opts?.silent && prev.length > 0 ? mergeWithFreshFirstPage(prev, page.posts) : page.posts));
          hasContentRef.current = true;
          // A silent refocus reload only re-fetches page 1 to refresh the
          // freshest posts' data — it must never touch pagination state, or
          // refocusing after the user had already scrolled several pages
          // down would rewind the cursor/hasMore back to "just page 1,"
          // making the very next loadMore re-fetch (and duplicate) posts
          // already on screen.
          if (!opts?.silent) {
            cursorRef.current = cursorOf(page.posts);
            setHasMore(page.hasMore);
            setLoadMoreError(false);
          }
          // Cached exactly as the server returned it — the cache-seed effect
          // above trusts that order directly on read, no re-sort needed.
          // Only page 1 is cached — a cold start re-paginates from scratch
          // via scroll, same as any other infinite-scroll feed.
          writeCache(session.hub.slug, FEED_CACHE_KEY, page.posts);
        })
        // Deliberately leaves `posts` alone on failure (e.g. the hub is
        // mid-restart) rather than clearing it — the cache-seeded/last-good
        // list stays on screen with the error shown alongside it. A SILENT
        // failure never surfaces the banner at all — there's already good
        // content on screen (that's the whole premise of "silent"), and a
        // background refocus refresh hiccuping for a moment right after
        // navigating back from a post isn't something worth alarming the
        // user over. It gets one quiet retry a beat later instead (real
        // observed behavior: the identical request succeeds as soon as the
        // user manually pulls to refresh a moment after this one fails —
        // this just does that automatically rather than waiting on them to
        // notice and do it themselves). A retry that also fails just stays
        // quiet and leaves the existing list as-is.
        .catch((err) => {
          if (!opts?.silent) {
            setError(err instanceof Error ? err.message : 'Failed to load.');
          } else if (!opts.isRetry) {
            setTimeout(() => load({ silent: true, isRetry: true }), 1200);
          }
        })
        .finally(() => {
          setLoading(false);
          loadInFlightRef.current = false;
          const pending = pendingLoadRef.current;
          pendingLoadRef.current = null;
          if (pending) load(pending);
        });
    },
    [session]
  );

  // Infinite scroll — fetches the next page using cursorRef (the end of the
  // last page actually loaded) and appends it in the server's own order
  // (unseen-first/newest-first is a whole-hub sort now, not something this
  // screen re-derives — see server.js). Shares load()'s in-flight flag
  // (loadInFlightRef) so a load-more can't fire concurrently with a refresh
  // against the same hub — the exact overlap that was producing "Network
  // request failed" before load() got its own guard. A failure here doesn't
  // touch `error` (that's reserved for the initial/refresh load blocking the
  // whole screen) — it shows a small inline retry in the footer instead, and
  // leaves hasMore untouched so scrolling further tries again naturally.
  const loadMore = useCallback(() => {
    if (!session || !hasMore || loadingMoreRef.current || loadInFlightRef.current || !cursorRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    getPosts(session.hub.tunnelUrl, session.token, { limit: PAGE_SIZE, before: cursorRef.current })
      .then((page) => {
        setPosts((prev) => [...prev, ...page.posts]);
        cursorRef.current = cursorOf(page.posts) ?? cursorRef.current;
        setHasMore(page.hasMore);
        setLoadMoreError(false);
      })
      .catch(() => setLoadMoreError(true))
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [session, hasMore]);

  // Focus-based, not mount-only — see Home/Messages for why (liking or voting
  // from a post's own detail screen and coming back here should show it).
  // Silent once there's already content on screen; FlatList's own manual
  // pull-to-refresh below always calls load() with no args, so it still
  // shows its spinner.
  useFocusEffect(
    useCallback(() => {
      load({ silent: hasContentRef.current });
    }, [load])
  );

  // "Consumed" = ≥60% on-screen for a continuous 2.0s (viewabilityConfig/
  // onViewableItemsChanged below), or an immediate like/vote/RSVP/tap-through
  // (markEngaged, called from each handler and from PostRow's onOpen). No
  // backend to send this to yet, so it's local-only session state for
  // now — see lib/ui/post-dwell-tracking.ts's own note on that.
  const { viewabilityConfig, onViewableItemsChanged, markEngaged } = usePostDwellTracking();

  // Feed moved inside the (tabs) group (href: null — same pattern as
  // app/(tabs)/discover.tsx — so it's a real, navigable route without its
  // own tab bar button) specifically so it renders WITH the shared floating
  // tab bar rather than needing its own copy of it. Only iOS's tab bar
  // floats over content (see app/(tabs)/_layout.tsx) — compensate so the
  // last post doesn't end up hidden behind the glass, same as Home/Profile.
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;

  // Same scroll-driven tab bar hide/show as Home/Profile (see app/(tabs)/
  // index.tsx's own, more detailed note on why this accumulates distance in
  // the current direction rather than comparing only the last frame's delta).
  const { setHidden: setTabBarHidden } = useTabBarVisibility();
  const lastScrollY = useRef(0);
  const accumulatedDelta = useRef(0);
  // Feed has no tab bar button of its own to re-tap (see the comment above
  // extraBottomInset — it's href: null), so useScrollToTop's usual "tap the
  // active tab" gesture isn't available here the way it is on Home/Messages.
  // A FAB is the fallback, same pattern as app/files/index.tsx's own
  // scroll-to-top button.
  const listRef = useRef<FlatList>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const diff = y - lastScrollY.current;
      const SCROLL_HIDE_THRESHOLD = 12;
      const NEAR_TOP_THRESHOLD = 40;

      setShowScrollTop(y > SCROLL_TOP_THRESHOLD);

      if ((diff > 0 && accumulatedDelta.current < 0) || (diff < 0 && accumulatedDelta.current > 0)) {
        accumulatedDelta.current = 0;
      }
      accumulatedDelta.current += diff;
      lastScrollY.current = y;

      if (y <= NEAR_TOP_THRESHOLD) {
        setTabBarHidden(false);
        accumulatedDelta.current = 0;
      } else if (accumulatedDelta.current > SCROLL_HIDE_THRESHOLD) {
        setTabBarHidden(true);
        accumulatedDelta.current = 0;
      } else if (accumulatedDelta.current < -SCROLL_HIDE_THRESHOLD) {
        setTabBarHidden(false);
        accumulatedDelta.current = 0;
      }
    },
    [setTabBarHidden]
  );

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // Stable across renders (useCallback, not a plain function declaration) —
  // PostRow is wrapped in React.memo below, and that memo only actually
  // prevents re-renders if every prop it's given (these handlers included)
  // keeps the same identity from one FlatList render to the next. An
  // unmemoized handler recreated every render would make the memo a no-op:
  // React.memo's shallow prop comparison would see a "new" function each
  // time and re-render the row anyway, regardless of whether post/session
  // actually changed.
  const handleToggleLike = useCallback(
    (post: HubPost) => {
      if (!session) return;
      markEngaged(post.id);
      const wasLiked = post.my_liked;
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, my_liked: !wasLiked, like_count: p.like_count + (wasLiked ? -1 : 1) } : p
        )
      );
      toggleLike(session.hub.tunnelUrl, session.token, post.id).catch(() => {
        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? { ...p, my_liked: wasLiked, like_count: post.like_count } : p))
        );
      });
    },
    [session, markEngaged]
  );

  const handleVotePoll = useCallback(
    (post: HubPost, optionIndex: number) => {
      if (!session) return;
      markEngaged(post.id);
      const prevPoll = post.poll;
      setPosts((prev) => prev.map((p) => (p.id === post.id ? applyVote(p, optionIndex) : p)));
      voteOrQueue(session.hub.tunnelUrl, session.token, post.id, optionIndex).catch(() => {
        setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, poll: prevPoll } : p)));
      });
    },
    [session, markEngaged]
  );

  const handleToggleRsvp = useCallback(
    (post: HubPost) => {
      if (!session) return;
      markEngaged(post.id);
      const wasGoing = post.my_rsvp;
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, my_rsvp: !wasGoing, rsvp_count: p.rsvp_count + (wasGoing ? -1 : 1) } : p))
      );
      toggleRsvp(session.hub.tunnelUrl, session.token, post.id).catch(() => {
        setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, my_rsvp: wasGoing, rsvp_count: post.rsvp_count } : p)));
      });
    },
    [session, markEngaged]
  );

  const handleOpen = useCallback((post: HubPost) => markEngaged(post.id), [markEngaged]);

  const keyExtractor = useCallback((post: HubPost) => post.id, []);

  const renderItem = useCallback(
    ({ item }: { item: HubPost }) => {
      if (!session) return null;
      return (
        <PostRow
          post={item}
          tunnelUrl={session.hub.tunnelUrl}
          token={session.token}
          onToggleLike={handleToggleLike}
          onVotePoll={handleVotePoll}
          onToggleRsvp={handleToggleRsvp}
          onOpen={handleOpen}
          // A preview, not the full post — Feed already marks a post
          // "consumed" just from dwell time (see usePostDwellTracking
          // below), which is a much more honest signal against a short
          // snippet than against a wall of full body text + media scrolling
          // past. The full post lives one tap away at post/[id].
          bodyNumberOfLines={3}
        />
      );
    },
    [session, handleToggleLike, handleVotePoll, handleToggleRsvp, handleOpen]
  );

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Feed" />
      {/* Shaped placeholder, not a spinner, for the very first load (before
          the cache-seed effect above has anything to show) — matches the
          real PostRow shape so the screen reads as "content is arriving,"
          not just "something is happening." */}
      {loading && posts.length === 0 && <PostListSkeleton style={styles.skeleton} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      <FlatList
        ref={listRef}
        data={posts}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + extraBottomInset }]}
        onRefresh={load}
        refreshing={loading}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={renderItem}
        // removeClippedSubviews is Android-only by design — on iOS it's had
        // a history of clipping content that's still supposed to be visible
        // (measurement races with Fabric), so this only opts in where it's
        // actually safe. No getItemLayout: PostRow's height varies with body
        // length, media, and whether it's a poll/event with RSVP — a fixed
        // height here would just make the scrollbar and jump-to-offset
        // calculations wrong, not faster.
        removeClippedSubviews={Platform.OS === 'android'}
        maxToRenderPerBatch={5}
        windowSize={7}
        initialNumToRender={6}
        onEndReached={loadMore}
        // 0.5 = starts fetching the next page while the reader's still half
        // a screen's height above the bottom, so the next page is usually
        // already in by the time they'd actually hit the end.
        onEndReachedThreshold={0.5}
        ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No posts yet.</ThemedText> : null}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footerSpinner} />
          ) : loadMoreError ? (
            <Pressable onPress={loadMore} style={styles.footerRetry}>
              <ThemedText style={styles.footerRetryText}>Couldn't load more — tap to retry</ThemedText>
            </Pressable>
          ) : !hasMore && posts.length > 0 ? (
            <ThemedText style={styles.footerEnd}>You're all caught up</ThemedText>
          ) : null
        }
      />

      {/* Back-to-top FAB — appears once scrolled past SCROLL_TOP_THRESHOLD,
          same pattern as app/files/index.tsx's own. Anchored above
          extraBottomInset (the floating tab bar's own height on iOS, 0 on
          Android where the bar doesn't overlap content) rather than just the
          safe-area inset, so it's never covered by the glass tab bar even
          when scrolling back up re-reveals it mid-way through this gesture. */}
      {showScrollTop && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          style={[styles.scrollTopFab, { bottom: 24 + extraBottomInset }]}
          pointerEvents="box-none">
          <Pressable onPress={scrollToTop} style={styles.scrollTopButton} accessibilityLabel="Scroll to top" accessibilityRole="button">
            <IconSymbol name="chevron.up" size={22} color="#fff" />
          </Pressable>
        </Animated.View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  skeleton: {
    paddingHorizontal: 10,
  },
  list: {
    paddingHorizontal: 10,
    paddingBottom: 24,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
  },
  footerSpinner: {
    marginVertical: 20,
  },
  footerRetry: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerRetryText: {
    opacity: 0.7,
    fontSize: 13,
  },
  footerEnd: {
    textAlign: 'center',
    opacity: 0.5,
    fontSize: 13,
    paddingVertical: 20,
  },
  scrollTopFab: {
    position: 'absolute',
    right: 20,
  },
  scrollTopButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
});
