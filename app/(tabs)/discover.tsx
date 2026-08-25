import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useNavigation, type Href } from 'expo-router';
import { useBottomTabBarHeight, type BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { AtlasPinCard } from '@/components/atlas/pin-card';
import { EventAtlasLink } from '@/components/event-atlas-link';
import { FileRow } from '@/components/files/file-row';
import { HubAvatar } from '@/components/hub-avatar';
import { ListingCard } from '@/components/marketplace/listing-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PostGridCard } from '@/components/post-grid-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPosts, getUpcomingEvents, listAtlasPins, listFiles, listMarketplaceListings, listMembers, search, toggleLike } from '@/lib/api/hubService';
import { getHubs } from '@/lib/api/registryService';
import { AtlasPin, HubFile, HubMember, HubPost, MarketplaceListing, RegistryHub, SearchResults } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { useStarredFiles } from '@/lib/files/starred-files';
import { categoryMeta } from '@/lib/marketplace/categories';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';

type TabId = 'all' | 'posts' | 'people' | 'events' | 'hubs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'posts', label: 'Posts' },
  { id: 'people', label: 'People' },
  { id: 'events', label: 'Events' },
  { id: 'hubs', label: 'Other hubs' },
];

// Discover's Posts ranks by engagement rather than recency — Home/Feed
// already cover "what's new"; this surfaces "what's popular" instead, so the
// two screens don't just show the same list in a different place.
function byEngagement(a: HubPost, b: HubPost) {
  return b.like_count + b.reply_count - (a.like_count + a.reply_count);
}

// "All" is an overview, not a duplicate of the dedicated tabs — bounded
// previews of each, same pattern as Home's Discussions/Events sections.
const PREVIEW_COUNT = 4;

function MemberRow({ member, tunnelUrl }: { member: { user_id: string; display_name?: string | null; username: string; bio?: string | null }; tunnelUrl: string }) {
  const { session } = useSession();
  return (
    <Pressable style={styles.memberRow} onPress={() => session && goToProfile(member.user_id, session.userId)}>
      <HubAvatar userId={member.user_id} displayName={member.display_name || member.username} tunnelUrl={tunnelUrl} size={40} />
      <View style={styles.memberText}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {member.display_name || member.username}
        </ThemedText>
        {member.bio ? (
          <ThemedText numberOfLines={1} style={styles.rowMeta}>
            {member.bio}
          </ThemedText>
        ) : (
          <ThemedText numberOfLines={1} style={styles.rowMeta}>
            @{member.username}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

function HubRow({ hub }: { hub: RegistryHub }) {
  return (
    <View style={styles.hubRow}>
      <View style={styles.hubIcon}>
        <IconSymbol name="safari.fill" size={18} color={Brand} />
      </View>
      <View style={styles.memberText}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {hub.name}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.rowMeta}>
          {hub.location}
          {typeof hub.member_count === 'number' ? ` · ${hub.member_count} neighbors` : ''}
        </ThemedText>
      </View>
    </View>
  );
}

function EventRow({ event, tint }: { event: HubPost; tint: string }) {
  return (
    <View style={styles.eventRow}>
      <Pressable
        style={styles.eventTitleRow}
        onPress={() => router.push({ pathname: '/post/[id]', params: { id: event.id } })}>
        <IconSymbol name="calendar" size={16} color={tint} />
        <View style={styles.memberText}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {event.title ?? 'Event'}
          </ThemedText>
        </View>
      </Pressable>
      {event.event_location && <EventAtlasLink location={event.event_location} eventTitle={event.title} eventId={event.id} />}
    </View>
  );
}

export default function DiscoverScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const { isStarred, toggleStarred } = useStarredFiles();
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;
  const navigation = useNavigation<BottomTabNavigationProp<Record<string, undefined>>>();
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [myPostsOnly, setMyPostsOnly] = useState(false);
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [members, setMembers] = useState<HubMember[]>([]);
  const [events, setEvents] = useState<HubPost[]>([]);
  const [hubs, setHubs] = useState<RegistryHub[]>([]);
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return navigation.addListener('tabPress', (event) => {
      if (!navigation.isFocused()) return;
      event.preventDefault();
      if (scrollOffset.current > 0) {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        return;
      }
      setActiveTab('all');
    });
  }, [navigation]);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getPosts(session.hub.tunnelUrl, session.token),
      listMembers(session.hub.tunnelUrl, session.token),
      getUpcomingEvents(session.hub.tunnelUrl, session.token),
      getHubs(),
      listAtlasPins(session.hub.tunnelUrl, session.token).catch(() => []),
      listMarketplaceListings(session.hub.tunnelUrl, session.token).catch(() => []),
      listFiles(session.hub.tunnelUrl, session.token).catch(() => []),
    ])
      .then(([nextPosts, nextMembers, nextEvents, nextHubs, nextPins, nextListings, nextFiles]) => {
        setPosts([...nextPosts].sort(byEngagement));
        setMembers(nextMembers.filter((m) => m.user_id !== session.userId));
        setEvents(nextEvents);
        setHubs(nextHubs.filter((h) => h.slug !== session.hub.slug));
        setAtlasPins(nextPins);
        setListings(nextListings);
        setFiles(nextFiles);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  // Focus-based, not mount-only — see Home/Messages for the same fix and why.
  useFocusEffect(load);

  function handleToggleLike(post: HubPost) {
    if (!session) return;
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
  }

  // Matches the web client exactly: 300ms debounce, 2-character minimum.
  useEffect(() => {
    if (!session) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      search(session.hub.tunnelUrl, session.token, trimmed)
        .then(setSearchResults)
        .catch(() => setSearchResults({ posts: [], members: [], spaces: [] }))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, session]);

  // Nearest-first, same as Home's "From the Atlas" strip — Discover surfaces
  // specific pins you might have missed, not a map of the whole feature (see
  // project memory for why this replaced an earlier generic map-preview card).
  const nearestAtlasPins = useMemo(() => {
    if (!hubCenter) return atlasPins.slice(0, PREVIEW_COUNT);
    return [...atlasPins]
      .sort((a, b) => distanceMeters(hubCenter[0], hubCenter[1], a.latitude, a.longitude) - distanceMeters(hubCenter[0], hubCenter[1], b.latitude, b.longitude))
      .slice(0, PREVIEW_COUNT);
  }, [atlasPins, hubCenter]);

  // The real GET /api/search has no notion of Atlas pins at all (confirmed
  // directly in api/server.js — its response only ever has
  // posts/members/spaces/requests) and GET /api/atlas/pins has no
  // server-side search of its own either, same gap. So this searches
  // client-side over the pins already loaded for the "All" tab's preview —
  // real matching, just not server-backed, same 2-char threshold as the
  // real search so it activates alongside it rather than a beat early/late.
  const matchingAtlasPins = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return atlasPins.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.author_username ?? '').toLowerCase().includes(q) ||
        ATLAS_CATEGORIES[p.category].label.toLowerCase().includes(q)
    );
  }, [atlasPins, query]);

  // Most recent first — unlike Atlas pins there's no "distance from hub
  // center" concept for a marketplace listing, so recency is the natural
  // "here's something you might have missed" ordering (GET /api/marketplace/
  // listings already returns newest-first).
  const recentListings = useMemo(() => listings.slice(0, PREVIEW_COUNT), [listings]);

  // Same gap as Atlas pins: GET /api/search has no notion of listings either
  // (confirmed in api/server.js), so this filters the listings already
  // loaded for the "All" tab's preview — same 2-char threshold.
  const matchingListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return listings.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q) ||
        l.vendor_name.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
    );
  }, [listings, query]);

  // Most recently uploaded first — listFiles() is already scoped server-side
  // to "mine + is_public" (see hubService), same visibility Files' own list
  // screen shows, so this preview never teases something the viewer can't
  // actually open.
  const recentFiles = useMemo(
    () => [...files].sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()).slice(0, PREVIEW_COUNT),
    [files]
  );

  // Same gap as Atlas pins/listings: GET /api/search has no notion of files
  // either (confirmed in api/server.js), so this filters the files already
  // loaded for the "All" tab's preview — same 2-char threshold.
  const matchingFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return files.filter((f) => f.file_name.toLowerCase().includes(q));
  }, [files, query]);

  if (!session) return null;

  const isSearching = query.trim().length >= 2;
  const noSearchResults =
    isSearching &&
    matchingAtlasPins.length === 0 &&
    matchingListings.length === 0 &&
    matchingFiles.length === 0 &&
    searchResults &&
    !searchResults.posts.length &&
    !searchResults.members.length &&
    !searchResults.spaces.length;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Discover
        </ThemedText>
      </View>

      <View style={styles.searchWrap}>
        <IconSymbol name="safari.fill" size={16} color={Colors[colorScheme].icon} style={styles.searchIcon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people, spaces, posts…"
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.searchInput, { color: Colors[colorScheme].text }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" />}
      </View>

      {!isSearching && (
        // The scrollable row is wrapped in a plain View with a fixed, explicit
        // height — a horizontal ScrollView's own reported height isn't
        // reliable everywhere (it can collapse on react-native-web), so the
        // bound is enforced from outside instead of trusted from the
        // ScrollView itself. This guarantees the list below can never
        // overlap it, on web or native.
        <View style={styles.tabRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
            {TABS.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  style={[styles.tabPill, active && { backgroundColor: Brand }]}>
                  <ThemedText
                    style={styles.tabLabel}
                    lightColor={active ? '#fff' : undefined}
                    darkColor={active ? '#fff' : undefined}>
                    {tab.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <View style={styles.listWrap}>
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          onScroll={(event) => {
            scrollOffset.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: 24 + extraBottomInset }}>
        {isSearching ? (
          <View style={styles.section}>
            {noSearchResults && !searching && (
              <ThemedText style={styles.rowMeta}>No matches for &quot;{query.trim()}&quot;.</ThemedText>
            )}

            {!!searchResults?.members.length && (
              <>
                <ThemedText style={styles.sectionLabel}>People</ThemedText>
                {searchResults.members.map((m) => (
                  <MemberRow key={m.user_id} member={m} tunnelUrl={session.hub.tunnelUrl} />
                ))}
              </>
            )}

            {!!searchResults?.spaces.length && (
              <>
                <ThemedText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Spaces</ThemedText>
                {searchResults.spaces.map((s) => (
                  <View key={s.id} style={styles.hubRow}>
                    <View style={styles.hubIcon}>
                      <IconSymbol name="person.fill" size={16} color={Brand} />
                    </View>
                    <View style={styles.memberText}>
                      <ThemedText type="defaultSemiBold" numberOfLines={1}>
                        {s.name}
                      </ThemedText>
                      <ThemedText numberOfLines={1} style={styles.rowMeta}>
                        {s.member_count} members
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </>
            )}

            {!!searchResults?.posts.length && (
              <>
                <ThemedText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Posts</ThemedText>
                {searchResults.posts.map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.postRow}
                    onPress={() => router.push({ pathname: '/post/[id]', params: { id: p.id } })}>
                    {p.title && (
                      <ThemedText type="defaultSemiBold" numberOfLines={1}>
                        {p.title}
                      </ThemedText>
                    )}
                    <ThemedText numberOfLines={2} style={styles.rowMeta}>
                      {p.body}
                    </ThemedText>
                    <ThemedText style={styles.postMeta}>
                      {p.category.charAt(0) + p.category.slice(1).toLowerCase()}
                      {p.author_username ? ` · ${p.author_username}` : ''}
                    </ThemedText>
                  </Pressable>
                ))}
              </>
            )}

            {!!matchingAtlasPins.length && (
              <>
                <ThemedText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Pins</ThemedText>
                {matchingAtlasPins.map((pin) => {
                  const meta = ATLAS_CATEGORIES[pin.category];
                  const meters = hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], pin.latitude, pin.longitude) : null;
                  return (
                    <Pressable
                      key={pin.id}
                      style={styles.hubRow}
                      onPress={() => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } })}>
                      <View style={[styles.hubIcon, { backgroundColor: meta.color }]}>
                        <IconSymbol name={meta.icon} size={16} color="#fff" />
                      </View>
                      <View style={styles.memberText}>
                        <ThemedText type="defaultSemiBold" numberOfLines={1}>
                          {pin.title}
                        </ThemedText>
                        <ThemedText numberOfLines={1} style={styles.rowMeta}>
                          {meta.label}
                          {meters !== null ? ` · ${formatDistanceMiles(meters)}` : ''}
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {!!matchingListings.length && (
              <>
                <ThemedText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Listings</ThemedText>
                {matchingListings.map((listing) => {
                  const meta = categoryMeta(listing.category);
                  return (
                    <Pressable
                      key={listing.id}
                      style={styles.hubRow}
                      onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })}>
                      <View style={[styles.hubIcon, { backgroundColor: meta.color }]}>
                        <IconSymbol name={meta.icon} size={16} color="#fff" />
                      </View>
                      <View style={styles.memberText}>
                        <ThemedText type="defaultSemiBold" numberOfLines={1}>
                          {listing.title}
                        </ThemedText>
                        <ThemedText numberOfLines={1} style={styles.rowMeta}>
                          {listing.vendor_name} · {listing.category}
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {!!matchingFiles.length && (
              <>
                <ThemedText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Files</ThemedText>
                {matchingFiles.map((file) => (
                  <FileRow
                    key={file.file_id}
                    file={file}
                    starred={isStarred(file.file_id)}
                    onPress={() => router.push({ pathname: '/files/[id]', params: { id: file.file_id } })}
                    onToggleStar={() => toggleStarred(file.file_id)}
                  />
                ))}
              </>
            )}
          </View>
        ) : activeTab === 'all' ? (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Trending posts</ThemedText>
                {posts.length > PREVIEW_COUNT && (
                  <Pressable onPress={() => setActiveTab('posts')}>
                    <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>All posts</ThemedText>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendingStrip}>
                {posts.slice(0, PREVIEW_COUNT).map((p) => (
                  <PostGridCard
                    key={p.id}
                    post={p}
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
                    onToggleLike={handleToggleLike}
                    style={styles.trendingCard}
                  />
                ))}
              </ScrollView>
              {!loading && posts.length === 0 && <ThemedText style={styles.rowMeta}>No posts yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Events</ThemedText>
                <Pressable onPress={() => router.push('/events')}>
                  <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>View all events</ThemedText>
                </Pressable>
              </View>
              {events.slice(0, PREVIEW_COUNT).map((e) => (
                <EventRow key={e.id} event={e} tint={tint} />
              ))}
              {!loading && events.length === 0 && <ThemedText style={styles.rowMeta}>No upcoming events.</ThemedText>}
              {/* Unlike every sibling section's "View more" (only shown past
                  PREVIEW_COUNT, purely for pagination), this one is always
                  visible — this section only ever loads *upcoming* events
                  (getUpcomingEvents), so an empty/short list here doesn't mean
                  there's nothing to see, past events can still exist. Routes
                  to the real standalone Events screen (Upcoming/Past tabs),
                  not Discover's own same-data "Events" browse tab, since
                  that's the only place past events are actually derivable. */}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Atlas</ThemedText>
                {atlasPins.length > PREVIEW_COUNT && (
                  <Pressable onPress={() => router.push('/atlas' as Href)}>
                    <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>All pins</ThemedText>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.atlasStrip}>
                {nearestAtlasPins.map((pin) => (
                  <AtlasPinCard
                    key={pin.id}
                    pin={pin}
                    meters={hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], pin.latitude, pin.longitude) : null}
                    onPress={() => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } })}
                    style={styles.atlasCard}
                  />
                ))}
              </ScrollView>
              {!loading && atlasPins.length === 0 && <ThemedText style={styles.rowMeta}>No pins yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Marketplace</ThemedText>
                {listings.length > PREVIEW_COUNT && (
                  <Pressable onPress={() => router.push('/marketplace' as Href)}>
                    <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>View more</ThemedText>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketplaceStrip}>
                {recentListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
                    onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })}
                    style={styles.marketplaceCard}
                  />
                ))}
              </ScrollView>
              {!loading && listings.length === 0 && <ThemedText style={styles.rowMeta}>Nothing listed yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Files</ThemedText>
                {files.length > PREVIEW_COUNT && (
                  <Pressable onPress={() => router.push('/files' as Href)}>
                    <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>All files</ThemedText>
                  </Pressable>
                )}
              </View>
              {recentFiles.map((file) => (
                <FileRow
                  key={file.file_id}
                  file={file}
                  starred={isStarred(file.file_id)}
                  onPress={() => router.push({ pathname: '/files/[id]', params: { id: file.file_id } })}
                  onToggleStar={() => toggleStarred(file.file_id)}
                />
              ))}
              {!loading && files.length === 0 && <ThemedText style={styles.rowMeta}>No files in the hub yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>People</ThemedText>
                {members.length > PREVIEW_COUNT && (
                  <Pressable onPress={() => setActiveTab('people')}>
                    <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>View more</ThemedText>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleStrip}>
                {members.slice(0, PREVIEW_COUNT).map((m) => (
                  <View key={m.user_id} style={styles.horizontalRowItem}>
                    <MemberRow member={m} tunnelUrl={session.hub.tunnelUrl} />
                  </View>
                ))}
              </ScrollView>
              {!loading && members.length === 0 && <ThemedText style={styles.rowMeta}>No other neighbors yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Other hubs</ThemedText>
                {hubs.length > PREVIEW_COUNT && (
                  <Pressable onPress={() => setActiveTab('hubs')}>
                    <ThemedText style={[styles.viewMoreLabel, { color: Brand }]}>View more</ThemedText>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hubsStrip}>
                {hubs.slice(0, PREVIEW_COUNT).map((h) => (
                  <View key={h.id} style={styles.horizontalRowItem}>
                    <HubRow hub={h} />
                  </View>
                ))}
              </ScrollView>
              {!loading && hubs.length === 0 && <ThemedText style={styles.rowMeta}>No other hubs listed yet.</ThemedText>}
            </View>
          </>
        ) : activeTab === 'posts' ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setMyPostsOnly((v) => !v)}
              style={[styles.myPostsChip, myPostsOnly && { backgroundColor: Brand }]}>
              <IconSymbol name="person.fill" size={13} color={myPostsOnly ? '#fff' : Colors[colorScheme].icon} />
              <ThemedText
                style={styles.myPostsChipLabel}
                lightColor={myPostsOnly ? '#fff' : undefined}
                darkColor={myPostsOnly ? '#fff' : undefined}>
                My posts only
              </ThemedText>
            </Pressable>
            <View style={styles.grid}>
              {(myPostsOnly ? posts.filter((p) => p.author_id === session.userId) : posts).map((p) => (
                <PostGridCard
                  key={p.id}
                  post={p}
                  tunnelUrl={session.hub.tunnelUrl}
                  token={session.token}
                  onToggleLike={handleToggleLike}
                />
              ))}
            </View>
            {!loading && posts.length === 0 && <ThemedText style={styles.rowMeta}>No posts yet.</ThemedText>}
            {!loading && posts.length > 0 && myPostsOnly && !posts.some((p) => p.author_id === session.userId) && (
              <ThemedText style={styles.rowMeta}>You haven&apos;t posted anything yet.</ThemedText>
            )}
          </View>
        ) : activeTab === 'people' ? (
          <View style={styles.section}>
            {members.map((m) => (
              <MemberRow key={m.user_id} member={m} tunnelUrl={session.hub.tunnelUrl} />
            ))}
            {!loading && members.length === 0 && <ThemedText style={styles.rowMeta}>No other neighbors yet.</ThemedText>}
          </View>
        ) : activeTab === 'events' ? (
          <View style={styles.section}>
            {events.map((e) => (
              <EventRow key={e.id} event={e} tint={tint} />
            ))}
            {!loading && events.length === 0 && <ThemedText style={styles.rowMeta}>No upcoming events.</ThemedText>}
          </View>
        ) : (
          <View style={styles.section}>
            {hubs.map((h) => (
              <HubRow key={h.id} hub={h} />
            ))}
            {!loading && hubs.length === 0 && <ThemedText style={styles.rowMeta}>No other hubs listed yet.</ThemedText>}
          </View>
        )}
        </ScrollView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
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
  // Fixed, explicit height enforced from outside the ScrollView — a
  // horizontal ScrollView's own reported height isn't reliable everywhere
  // (it can collapse to near-zero on react-native-web), so this wrapper is
  // what actually reserves the row's space in the column layout.
  tabRowWrap: {
    paddingBottom: 12,
  
  },
  tabRow: {
    paddingHorizontal: 20,
    paddingVertical: 4,
    alignItems: 'center',
  
  },
  tabPill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    backgroundColor: '#8881',
  },
  tabLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 12,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  // Explicit flex:1 on both the wrapper and the ScrollView itself — same
  // "enforce the bound from outside" reasoning as tabRowWrap above, so this
  // region reliably fills exactly the remaining space and nothing more.
  listWrap: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabelSpaced: {
    marginTop: 16,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
    lineHeight: 17,
  },
  myPostsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginBottom: 14,
    backgroundColor: '#8881',
  },
  myPostsChipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  atlasStrip: {
    gap: 10,
  },
  atlasCard: {
    width: 140,
  },
  marketplaceStrip: {
    gap: 10,
  },
  marketplaceCard: {
    width: 180,
  },
  trendingStrip: {
    gap: 10,
  },
  trendingCard: {
    width: 180,
  },
  peopleStrip: {
    gap: 10,
  },
  hubsStrip: {
    gap: 10,
  },
  horizontalRowItem: {
    width: 220,
  },
  atlasGridCard: {
    width: '48%',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  memberText: {
    flex: 1,
    gap: 2,
  },
  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  hubIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  eventRow: {
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    gap: 2,
  },
  postMeta: {
    opacity: 0.5,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  viewMore: {
    paddingVertical: 14,
  },
  viewMoreLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
});
