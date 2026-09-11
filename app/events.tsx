import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { PostRow } from '@/components/post-row';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PostListSkeleton } from '@/components/ui/list-skeleton';
import { Brand } from '@/constants/theme';
import { readCache, writeCache } from '@/lib/api/dataCache';
import { getUpcomingEvents, listEventPosts, toggleLike, toggleRsvp } from '@/lib/api/hubService';
import { HubPost } from '@/lib/api/types';
import { flushWriteQueue, voteOrQueue } from '@/lib/api/write-queue';
import { applyVote } from '@/lib/ui/poll';
import { usePostDwellTracking } from '@/lib/ui/post-dwell-tracking';
import { useSession } from '@/lib/session/session-context';

type Tab = 'upcoming' | 'past';
const TABS: Tab[] = ['upcoming', 'past'];

// A quarter of the pane width is "far enough" to commit to the next tab —
// short of that (or a slow drag released early) snaps back to where it
// started, same threshold-vs-velocity logic as native swipeable tab views.
const COMMIT_RATIO = 0.25;
const FLING_VELOCITY = 600;

const EVENTS_CACHE_KEY = 'events-dashboard';
type EventsCacheData = { upcoming: HubPost[]; allEvents: HubPost[] };

export default function EventsScreen() {
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [upcoming, setUpcoming] = useState<HubPost[]>([]);
  // Every EVENT post — "past" is derived by excluding whatever's already in
  // `upcoming`, rather than reimplementing the server's own upcoming/past
  // boundary client-side. See lib/api/hubService.ts's listEventPosts().
  const [allEvents, setAllEvents] = useState<HubPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  // Only steer the tab automatically once, right after the first real load —
  // a manual tap back to an empty "Upcoming" later (or a background refetch
  // on refocus) should never yank the user somewhere they didn't ask for.
  const hasAutoSelected = useRef(false);
  // Same trio as Home/Discover/Feed's own load() guards — see their comments.
  const hasContentRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const pendingLoadRef = useRef<{ silent?: boolean } | null>(null);

  // Seed instantly from the last successful response, cached per hub — same
  // pattern as Feed/Home/Discover's own cache-seed effect.
  useEffect(() => {
    if (!session) return;
    hasContentRef.current = false;
    readCache<EventsCacheData>(session.hub.slug, EVENTS_CACHE_KEY).then((cached) => {
      if (!cached) return;
      setUpcoming(cached.upcoming);
      setAllEvents(cached.allEvents);
      hasContentRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.hub.slug]);

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
      // Opportunistic retry of anything queued (see lib/api/write-queue.ts) —
      // fire-and-forget, not sequenced ahead of the fetch below. A no-op, no
      // network call, when the queue's empty.
      flushWriteQueue().catch(() => {});
      let retrying = false;
      Promise.all([
        getUpcomingEvents(session.hub.tunnelUrl, session.token),
        listEventPosts(session.hub.tunnelUrl, session.token),
      ])
        .then(([nextUpcoming, nextAll]) => {
          setUpcoming(nextUpcoming);
          setAllEvents(nextAll);
          hasContentRef.current = true;
          writeCache(session.hub.slug, EVENTS_CACHE_KEY, { upcoming: nextUpcoming, allEvents: nextAll } satisfies EventsCacheData);
          if (!hasAutoSelected.current) {
            hasAutoSelected.current = true;
            // Nothing upcoming but there's real history to browse — land there
            // instead of a bare "No upcoming events." on first open. If both
            // are empty, stay put; the empty state itself carries a "Create an
            // event" CTA in that case (see ListEmptyComponent below). Just
            // `setTab` here — the effect below (shared with the tap-to-select
            // path) is what actually animates the pane into view.
            const hasUpcoming = nextUpcoming.length > 0;
            const hasPast = nextAll.length > nextUpcoming.length;
            if (!hasUpcoming && hasPast) setTab('past');
          }
        })
        .catch((err) => {
          // Same policy as Home/Discover/Feed: a silent refocus reload (or a
          // non-silent load with nothing on screen yet — a cold app+server
          // restart hiccup) gets one quiet retry before it's treated as a
          // real, banner-worthy failure.
          if (!opts?.isRetry && (opts?.silent || !hasContentRef.current)) {
            retrying = true;
            setTimeout(() => load({ silent: opts?.silent, isRetry: true }), 1200);
            return;
          }
          if (!opts?.silent) setError(err instanceof Error ? err.message : 'Failed to load.');
        })
        .finally(() => {
          loadInFlightRef.current = false;
          if (!retrying) setLoading(false);
          const pending = pendingLoadRef.current;
          pendingLoadRef.current = null;
          if (pending) load(pending);
        });
    },
    [session]
  );

  // Focus-based, not mount-only — see Home/Messages for why. Silent once
  // there's already content on screen, same as Feed/Home/Discover.
  useFocusEffect(
    useCallback(() => {
      load({ silent: hasContentRef.current });
    }, [load])
  );

  // Both panes are real FlatLists, so both get full dwell tracking (not
  // just engagement) — see lib/ui/post-dwell-tracking.ts. One hook call
  // covers both; viewabilityConfig/onViewableItemsChanged aren't pane-specific.
  const { viewabilityConfig, onViewableItemsChanged, markEngaged } = usePostDwellTracking();

  const past = useMemo(() => {
    const upcomingIds = new Set(upcoming.map((e) => e.id));
    return [...allEvents]
      .filter((e) => !upcomingIds.has(e.id) && e.event_date)
      .sort((a, b) => new Date(b.event_date!).getTime() - new Date(a.event_date!).getTime());
  }, [upcoming, allEvents]);

  // useCallback, not plain function declarations — PostRow is React.memo'd,
  // which only skips a re-render when every prop (these handlers included)
  // keeps the same identity across renders. See feed.tsx's own note on this.
  const handleToggleLike = useCallback(
    (event: HubPost) => {
      if (!session) return;
      markEngaged(event.id);
      const wasLiked = event.my_liked;
      const apply = (list: HubPost[]) =>
        list.map((e) => (e.id === event.id ? { ...e, my_liked: !wasLiked, like_count: e.like_count + (wasLiked ? -1 : 1) } : e));
      setUpcoming(apply);
      setAllEvents(apply);
      toggleLike(session.hub.tunnelUrl, session.token, event.id).catch(() => {
        const rollback = (list: HubPost[]) =>
          list.map((e) => (e.id === event.id ? { ...e, my_liked: wasLiked, like_count: event.like_count } : e));
        setUpcoming(rollback);
        setAllEvents(rollback);
      });
    },
    [session, markEngaged]
  );

  const handleVotePoll = useCallback(
    (post: HubPost, optionIndex: number) => {
      if (!session) return;
      markEngaged(post.id);
      const prevPoll = post.poll;
      const apply = (list: HubPost[]) => list.map((e) => (e.id === post.id ? applyVote(e, optionIndex) : e));
      setUpcoming(apply);
      setAllEvents(apply);
      voteOrQueue(session.hub.tunnelUrl, session.token, post.id, optionIndex).catch(() => {
        const rollback = (list: HubPost[]) => list.map((e) => (e.id === post.id ? { ...e, poll: prevPoll } : e));
        setUpcoming(rollback);
        setAllEvents(rollback);
      });
    },
    [session, markEngaged]
  );

  const handleToggleRsvp = useCallback(
    (event: HubPost) => {
      if (!session) return;
      markEngaged(event.id);
      const wasGoing = event.my_rsvp;
      const apply = (list: HubPost[]) =>
        list.map((e) => (e.id === event.id ? { ...e, my_rsvp: !wasGoing, rsvp_count: e.rsvp_count + (wasGoing ? -1 : 1) } : e));
      setUpcoming(apply);
      setAllEvents(apply);
      toggleRsvp(session.hub.tunnelUrl, session.token, event.id).catch(() => {
        const rollback = (list: HubPost[]) =>
          list.map((e) => (e.id === event.id ? { ...e, my_rsvp: wasGoing, rsvp_count: event.rsvp_count } : e));
        setUpcoming(rollback);
        setAllEvents(rollback);
      });
    },
    [session, markEngaged]
  );

  const keyExtractor = useCallback((event: HubPost) => event.id, []);

  // Shared by both panes (upcoming/past) — identical rendering either way,
  // so one stable callback rather than one defined fresh inside renderPane
  // per call.
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
        />
      );
    },
    [session, handleToggleLike, handleVotePoll, handleToggleRsvp]
  );

  // translateX drives the two-pane row below (Upcoming pane + Past pane,
  // each exactly `paneWidth` wide) — 0 shows Upcoming, -paneWidth shows Past.
  // A tap on a tab label and a drag both just animate this same value, so
  // the two ways of switching feel like the same underlying motion.
  const translateX = useSharedValue(0);
  const activeIndex = useSharedValue(0);

  function commitTab(next: Tab) {
    setTab(next);
  }

  function settleTo(index: number) {
    'worklet';
    activeIndex.value = index;
    translateX.value = withTiming(-index * paneWidth, { duration: 240 });
  }

  // The single place that keeps the animated position in sync with `tab`
  // for every *non-drag* trigger — tapping a label, and the auto-select-on-
  // load branch above. Deliberately not called directly from either of
  // those: `load()` is a memoized useCallback (deps: [session] only), so a
  // `settleTo` reference it closed over could read a stale `paneWidth` from
  // whenever it was created, not the real one from onLayout — this effect
  // always sees the current render's `paneWidth` instead. The drag gesture
  // below still calls settleTo directly, on the UI thread, for zero-latency
  // release feedback — this effect firing again afterward (since it changes
  // `tab` too) just re-targets the same value, harmlessly.
  useEffect(() => {
    if (paneWidth === 0) return;
    settleTo(TABS.indexOf(tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, paneWidth]);

  function selectTab(next: Tab) {
    setTab(next);
  }

  // .activeOffsetX/.failOffsetY is what lets this coexist with each pane's
  // own vertically-scrolling FlatList underneath — the pan only actually
  // takes over once a drag is unambiguously horizontal; a mostly-vertical
  // drag (normal list scrolling) fails out of this gesture immediately and
  // reaches the FlatList instead. Requires paneWidth from onLayout below, not
  // Dimensions.get('window') — this row isn't full-screen-width by itself.
  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      const base = -activeIndex.value * paneWidth;
      translateX.value = Math.min(0, Math.max(-paneWidth, base + e.translationX));
    })
    .onEnd((e) => {
      const base = -activeIndex.value * paneWidth;
      const draggedRatio = (translateX.value - base) / paneWidth;
      let nextIndex = activeIndex.value;
      if (draggedRatio <= -COMMIT_RATIO || e.velocityX <= -FLING_VELOCITY) {
        nextIndex = Math.min(TABS.length - 1, activeIndex.value + 1);
      } else if (draggedRatio >= COMMIT_RATIO || e.velocityX >= FLING_VELOCITY) {
        nextIndex = Math.max(0, activeIndex.value - 1);
      }
      if (nextIndex !== activeIndex.value && Platform.OS === 'ios') {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
      }
      settleTo(nextIndex);
      runOnJS(commitTab)(TABS[nextIndex]);
    });

  const paneRowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!session) return null;

  function renderPane(events: HubPost[], emptyLabel: string, showCreateCta: boolean) {
    return (
      <View style={{ width: paneWidth }}>
        <FlatList
          data={events}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          onRefresh={load}
          refreshing={loading}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          renderItem={renderItem}
          // See feed.tsx's own note on both of these — Android-only clipping,
          // and no getItemLayout since event rows vary in height (RSVP row,
          // location link, poll, media all optional).
          removeClippedSubviews={Platform.OS === 'android'}
          maxToRenderPerBatch={5}
          windowSize={7}
          initialNumToRender={6}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <IconSymbol name="calendar" size={28} color={Brand} />
                <ThemedText style={styles.emptyTitle}>{emptyLabel}</ThemedText>
                {showCreateCta && (
                  <>
                    <ThemedText style={styles.emptySubtitle}>Be the first to plan something for the neighborhood.</ThemedText>
                    <Pressable style={styles.emptyCta} onPress={() => router.push('/event-editor')}>
                      <IconSymbol name="plus" size={15} color="#fff" />
                      <ThemedText style={styles.emptyCtaLabel} lightColor="#fff" darkColor="#fff">
                        Create an event
                      </ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null
          }
        />
      </View>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader
        title="Events"
        rightIcon="plus"
        onRightPress={() => router.push('/event-editor')}
        rightAccessibilityLabel="New event"
      />

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => selectTab(t)} style={[styles.tab, tab === t && { borderBottomColor: Brand }]}>
            <ThemedText style={[styles.tabLabel, tab === t && { color: Brand, fontWeight: '600' }]}>
              {t === 'upcoming' ? 'Upcoming' : 'Past'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {/* Shaped placeholder, not a spinner, for the very first load — see
          components/ui/list-skeleton.tsx's own note on why. */}
      {loading && upcoming.length === 0 && allEvents.length === 0 && <PostListSkeleton style={styles.skeleton} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <View style={styles.paneClip} onLayout={(e) => setPaneWidth(e.nativeEvent.layout.width)}>
        {paneWidth > 0 && (
          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.paneRow, { width: paneWidth * TABS.length }, paneRowStyle]}>
              {renderPane(upcoming, 'No upcoming events.', true)}
              {renderPane(past, 'No past events yet.', false)}
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    marginBottom: 4,
  },
  tab: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 14,
    opacity: 0.7,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  paneClip: {
    flex: 1,
    overflow: 'hidden',
  },
  paneRow: {
    flex: 1,
    flexDirection: 'row',
  },
  skeleton: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 6,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 4,
  },
  emptyCtaLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
