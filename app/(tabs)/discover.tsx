import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
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
import { getPosts, getUpcomingEvents, initiativeBannerUrl, listAtlasPins, listFiles, listInitiatives, listMarketplaceListings, listMembers, search, toggleLike } from '@/lib/api/hubService';
import { getHubs } from '@/lib/api/registryService';
import { AtlasPin, HubFile, HubMember, HubPost, Initiative, MarketplaceListing, RegistryHub, SearchResults } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { useStarredFiles } from '@/lib/files/starred-files';
import { initiativeCategoryMeta, initiativeCategoryPresetImage, initiativeColor, initiativeStatusMeta, initiativeTaskCounts } from '@/lib/initiatives/meta';
import { categoryMeta } from '@/lib/marketplace/categories';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';

type TabId = 'all' | 'posts' | 'events' | 'atlas' | 'marketplace' | 'initiatives' | 'files' | 'people' | 'hubs';

// Same order as the sections appear in the "All" tab below, so the pill row
// reads as a direct index into it — every section shown there has its own
// dedicated filter here now (previously Atlas/Marketplace/Initiatives/Files
// were shown in "All" with no way to filter down to just one of them).
const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'posts', label: 'Posts' },
  { id: 'events', label: 'Events' },
  { id: 'atlas', label: 'Atlas' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'initiatives', label: 'Initiatives' },
  { id: 'files', label: 'Files' },
  { id: 'people', label: 'People' },
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

function InitiativeDiscoverRow({ initiative }: { initiative: Initiative }) {
  const { session } = useSession();
  const category = initiativeCategoryMeta(initiative.category);
  const status = initiativeStatusMeta(initiative.status);
  const color = initiativeColor(initiative.color);
  const counts = initiativeTaskCounts(initiative);
  const hasBannerImage = initiative.banner_mode === 'image' && !!initiative.banner_image_file_name;
  const presetImage = initiativeCategoryPresetImage(initiative.category);
  return (
    <Pressable
      style={styles.initiativeRow}
      // `as Href` — app/initiatives/[id].tsx doesn't exist yet; drop the cast
      // once the detail screen is built.
      onPress={() => router.push({ pathname: '/initiatives/[id]', params: { id: initiative.id } } as Href)}>
      <View style={[styles.initiativeTile, { backgroundColor: color }]}>
        {hasBannerImage && session ? (
          <Image source={{ uri: initiativeBannerUrl(session.hub.tunnelUrl, initiative.id) }} style={styles.initiativeTileImage} contentFit="cover" />
        ) : presetImage ? (
          <Image source={presetImage} style={styles.initiativeTileImage} contentFit="cover" />
        ) : (
          <IconSymbol name={category.icon} size={16} color="#fff" />
        )}
      </View>
      <View style={styles.memberText}>
        <View style={styles.initiativeStatusLine}>
          <View style={[styles.initiativeStatusDot, { backgroundColor: status.color }]} />
          <ThemedText style={[styles.initiativeStatusLabel, { color: status.color }]}>{status.label}</ThemedText>
        </View>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {initiative.title}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.rowMeta}>
          {counts.done} of {counts.total} tasks done
        </ThemedText>
      </View>
    </Pressable>
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
  // Files gets its own FlatList (see listWrap below) instead of sharing the
  // ScrollView every other tab renders inside of, so it can actually
  // virtualize -- a plain .map() inside a ScrollView mounts every row at
  // once regardless of scroll position, which meant every image/video row's
  // HubMedia fired its own POST /api/files/:name/token the instant the tab
  // rendered (dozens of simultaneous requests on a file-heavy hub, tripping
  // the server's rate limiter). FlatList only mounts what's near the
  // viewport, so requests spread out as the user actually scrolls instead.
  const filesListRef = useRef<FlatList>(null);
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
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return navigation.addListener('tabPress', (event) => {
      if (!navigation.isFocused()) return;
      event.preventDefault();
      if (scrollOffset.current > 0) {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        filesListRef.current?.scrollToOffset({ offset: 0, animated: true });
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
      listInitiatives(session.hub.tunnelUrl, session.token).catch(() => []),
    ])
      .then(([nextPosts, nextMembers, nextEvents, nextHubs, nextPins, nextListings, nextFiles, nextInitiatives]) => {
        setPosts([...nextPosts].sort(byEngagement));
        setMembers(nextMembers.filter((m) => m.user_id !== session.userId));
        setEvents(nextEvents);
        setHubs(nextHubs.filter((h) => h.slug !== session.hub.slug));
        setAtlasPins(nextPins);
        setListings(nextListings);
        setFiles(nextFiles);
        setInitiatives(nextInitiatives);
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

  // listFiles() is scoped server-side to "mine + is_public" (see hubService)
  // — right for the Files screen itself (a personal file manager: you want
  // to see your own files, private ones included), but Discover is a
  // browsing/discovery surface, not "my stuff" — narrowed further here to
  // is_public only, which covers both the 'hub' and 'web' visibility tiers
  // (server derives is_public = visibility !== 'private', web_public =
  // visibility === 'web' — see api/server.js's PATCH /api/files/:filename),
  // excluding just the viewer's own private files that listFiles() mixes in.
  const publicFiles = useMemo(() => files.filter((f) => f.is_public), [files]);

  // Most recently uploaded first, from the public-only set above.
  const recentFiles = useMemo(
    () => [...publicFiles].sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()).slice(0, PREVIEW_COUNT),
    [publicFiles]
  );

  // Most recently updated first — most likely to have fresh activity worth
  // surfacing, same "here's what you might have missed" framing as the
  // other previews above.
  const recentInitiatives = useMemo(
    () => [...initiatives].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, PREVIEW_COUNT),
    [initiatives]
  );

  // Same gap as Atlas pins/listings: GET /api/search has no notion of files
  // either (confirmed in api/server.js), so this filters the files already
  // loaded for the "All" tab's preview — same 2-char threshold.
  const matchingFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return publicFiles.filter((f) => f.file_name.toLowerCase().includes(q));
  }, [publicFiles, query]);

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
        {activeTab === 'files' && !isSearching ? (
          <FlatList
            ref={filesListRef}
            data={publicFiles}
            keyExtractor={(file) => file.file_id}
            renderItem={({ item }) => (
              <FileRow
                file={item}
                starred={isStarred(item.file_id)}
                tunnelUrl={session.hub.tunnelUrl}
                token={session.token}
                onPress={() => router.push({ pathname: '/files/[id]', params: { id: item.file_id } })}
                onToggleStar={() => toggleStarred(item.file_id)}
              />
            )}
            style={styles.list}
            contentContainerStyle={[styles.section, { paddingBottom: 24 + extraBottomInset }]}
            onScroll={(event) => {
              scrollOffset.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            ListEmptyComponent={
              !loading ? <ThemedText style={styles.rowMeta}>No files in the hub yet.</ThemedText> : null
            }
          />
        ) : (
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
                  <Pressable
                    key={s.id}
                    style={styles.hubRow}
                    onPress={() => router.push({ pathname: '/spaces/[slug]', params: { slug: s.slug } })}>
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
                  </Pressable>
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
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
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
                {/* Hidden — superseded by the trailing "See all" card. */}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.edgeToEdgeScroll}
                contentContainerStyle={styles.trendingStrip}>
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
                {posts.length > PREVIEW_COUNT && (
                  <Pressable style={[styles.trendingCard, styles.seeAllCard]} onPress={() => setActiveTab('posts')}>
                    <View style={styles.seeAllIcon}>
                      <IconSymbol name="chevron.right" size={18} color={Brand} />
                    </View>
                    <ThemedText type="defaultSemiBold" style={[styles.seeAllLabel, { color: Brand }]}>
                      See all
                    </ThemedText>
                    <ThemedText style={styles.rowMeta}>{posts.length} posts</ThemedText>
                  </Pressable>
                )}
              </ScrollView>
              {!loading && posts.length === 0 && <ThemedText style={styles.rowMeta}>No posts yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Events</ThemedText>
                {/* Hidden — superseded by the trailing "See all" row below. */}
              </View>
              {events.slice(0, PREVIEW_COUNT).map((e) => (
                <EventRow key={e.id} event={e} tint={tint} />
              ))}
              {!loading && events.length === 0 && <ThemedText style={styles.rowMeta}>No upcoming events.</ThemedText>}
              {/* Unlike every sibling section's trailing card (only shown past
                  PREVIEW_COUNT, purely for pagination), this one is always
                  visible — this section only ever loads *upcoming* events
                  (getUpcomingEvents), so an empty/short list here doesn't mean
                  there's nothing to see, past events can still exist. Routes
                  to the real standalone Events screen (Upcoming/Past tabs),
                  not Discover's own same-data "Events" browse tab, since
                  that's the only place past events are actually derivable. */}
              <Pressable style={styles.seeAllRow} onPress={() => router.push('/events')}>
                <View style={styles.seeAllRowIcon}>
                  <IconSymbol name="calendar" size={16} color={Brand} />
                </View>
                <ThemedText type="defaultSemiBold" style={[styles.seeAllRowLabel, { color: Brand }]}>
                  See all events
                </ThemedText>
                <IconSymbol name="chevron.right" size={16} color={Brand} />
              </Pressable>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Atlas</ThemedText>
                {/* Hidden — superseded by the trailing "See all" card at the
                    end of the strip below, same destination/condition. */}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.edgeToEdgeScroll}
                contentContainerStyle={styles.atlasStrip}>
                {nearestAtlasPins.map((pin) => (
                  <AtlasPinCard
                    key={pin.id}
                    pin={pin}
                    meters={hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], pin.latitude, pin.longitude) : null}
                    onPress={() => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } })}
                    style={styles.atlasCard}
                  />
                ))}
                {/* Experiment: an in-list "See all" card instead of only the
                    header's link — same destination/condition as that link,
                    just reachable by scrolling to the end of the strip too. */}
                {atlasPins.length > PREVIEW_COUNT && (
                  <Pressable style={[styles.atlasCard, styles.seeAllCard]} onPress={() => router.push('/atlas' as Href)}>
                    <View style={styles.seeAllIcon}>
                      <IconSymbol name="chevron.right" size={18} color={Brand} />
                    </View>
                    <ThemedText type="defaultSemiBold" style={[styles.seeAllLabel, { color: Brand }]}>
                      See all
                    </ThemedText>
                    <ThemedText style={styles.rowMeta}>{atlasPins.length} pins</ThemedText>
                  </Pressable>
                )}
              </ScrollView>
              {!loading && atlasPins.length === 0 && <ThemedText style={styles.rowMeta}>No pins yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Marketplace</ThemedText>
                {/* Hidden — superseded by the trailing "See all" card. */}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.edgeToEdgeScroll}
                contentContainerStyle={styles.marketplaceStrip}>
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
                {listings.length > PREVIEW_COUNT && (
                  <Pressable style={[styles.marketplaceCard, styles.seeAllCard]} onPress={() => router.push('/marketplace' as Href)}>
                    <View style={styles.seeAllIcon}>
                      <IconSymbol name="chevron.right" size={18} color={Brand} />
                    </View>
                    <ThemedText type="defaultSemiBold" style={[styles.seeAllLabel, { color: Brand }]}>
                      See all
                    </ThemedText>
                    <ThemedText style={styles.rowMeta}>{listings.length} listings</ThemedText>
                  </Pressable>
                )}
              </ScrollView>
              {!loading && listings.length === 0 && <ThemedText style={styles.rowMeta}>Nothing listed yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Initiatives</ThemedText>
                {/* Hidden — superseded by the trailing "See all" row. */}
              </View>
              {recentInitiatives.map((initiative) => (
                <InitiativeDiscoverRow key={initiative.id} initiative={initiative} />
              ))}
              {!loading && initiatives.length === 0 && <ThemedText style={styles.rowMeta}>No initiatives yet — anyone in the hub can start one.</ThemedText>}
              {/* Unlike every sibling section's trailing row (only shown past
                  PREVIEW_COUNT, purely for pagination), this one is always
                  visible — the list screen is currently the only way to reach
                  Initiatives at all (no Home card or Space chip yet), and it
                  adds real functionality (status/category filters) worth
                  reaching even with a handful of initiatives. */}
              <Pressable style={styles.seeAllRow} onPress={() => router.push('/initiatives' as Href)}>
                <View style={styles.seeAllRowIcon}>
                  <IconSymbol name="target" size={16} color={Brand} />
                </View>
                <ThemedText type="defaultSemiBold" style={[styles.seeAllRowLabel, { color: Brand }]}>
                  See all initiatives
                </ThemedText>
                <IconSymbol name="chevron.right" size={16} color={Brand} />
              </Pressable>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Files</ThemedText>
                {/* Hidden — superseded by the trailing "See all" row. */}
              </View>
              {recentFiles.map((file) => (
                <FileRow
                  key={file.file_id}
                  file={file}
                  starred={isStarred(file.file_id)}
                  tunnelUrl={session.hub.tunnelUrl}
                  token={session.token}
                  onPress={() => router.push({ pathname: '/files/[id]', params: { id: file.file_id } })}
                  onToggleStar={() => toggleStarred(file.file_id)}
                />
              ))}
              {!loading && publicFiles.length === 0 && <ThemedText style={styles.rowMeta}>No files in the hub yet.</ThemedText>}
              {publicFiles.length > PREVIEW_COUNT && (
                <Pressable style={styles.seeAllRow} onPress={() => router.push('/files' as Href)}>
                  <View style={styles.seeAllRowIcon}>
                    <IconSymbol name="externaldrive.fill" size={16} color={Brand} />
                  </View>
                  <ThemedText type="defaultSemiBold" style={[styles.seeAllRowLabel, { color: Brand }]}>
                    See all files
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={16} color={Brand} />
                </Pressable>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>People</ThemedText>
                {/* Hidden — superseded by the trailing "See all" card. */}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.edgeToEdgeScroll}
                contentContainerStyle={styles.peopleStrip}>
                {members.slice(0, PREVIEW_COUNT).map((m) => (
                  <View key={m.user_id} style={styles.horizontalRowItem}>
                    <MemberRow member={m} tunnelUrl={session.hub.tunnelUrl} />
                  </View>
                ))}
                {members.length > PREVIEW_COUNT && (
                  <View style={styles.horizontalRowItem}>
                    <Pressable style={styles.memberRow} onPress={() => setActiveTab('people')}>
                      <View style={styles.seeAllRowIcon}>
                        <IconSymbol name="chevron.right" size={16} color={Brand} />
                      </View>
                      <View style={styles.memberText}>
                        <ThemedText type="defaultSemiBold" style={{ color: Brand }}>
                          See all
                        </ThemedText>
                        <ThemedText numberOfLines={1} style={styles.rowMeta}>
                          {members.length} neighbors
                        </ThemedText>
                      </View>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
              {!loading && members.length === 0 && <ThemedText style={styles.rowMeta}>No other neighbors yet.</ThemedText>}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText style={styles.sectionLabel}>Other hubs</ThemedText>
                {/* Hidden — superseded by the trailing "See all" card. */}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.edgeToEdgeScroll}
                contentContainerStyle={styles.hubsStrip}>
                {hubs.slice(0, PREVIEW_COUNT).map((h) => (
                  <View key={h.id} style={styles.horizontalRowItem}>
                    <HubRow hub={h} />
                  </View>
                ))}
                {hubs.length > PREVIEW_COUNT && (
                  <View style={styles.horizontalRowItem}>
                    <Pressable style={styles.hubRow} onPress={() => setActiveTab('hubs')}>
                      <View style={styles.seeAllRowIcon}>
                        <IconSymbol name="chevron.right" size={16} color={Brand} />
                      </View>
                      <View style={styles.memberText}>
                        <ThemedText type="defaultSemiBold" style={{ color: Brand }}>
                          See all
                        </ThemedText>
                        <ThemedText numberOfLines={1} style={styles.rowMeta}>
                          {hubs.length} hubs
                        </ThemedText>
                      </View>
                    </Pressable>
                  </View>
                )}
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
        ) : activeTab === 'atlas' ? (
          <View style={styles.section}>
            {atlasPins.map((pin) => {
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
            {!loading && atlasPins.length === 0 && <ThemedText style={styles.rowMeta}>No pins yet.</ThemedText>}
          </View>
        ) : activeTab === 'marketplace' ? (
          <View style={styles.section}>
            <View style={styles.grid}>
              {listings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  tunnelUrl={session.hub.tunnelUrl}
                  token={session.token}
                  onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })}
                  style={styles.marketplaceGridCard}
                />
              ))}
            </View>
            {!loading && listings.length === 0 && <ThemedText style={styles.rowMeta}>Nothing listed yet.</ThemedText>}
          </View>
        ) : activeTab === 'initiatives' ? (
          <View style={styles.section}>
            {initiatives.map((initiative) => (
              <InitiativeDiscoverRow key={initiative.id} initiative={initiative} />
            ))}
            {!loading && initiatives.length === 0 && (
              <ThemedText style={styles.rowMeta}>No initiatives yet — anyone in the hub can start one.</ThemedText>
            )}
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
        )}
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
  // Cancels the parent section's 20px padding so the strip's own scrollable
  // bounds run edge-to-edge (draggable from the screen edge) while the
  // header above it keeps its padding — contentContainerStyle below adds the
  // same 20px back as content padding, so the cards still start/end level
  // with the header instead of touching the screen edge themselves.
  // Cancels the parent section's 20px padding so a horizontal strip's cards
  // run flush against the screen edges (both visually and as scroll bounds)
  // while the header above it keeps its own padding. Shared by every
  // horizontal strip section.
  edgeToEdgeScroll: {
    marginHorizontal: -20,
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
  // ListingCard has no default width of its own (unlike PostGridCard's
  // baked-in 48%) since it's normally sized by whatever strip/grid it's
  // dropped into (see the fixed-width marketplaceCard used for the
  // horizontal "All" strip) -- this is that same 2-column sizing for the
  // Marketplace tab's full vertical grid instead.
  marketplaceGridCard: {
    width: '48%',
  },
  atlasStrip: {
    gap: 10,
  },
  atlasCard: {
    width: 140,
  },
  // Matches AtlasPinCard's own card shell (padding/radius/gap) since this
  // Pressable isn't going through that component — just centered and tinted
  // with Brand instead of a category color, to read as an action, not a pin.
  seeAllCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: Brand + '14',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeAllIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Brand + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeAllLabel: {
    fontSize: 13.5,
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
  initiativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  initiativeTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  initiativeTileImage: {
    ...StyleSheet.absoluteFillObject,
  },
  initiativeStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 1,
  },
  initiativeStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  initiativeStatusLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Vertical-list counterpart to seeAllCard — same Brand tint/icon-badge
  // language, laid out as a normal disclosure row instead of a card.
  seeAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    marginTop: 2,
  },
  seeAllRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Brand + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeAllRowLabel: {
    flex: 1,
    fontSize: 14.5,
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
