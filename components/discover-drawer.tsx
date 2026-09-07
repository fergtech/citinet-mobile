import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HubAvatar } from '@/components/hub-avatar';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPosts, getUpcomingEvents, listAtlasPins, listMarketplaceListings, listMembers } from '@/lib/api/hubService';
import { AtlasPin, HubMember, HubPost, MarketplaceListing } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { categoryMeta, PRICE_TYPE_META } from '@/lib/marketplace/categories';
import { formatListingPrice } from '@/lib/marketplace/format';
import { useSession } from '@/lib/session/session-context';
import { useDrawerCoordinator } from '@/lib/ui/drawer-coordinator';
import { formatEventWhen } from '@/lib/ui/format-event';
import { goToProfile } from '@/lib/ui/navigate-to-profile';
import { timeAgo } from '@/lib/ui/time-ago';

// Only this strip at the physical right edge can start opening it. Wider on
// Android, matching AppDrawer's own left-edge catcher (components/
// app-drawer.tsx) and for the same reason — a narrow strip there loses the
// touch to Android's system back-gesture (edge-swipe-to-go-back works from
// either edge in gesture-navigation mode) before this Pan gesture ever gets
// a chance to recognize it. See EDGE_WIDTH's fuller comment there.
const EDGE_WIDTH = Platform.OS === 'android' ? 40 : 24;
const DRAWER_WIDTH = 340;
const COMMIT_RATIO = 0.4;
const FLING_VELOCITY = 800;
const SETTLE_DURATION_MS = 240;
const PREVIEW_COUNT = 4;

type FilterId = 'all' | 'posts' | 'events' | 'atlas' | 'marketplace' | 'community';
const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'posts', label: 'Posts' },
  { id: 'events', label: 'Events' },
  { id: 'atlas', label: 'Atlas' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'community', label: 'Community' },
];

// Same ranking as Discover's own Trending section — see that screen's
// byEngagement for why (Home/Feed already cover "what's new").
function byEngagement(a: HubPost, b: HubPost) {
  return b.like_count + b.reply_count - (a.like_count + a.reply_count);
}

type DiscoverDrawerContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const DiscoverDrawerContext = createContext<DiscoverDrawerContextValue | null>(null);

// Lets any screen mounted inside <DiscoverDrawer> (i.e. anything under the
// (tabs) navigator) open/close it programmatically — the top-right search
// icon on Home uses this instead of navigating to /discover.
export function useDiscoverDrawer(): DiscoverDrawerContextValue {
  const ctx = useContext(DiscoverDrawerContext);
  if (!ctx) throw new Error('useDiscoverDrawer must be used within DiscoverDrawer');
  return ctx;
}

/**
 * Experimental right-edge drawer that mirrors app/(tabs)/discover.tsx's "All"
 * tab (search bar, category pills, Trending posts/Events/Atlas/Marketplace)
 * in a slide-in panel — without importing from or modifying that screen at
 * all. Its data is its own separately-fetched copy (same hubService calls
 * discover.tsx makes), since nothing there is exported for reuse and this
 * component is explicitly not meant to touch it.
 *
 * Same push-content mechanic as AppDrawer (components/app-drawer.tsx),
 * mirrored to the opposite edge: this panel sits fixed at the right edge the
 * whole time, and it's {children} — painted after it, opaque — that covers
 * it while closed and slides left to reveal it while open, rather than the
 * panel itself sliding in over a dimmed overlay. Wrapping AppDrawer as an
 * outer layer (see app/(tabs)/_layout.tsx) rather than reaching into it
 * keeps that file untouched and this drawer's right-edge gesture on a
 * physically separate strip of screen from AppDrawer's own left-edge one.
 */
export function DiscoverDrawer({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const { activeDrawer, notifyOpened, notifyClosed, canOpen } = useDrawerCoordinator();

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [events, setEvents] = useState<HubPost[]>([]);
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [members, setMembers] = useState<HubMember[]>([]);

  // 0 = closed (content sits at its natural position, fully covering the
  // panel underneath it — same "content painted over the drawer" trick
  // AppDrawer uses, not the panel hiding itself). -DRAWER_WIDTH = open
  // (content shifted left, exposing the panel docked at the right edge).
  const translateX = useSharedValue(0);

  function setOpenJS(next: boolean) {
    if (next !== open && Platform.OS === 'ios') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(next);
    if (next) notifyOpened('discover');
    else notifyClosed('discover');
  }

  // AppDrawer (left edge) opening while this one is already open -- force it
  // shut so the two can never both be visible/mid-gesture at once (mutual
  // exclusion is otherwise just "whoever's edge gesture fires second wins",
  // which is how the overlapping-backdrops bug happened).
  useEffect(() => {
    if (activeDrawer === 'app' && open) closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawer]);

  // Shared by both the gesture callbacks (already on the UI thread) and the
  // plain JS callers below (context toggle, header close button, row taps) —
  // 'worklet' functions are callable from either, same duality as AppDrawer's
  // own settle().
  function settle(next: boolean) {
    'worklet';
    translateX.value = withTiming(next ? -DRAWER_WIDTH : 0, { duration: SETTLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
    runOnJS(setOpenJS)(next);
  }

  function openDrawer() {
    translateX.value = withTiming(-DRAWER_WIDTH, { duration: SETTLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
    setOpenJS(true);
  }
  function closeDrawer() {
    translateX.value = withTiming(0, { duration: SETTLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
    setOpenJS(false);
  }
  function toggleDrawer() {
    if (open) closeDrawer();
    else openDrawer();
  }

  function goTo(href: Href) {
    closeDrawer();
    router.push(href);
  }

  // Lazy, one-shot load on first open — no need to hit the hub's API for a
  // panel the user may never open, and no reason to refetch every toggle.
  useEffect(() => {
    if (!open || loaded || !session) return;
    setLoading(true);
    Promise.all([
      getPosts(session.hub.tunnelUrl, session.token),
      getUpcomingEvents(session.hub.tunnelUrl, session.token),
      listAtlasPins(session.hub.tunnelUrl, session.token).catch(() => []),
      listMarketplaceListings(session.hub.tunnelUrl, session.token).catch(() => []),
      listMembers(session.hub.tunnelUrl, session.token).catch(() => []),
    ])
      .then(([nextPosts, nextEvents, nextPins, nextListings, nextMembers]) => {
        setPosts([...nextPosts].sort(byEngagement));
        setEvents(nextEvents);
        setAtlasPins(nextPins);
        setListings(nextListings);
        setMembers(nextMembers.filter((m) => m.user_id !== session.userId));
        setLoaded(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, loaded, session]);

  const nearestAtlasPins = useMemo(() => {
    if (!hubCenter) return atlasPins;
    return [...atlasPins].sort(
      (a, b) =>
        distanceMeters(hubCenter[0], hubCenter[1], a.latitude, a.longitude) -
        distanceMeters(hubCenter[0], hubCenter[1], b.latitude, b.longitude)
    );
  }, [atlasPins, hubCenter]);

  const trimmedQuery = query.trim().toLowerCase();
  const isSearching = trimmedQuery.length >= 2;

  const filteredPosts = useMemo(() => {
    if (!isSearching) return posts;
    return posts.filter((p) => p.title?.toLowerCase().includes(trimmedQuery) || p.body.toLowerCase().includes(trimmedQuery));
  }, [posts, trimmedQuery, isSearching]);

  const filteredEvents = useMemo(() => {
    if (!isSearching) return events;
    return events.filter((e) => e.title?.toLowerCase().includes(trimmedQuery) || e.body.toLowerCase().includes(trimmedQuery));
  }, [events, trimmedQuery, isSearching]);

  const filteredPins = useMemo(() => {
    if (!isSearching) return nearestAtlasPins;
    return nearestAtlasPins.filter(
      (p) => p.title.toLowerCase().includes(trimmedQuery) || (p.description ?? '').toLowerCase().includes(trimmedQuery)
    );
  }, [nearestAtlasPins, trimmedQuery, isSearching]);

  const filteredListings = useMemo(() => {
    if (!isSearching) return listings;
    return listings.filter(
      (l) => l.title.toLowerCase().includes(trimmedQuery) || l.vendor_name.toLowerCase().includes(trimmedQuery)
    );
  }, [listings, trimmedQuery, isSearching]);

  const filteredMembers = useMemo(() => {
    if (!isSearching) return members;
    return members.filter(
      (m) =>
        (m.display_name ?? '').toLowerCase().includes(trimmedQuery) ||
        m.username.toLowerCase().includes(trimmedQuery) ||
        (m.bio ?? '').toLowerCase().includes(trimmedQuery)
    );
  }, [members, trimmedQuery, isSearching]);

  const showPosts = filter === 'all' || filter === 'posts';
  const showEvents = filter === 'all' || filter === 'events';
  const showAtlas = filter === 'all' || filter === 'atlas';
  const showMarketplace = filter === 'all' || filter === 'marketplace';
  const showCommunity = filter === 'all' || filter === 'community';
  const cap = <T,>(list: T[]) => (filter === 'all' ? list.slice(0, PREVIEW_COUNT) : list);
  // While searching, a section with zero matches renders nothing at all --
  // header, "No X yet." empty state, everything -- instead of surfacing
  // five near-empty sections around the one real hit (empty states are only
  // useful outside search, where they mean "the hub genuinely has none").
  const visible = (show: boolean, count: number) => show && (!isSearching || count > 0);

  // Narrow edge strip, always mounted at the physical right edge — its own
  // layout bounds (not the full screen) restrict where this gesture can
  // start, same technique as AppDrawer's edgeCatcher. activeOffsetX(-10)
  // (negative-only) means it only ever recognizes a leftward drag —
  // opening, never closing — so it can't fight the close gesture below.
  // .enabled(canOpen('discover')) additionally shuts this off entirely
  // while AppDrawer is open, so a right-edge swipe can't fight its way in
  // mid-gesture on the other drawer.
  const edgePan = Gesture.Pan()
    .activeOffsetX(-10)
    .failOffsetY([-15, 15])
    .enabled(canOpen('discover'))
    .onUpdate((e) => {
      translateX.value = Math.max(-DRAWER_WIDTH, Math.min(0, e.translationX));
    })
    .onEnd((e) => {
      const openedRatio = -translateX.value / DRAWER_WIDTH;
      const committed = openedRatio >= COMMIT_RATIO || e.velocityX <= -FLING_VELOCITY;
      settle(committed);
    });

  // Covers the shifted content once open — drag right from anywhere on it,
  // or a plain tap, both close. Gesture.Race so a quick tap resolves as a
  // tap and a real drag resolves as a pan, instead of the two competing.
  // This is the ONLY GestureDetector this gesture is ever attached to — a
  // gesture-handler instance can't be shared across two GestureDetectors
  // (each needs its own), so nothing else may reuse this object.
  const closePan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      translateX.value = Math.max(-DRAWER_WIDTH, Math.min(0, -DRAWER_WIDTH + e.translationX));
    })
    .onEnd((e) => {
      const closedRatio = (translateX.value + DRAWER_WIDTH) / DRAWER_WIDTH;
      const committedToClose = closedRatio >= COMMIT_RATIO || e.velocityX >= FLING_VELOCITY;
      settle(!committedToClose);
    });
  const closeTap = Gesture.Tap().onEnd(() => {
    runOnJS(closeDrawer)();
  });
  const closeGesture = Gesture.Race(closePan, closeTap);

  // The panel's own translateX is a small parallax reveal on top of the
  // content-push above (0 at fully open, +40 — hidden a bit further behind
  // its own right:0 edge — at fully closed), same relationship AppDrawer's
  // drawerStyle has to its contentStyle, mirrored for the opposite edge.
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(translateX.value, [-DRAWER_WIDTH, 0], [0, 40]) }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-DRAWER_WIDTH, 0], [0.25, 0]),
  }));

  const contextValue = useMemo<DiscoverDrawerContextValue>(
    () => ({ isOpen: open, open: openDrawer, close: closeDrawer, toggle: toggleDrawer }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  return (
    <DiscoverDrawerContext.Provider value={contextValue}>
      <View style={styles.root}>
        <Animated.View
          style={[
            styles.panel,
            { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: Colors[colorScheme].background },
            panelStyle,
          ]}>
          <View style={styles.panelHeader}>
            <View style={styles.grabber} />
            <View style={styles.panelHeaderRow}>
              <ThemedText type="title" style={styles.panelTitle}>
                Discover
              </ThemedText>
              <Pressable onPress={closeDrawer} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
                <IconSymbol name="xmark" size={20} color={Colors[colorScheme].text} />
              </Pressable>
            </View>
          </View>

          <View style={styles.searchWrap}>
            <IconSymbol name="safari.fill" size={16} color={Colors[colorScheme].icon} style={styles.searchIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search posts, events, pins…"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.searchInput, { color: Colors[colorScheme].text }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.filterRowWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map((f) => {
                const active = f.id === filter;
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => setFilter(f.id)}
                    style={[styles.filterPill, active && { backgroundColor: Brand }]}>
                    <ThemedText style={styles.filterLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {f.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {loading && <ActivityIndicator style={styles.spinner} />}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {visible(showPosts, filteredPosts.length) && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionLabel}>Trending posts</ThemedText>
                {cap(filteredPosts).map((p) => (
                  <DrawerPostRow key={p.id} post={p} onPress={() => goTo({ pathname: '/post/[id]', params: { id: p.id } })} />
                ))}
                {!loading && !isSearching && filteredPosts.length === 0 && (
                  <ThemedText style={styles.rowMeta}>No posts yet.</ThemedText>
                )}
              </View>
            )}

            {visible(showEvents, filteredEvents.length) && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionLabel}>Events</ThemedText>
                {cap(filteredEvents).map((e) => (
                  <DrawerEventRow key={e.id} event={e} onPress={() => goTo({ pathname: '/post/[id]', params: { id: e.id } })} />
                ))}
                {!loading && !isSearching && filteredEvents.length === 0 && (
                  <ThemedText style={styles.rowMeta}>No upcoming events.</ThemedText>
                )}
              </View>
            )}

            {visible(showAtlas, filteredPins.length) && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionLabel}>Atlas</ThemedText>
                {cap(filteredPins).map((pin) => (
                  <DrawerAtlasRow
                    key={pin.id}
                    pin={pin}
                    meters={hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], pin.latitude, pin.longitude) : null}
                    onPress={() => goTo({ pathname: '/atlas/[id]', params: { id: pin.id } })}
                  />
                ))}
                {!loading && !isSearching && filteredPins.length === 0 && (
                  <ThemedText style={styles.rowMeta}>No pins yet.</ThemedText>
                )}
              </View>
            )}

            {visible(showMarketplace, filteredListings.length) && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionLabel}>Marketplace</ThemedText>
                {cap(filteredListings).map((listing) => (
                  <DrawerListingRow
                    key={listing.id}
                    listing={listing}
                    onPress={() => goTo({ pathname: '/marketplace/[id]', params: { id: listing.id } })}
                  />
                ))}
                {!loading && !isSearching && filteredListings.length === 0 && (
                  <ThemedText style={styles.rowMeta}>Nothing listed yet.</ThemedText>
                )}
              </View>
            )}

            {visible(showCommunity, filteredMembers.length) && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionLabel}>Community</ThemedText>
                {cap(filteredMembers).map((m) => (
                  <DrawerMemberRow
                    key={m.user_id}
                    member={m}
                    tunnelUrl={session?.hub.tunnelUrl ?? ''}
                    onPress={() => {
                      closeDrawer();
                      if (session) goToProfile(m.user_id, session.userId);
                    }}
                  />
                ))}
                {!loading && !isSearching && filteredMembers.length === 0 && (
                  <ThemedText style={styles.rowMeta}>No other neighbors yet.</ThemedText>
                )}
              </View>
            )}

            {isSearching &&
              !loading &&
              filteredPosts.length === 0 &&
              filteredEvents.length === 0 &&
              filteredPins.length === 0 &&
              filteredListings.length === 0 &&
              filteredMembers.length === 0 && (
                <View style={styles.section}>
                  <ThemedText style={styles.rowMeta}>No matches for &quot;{query.trim()}&quot;.</ThemedText>
                </View>
              )}
          </ScrollView>
        </Animated.View>

        <Animated.View style={[styles.flex, contentStyle]}>
          {children}
          {/* activeDrawer === 'discover' on top of `open` (not just `open`
              alone) -- when AppDrawer takes over, the coordinator's
              activeDrawer flips to 'app' in the same render that triggers
              this drawer's own close effect, one render ahead of `open`
              itself catching up. Gating on both means this overlay unmounts
              in that same render instead of lagging an extra frame behind,
              so the two drawers' overlays can never both be mounted at once. */}
          {open && activeDrawer === 'discover' && (
            <GestureDetector gesture={closeGesture}>
              <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} />
            </GestureDetector>
          )}
        </Animated.View>

        <GestureDetector gesture={edgePan}>
          <View style={styles.edgeCatcher} />
        </GestureDetector>
      </View>
    </DiscoverDrawerContext.Provider>
  );
}

function DrawerPostRow({ post, onPress }: { post: HubPost; onPress: () => void }) {
  const hasDistinctTitle = !!post.title?.trim() && post.title.trim() !== post.body.trim();
  return (
    <Pressable style={styles.itemRow} onPress={onPress}>
      {hasDistinctTitle && (
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {post.title}
        </ThemedText>
      )}
      {!!post.body.trim() && (
        <ThemedText numberOfLines={2} style={styles.rowMeta}>
          {post.body}
        </ThemedText>
      )}
      <ThemedText style={styles.itemMeta}>
        {post.category.charAt(0) + post.category.slice(1).toLowerCase()}
        {post.author_username ? ` · ${post.author_username}` : ''}
        {` · ${timeAgo(post.created_at)}`}
      </ThemedText>
    </Pressable>
  );
}

function DrawerEventRow({ event, onPress }: { event: HubPost; onPress: () => void }) {
  return (
    <Pressable style={styles.itemRow} onPress={onPress}>
      <View style={styles.eventRowTop}>
        <ThemedText type="defaultSemiBold" style={styles.eventRowTitle} numberOfLines={2}>
          {event.title ?? 'Event'}
        </ThemedText>
        <View style={styles.dateBadge}>
          <ThemedText style={[styles.dateBadgeLabel, { color: Brand }]} numberOfLines={1}>
            {event.event_date ? formatEventWhen(event.event_date, true) : 'TBA'}
          </ThemedText>
        </View>
      </View>
      {!!event.event_location && (
        <ThemedText numberOfLines={1} style={styles.rowMeta}>
          {event.event_location}
        </ThemedText>
      )}
    </Pressable>
  );
}

function DrawerAtlasRow({ pin, meters, onPress }: { pin: AtlasPin; meters: number | null; onPress: () => void }) {
  const meta = ATLAS_CATEGORIES[pin.category];
  return (
    <Pressable style={styles.iconRow} onPress={onPress}>
      <View style={[styles.iconBadge, { backgroundColor: meta.color }]}>
        <IconSymbol name={meta.icon} size={16} color="#fff" />
      </View>
      <View style={styles.iconRowText}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {pin.title}
        </ThemedText>
        <ThemedText numberOfLines={2} style={styles.rowMeta}>
          {pin.description?.trim() ? pin.description : `${meta.label}${meters !== null ? ` · ${formatDistanceMiles(meters)}` : ''}`}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function DrawerListingRow({ listing, onPress }: { listing: MarketplaceListing; onPress: () => void }) {
  const category = categoryMeta(listing.category);
  const kind = PRICE_TYPE_META[listing.price_type] ?? PRICE_TYPE_META.fixed;
  return (
    <Pressable style={styles.iconRow} onPress={onPress}>
      <View style={[styles.iconBadge, { backgroundColor: category.color }]}>
        <IconSymbol name={category.icon} size={16} color="#fff" />
      </View>
      <View style={styles.iconRowText}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {listing.title}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.rowMeta}>
          {listing.vendor_name}
        </ThemedText>
      </View>
      <View style={styles.priceCol}>
        <ThemedText style={styles.price}>{formatListingPrice(listing)}</ThemedText>
        <View style={[styles.kindBadge, { backgroundColor: kind.color + '22' }]}>
          <ThemedText style={[styles.kindBadgeLabel, { color: kind.color }]} numberOfLines={1}>
            {kind.label}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

// Community preview row — same icon-badge/title/meta shell as Atlas/
// Marketplace above, just with the member's real avatar (HubAvatar) standing
// in for the category-color icon badge, matching discover.tsx's own
// MemberRow content (name + bio, falling back to @username) at this
// drawer's row density.
function DrawerMemberRow({ member, tunnelUrl, onPress }: { member: HubMember; tunnelUrl: string; onPress: () => void }) {
  return (
    <Pressable style={styles.iconRow} onPress={onPress}>
      <HubAvatar userId={member.user_id} displayName={member.display_name || member.username} tunnelUrl={tunnelUrl} size={36} />
      <View style={styles.iconRowText}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {member.display_name || member.username}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.rowMeta}>
          {member.bio?.trim() ? member.bio : `@${member.username}`}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Wraps {children} — same role as AppDrawer's own contentStyle wrapper.
  // No zIndex/elevation on it or on `panel` below: this whole push-content
  // illusion depends on plain JSX paint order (panel first, this on top of
  // it) rather than explicit stacking, exactly like AppDrawer. Giving either
  // one a zIndex would let it escape that order and break the "content
  // covers the panel while closed" trick.
  flex: {
    flex: 1,
  },
  overlay: {
    backgroundColor: '#000',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: DRAWER_WIDTH,
  },
  panelHeader: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8884',
    marginBottom: 12,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    fontSize: 22,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#8881',
  },
  searchIcon: {
    opacity: 0.6,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  filterRowWrap: {
    paddingBottom: 12,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingVertical: 4,
    alignItems: 'center',
  },
  filterPill: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 32,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 22,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
    lineHeight: 17,
  },
  itemRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    gap: 2,
  },
  itemMeta: {
    opacity: 0.5,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  eventRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  eventRowTitle: {
    flex: 1,
  },
  dateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Brand + '18',
  },
  dateBadgeLabel: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRowText: {
    flex: 1,
    gap: 2,
  },
  priceCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '700',
  },
  kindBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  kindBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  // top starts below Home's header row, not at 0 — matching AppDrawer's own
  // edgeCatcher fix (components/app-drawer.tsx has the fuller comment): this
  // catcher always paints above {children}, so once EDGE_WIDTH widened
  // enough on Android it started sitting on top of Home's own top-right
  // search icon (same header, same row) and swallowing taps meant for it.
  // Clipping the catcher to start below that row excludes the icon's hit
  // region entirely instead of trying to out-stack it.
  edgeCatcher: {
    position: 'absolute',
    top: 112,
    bottom: 0,
    right: 0,
    width: EDGE_WIDTH,
    zIndex: 10,
    elevation: 10,
  },
});
