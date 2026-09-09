import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { PostRow } from '@/components/post-row';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { readCache, writeCache } from '@/lib/api/dataCache';
import { getPosts, toggleLike, toggleRsvp } from '@/lib/api/hubService';
import { HubPost } from '@/lib/api/types';
import { flushWriteQueue, voteOrQueue } from '@/lib/api/write-queue';
import { applyVote } from '@/lib/ui/poll';
import { usePostDwellTracking } from '@/lib/ui/post-dwell-tracking';
import { useTabBarVisibility } from '@/lib/ui/tab-bar-visibility';
import { useSession } from '@/lib/session/session-context';

const FEED_CACHE_KEY = 'feed-posts';

export default function FeedScreen() {
  const { session } = useSession();
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Flips true once Feed has shown *something* (cache-seeded or fetched), so
  // a refocus refresh can run quietly instead of re-flashing the loading
  // spinner over content that's already on screen.
  const hasContentRef = useRef(false);

  // Seed instantly from the last successful response, cached per hub, so
  // reopening Feed (cold start, or right after a hub restart) shows the
  // last-seen posts instead of a blank screen while the real fetch is still
  // in flight.
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

  const load = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!session) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      // Opportunistic retry of anything queued — sequenced ahead of the
      // actual fetch so a post this device just queued (offline compose,
      // now reconnected) shows up in this very refresh; a no-op, no network
      // call, when the queue's empty. See lib/api/write-queue.ts.
      flushWriteQueue()
        .catch(() => {})
        .then(() => getPosts(session.hub.tunnelUrl, session.token))
        .then((next) => {
          setPosts(next);
          hasContentRef.current = true;
          writeCache(session.hub.slug, FEED_CACHE_KEY, next);
        })
        // Deliberately leaves `posts` alone on failure (e.g. the hub is
        // mid-restart) rather than clearing it — the cache-seeded/last-good
        // list stays on screen with the error shown alongside it.
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
        .finally(() => setLoading(false));
    },
    [session]
  );

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
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const diff = y - lastScrollY.current;
      const SCROLL_HIDE_THRESHOLD = 12;
      const NEAR_TOP_THRESHOLD = 40;

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
        />
      );
    },
    [session, handleToggleLike, handleVotePoll, handleToggleRsvp, handleOpen]
  );

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Feed" />
      {loading && posts.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      <FlatList
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
        ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No posts yet.</ThemedText> : null}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  list: {
    paddingHorizontal: 10,
    paddingBottom: 24,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
  },
});
