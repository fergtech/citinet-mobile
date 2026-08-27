import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';
import { Image } from 'expo-image';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { EventAtlasLink } from '@/components/event-atlas-link';
import { FeaturedCarousel } from '@/components/featured-carousel';
import { HubMedia } from '@/components/hub-media';
import { ListingCard } from '@/components/marketplace/listing-card';
import { PostRow } from '@/components/post-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CustomIcon } from '@/components/ui/custom-icon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getFeatured,
  getInitiativeActivity,
  getPosts,
  getUpcomingEvents,
  initiativeBannerUrl,
  listAtlasPins,
  listFiles,
  listInitiatives,
  listMarketplaceListings,
  listMembers,
  toggleLike,
  toggleRsvp,
  votePoll,
} from '@/lib/api/hubService';
import {
  AtlasPin,
  FeaturedItem,
  HubFile,
  HubMember,
  HubPost,
  InitiativeActivityEntry,
  MarketplaceListing,
} from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { findNearestPanoramaxImage, type PanoramaxImage } from '@/lib/atlas/panoramax';
import { FILE_KIND_META, fileKind } from '@/lib/files/kind';
import { initiativeCategoryMeta, initiativeColor } from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';
import { formatEventWhen, isPastEvent } from '@/lib/ui/format-event';
import { applyVote } from '@/lib/ui/poll';
import { timeAgo } from '@/lib/ui/time-ago';

type InitiativeUpdateRow = {
  entry: InitiativeActivityEntry;
  initiativeId: string;
  initiativeTitle: string;
  // Carried alongside the activity entry so the row can render the same
  // category tile Discover's own InitiativeDiscoverRow uses — the entry
  // itself has no category/color/banner, only the parent Initiative does.
  initiativeCategory: string;
  initiativeColorName: string;
  // Real banner image wins over the category tile when the initiative
  // actually has one uploaded (banner_mode/banner_image_file_name are only
  // set together — see api/server.js's POST .../banner).
  hasBannerImage: boolean;
};

// There's no hub-wide "recent activity across all initiatives" endpoint —
// GET /api/initiatives/:id/activity is per-initiative (see hubService's
// getInitiativeActivity) — so this fetches the initiative list first, then
// each one's own small activity slice in parallel, and merges/ranks
// client-side. Fine for a hub's realistic initiative count; would need a
// real aggregate server route if that ever stopped being true.
//
// 'task'/'team'/'resource' are the only kinds this surfaces — matches the
// three components asked for (tasks, roles, resources); 'update' (a general
// wall post on the initiative, not tied to any of those three) and 'member'
// (declared in the DB's CHECK constraint but not emitted by any route yet)
// are deliberately excluded.
async function fetchInitiativeUpdates(tunnelUrl: string, token: string): Promise<InitiativeUpdateRow[]> {
  const initiatives = await listInitiatives(tunnelUrl, token).catch(() => []);
  const perInitiative = await Promise.all(
    initiatives.map((initiative) =>
      getInitiativeActivity(tunnelUrl, token, initiative.id, 3)
        .then((entries) =>
          entries.map((entry) => ({
            entry,
            initiativeId: initiative.id,
            initiativeTitle: initiative.title,
            initiativeCategory: initiative.category,
            initiativeColorName: initiative.color,
            hasBannerImage: initiative.banner_mode === 'image' && !!initiative.banner_image_file_name,
          }))
        )
        .catch(() => [] as InitiativeUpdateRow[])
    )
  );
  return perInitiative
    .flat()
    .filter((row) => row.entry.kind === 'task' || row.entry.kind === 'team' || row.entry.kind === 'resource')
    .sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime())
    .slice(0, 3);
}

// Each Home section is a bounded preview with a "View more" link to its own
// full screen, not an inline expand — keeps the dashboard glanceable and keeps
// later sections reachable no matter how much content an earlier one has.
//
// latitude/longitude are non-optional on AtlasPin — every pin already has a
// real, working location — so this always renders a genuine preview instead
// of a plain category-icon swatch, with the exact same priority as the pin
// detail screen's own banner: uploaded photo, else the nearest Panoramax
// street-view thumbnail, else a small live map centered on the pin.
function LatestAtlasRow({
  pin,
  meters,
  tunnelUrl,
  token,
}: {
  pin: AtlasPin;
  meters: number | null;
  tunnelUrl: string;
  token: string;
}) {
  const meta = ATLAS_CATEGORIES[pin.category];
  const [panoramax, setPanoramax] = useState<PanoramaxImage | null>(null);

  // Same "only checked when there's no uploaded photo" guard as pin detail —
  // a real photo the owner chose always wins, and most pins outside
  // Panoramax's coverage will simply resolve to null (the common case, not
  // an error), leaving the map fallback below in place.
  useEffect(() => {
    if (pin.image_file_name) return;
    let cancelled = false;
    findNearestPanoramaxImage(pin.latitude, pin.longitude).then((match) => {
      if (!cancelled && match) setPanoramax(match);
    });
    return () => {
      cancelled = true;
    };
  }, [pin.image_file_name, pin.latitude, pin.longitude]);

  return (
    <Pressable
      style={styles.atlasLatestRow}
      onPress={() => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } })}>
      <View style={styles.atlasLatestPreview}>
        {pin.image_file_name ? (
          <HubMedia fileName={pin.image_file_name} tunnelUrl={tunnelUrl} token={token} style={styles.atlasLatestPreviewMedia} />
        ) : panoramax ? (
          <>
            <Image source={{ uri: panoramax.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            {/* etalab-2.0 (Panoramax's imagery license) expects attribution
                on reuse — same requirement as the pin detail banner, just a
                smaller tag to fit this narrower box. No "explore" badge
                here: tapping this row already opens the full pin detail,
                which offers the real interactive street-view link. */}
            <View style={styles.atlasLatestPanoramaxCredit}>
              <ThemedText style={styles.atlasLatestPanoramaxCreditLabel} lightColor="#fff" darkColor="#fff">
                Panoramax
              </ThemedText>
            </View>
          </>
        ) : (
          <>
            <LeafletMap pins={[pin]} center={[pin.latitude, pin.longitude]} zoom={16} style={StyleSheet.absoluteFill} />
            {/* Decorative close-up, not interactive — same reasoning as the
                pin-detail banner's map fallback: this blocks touches from
                reaching the WebView so the row's own Pressable and the
                outer ScrollView's scroll gesture keep working instead of
                the map eating them. */}
            <View style={StyleSheet.absoluteFill} />
          </>
        )}
      </View>
      <View style={styles.atlasLatestContent}>
        <ThemedText type="defaultSemiBold" style={styles.atlasLatestTitle} numberOfLines={2}>
          {pin.title}
        </ThemedText>
        <ThemedText style={styles.atlasLatestMeta} numberOfLines={1}>
          {meta.label} · {timeAgo(pin.created_at)}
          {meters !== null ? ` · ${formatDistanceMiles(meters)}` : ''}
        </ThemedText>
        {!!pin.description?.trim() && (
          <ThemedText style={styles.atlasLatestDescription} numberOfLines={3}>
            {pin.description}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

// A compact preview, not the full PostRow — no icon (title carries enough
// weight on its own, matching Discussions' equally icon-less compactAuthor
// look), no media/RSVP-button/like-comment footer, since those (plus the old
// 6-line body cap PostRow itself uses) were what made this section so much
// taller than every other Home preview. Body still gets a preview, just
// capped shorter (4 lines) now that this isn't PostRow's shared cap. The one
// exception to "no icon" is EventAtlasLink, kept as-is (icon included) since
// it's a real, separately-actionable link to a place, not decoration.
function LatestEventRow({ event }: { event: HubPost }) {
  return (
    <Pressable
      style={styles.atlasLatestRow}
      onPress={() => router.push({ pathname: '/post/[id]', params: { id: event.id } })}>
      <View style={styles.atlasLatestContent}>
        <ThemedText type="defaultSemiBold" style={styles.atlasLatestTitle} numberOfLines={2}>
          {event.title ?? 'Event'}
        </ThemedText>
        <ThemedText style={styles.atlasLatestMeta} numberOfLines={1}>
          {event.event_date ? formatEventWhen(event.event_date) : 'Date TBA'}
          {event.rsvp_count > 0 ? ` · ${event.rsvp_count} going` : ''}
        </ThemedText>
        {!!event.body?.trim() && (
          <ThemedText style={styles.atlasLatestDescription} numberOfLines={4}>
            {event.body}
          </ThemedText>
        )}
        {!!event.event_location && (
          <EventAtlasLink location={event.event_location} eventTitle={event.title} eventId={event.id} />
        )}
      </View>
    </Pressable>
  );
}

// One of up to 3 latest files visible beyond just their owner — is_public
// (hub) or web_public (anyone with the link). Back to the compact 44px
// icon/thumb size the very first pass used (the 170-wide bleed-to-edge
// treatment was for a single-file preview; a 3-row list reads better small).
// Meta is now just "@uploader · Nh ago" — size/visibility dropped from the
// line entirely now that the row is this small.
function FileHomeRow({
  file,
  tunnelUrl,
  token,
  uploaderUsername,
}: {
  file: HubFile;
  tunnelUrl: string;
  token: string;
  uploaderUsername?: string;
}) {
  const kind = fileKind(file.file_name, file.mime_type);
  const meta = FILE_KIND_META[kind];
  // Only image/video can actually be rendered as a thumbnail (expo-image/expo-video
  // both need a real visual asset to decode) — everything else keeps the type icon.
  const hasPreview = kind === 'image' || kind === 'video';

  return (
    <Pressable
      style={styles.fileGridCard}
      onPress={() => router.push({ pathname: '/files/[id]', params: { id: file.file_id } })}>
      {hasPreview ? (
        <HubMedia fileName={file.file_name} tunnelUrl={tunnelUrl} token={token} previewSeconds={4} style={styles.fileLatestThumb} />
      ) : (
        <View style={[styles.fileLatestIcon, { backgroundColor: meta.color }]}>
          <IconSymbol name={meta.icon} size={18} color="#fff" />
        </View>
      )}
      <View style={styles.fileGridCardContent}>
        <ThemedText type="defaultSemiBold" style={styles.atlasLatestTitle} numberOfLines={1}>
          {file.file_name}
        </ThemedText>
        <ThemedText style={styles.atlasLatestMeta} numberOfLines={1}>
          {uploaderUsername ? `@${uploaderUsername} · ` : ''}
          {timeAgo(file.uploaded_at)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// The section's own trailing "See all files" row, rendered once below the
// (up to 3) FileHomeRow entries rather than duplicated inside each one.
function SeeAllFilesRow() {
  return (
    <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/files?tab=shared' as Href)}>
      <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
        <IconSymbol name="externaldrive.fill" size={18} color={Brand} />
      </View>
      <View style={styles.atlasLatestContent}>
        <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
          See all files
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();

  const hubCenter = useHubCenter();
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [events, setEvents] = useState<HubPost[]>([]);
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [initiativeUpdates, setInitiativeUpdates] = useState<InitiativeUpdateRow[]>([]);
  const [members, setMembers] = useState<Map<string, HubMember>>(new Map());
  // Dismissing a featured card only clears it for this session (plain component
  // state, never persisted) — it comes back next time the user signs in.
  const [dismissedFeaturedIds, setDismissedFeaturedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getPosts(session.hub.tunnelUrl, session.token),
      getUpcomingEvents(session.hub.tunnelUrl, session.token),
      getFeatured(session.hub.tunnelUrl, session.token),
      listAtlasPins(session.hub.tunnelUrl, session.token).catch(() => []),
      listFiles(session.hub.tunnelUrl, session.token).catch(() => []),
      // GET /api/marketplace/listings already returns newest-first (see
      // Discover's own recentListings comment), so the first entry is the
      // latest item added — no extra sort needed here.
      listMarketplaceListings(session.hub.tunnelUrl, session.token).catch(() => []),
      // Only needed to resolve the "Latest upload" row's uploader username —
      // catches the same way listAtlasPins/listFiles do, so a hub without
      // (or briefly unable to serve) a member list still loads everything
      // else instead of failing Home entirely.
      listMembers(session.hub.tunnelUrl, session.token).catch(() => []),
      fetchInitiativeUpdates(session.hub.tunnelUrl, session.token),
    ])
      .then(([nextPosts, nextEvents, nextFeatured, nextPins, nextFiles, nextListings, nextMembers, nextInitiativeUpdates]) => {
        setPosts(nextPosts);
        setEvents(nextEvents);
        setFeatured(nextFeatured);
        setAtlasPins(nextPins);
        setFiles(nextFiles);
        setListings(nextListings);
        setMembers(new Map(nextMembers.map((m) => [m.user_id, m])));
        setInitiativeUpdates(nextInitiativeUpdates);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  // Focus-based, not mount-only: a like/reply/save made on Post Detail, Feed,
  // Events, or Atlas doesn't touch Home's own state (each screen fetches its
  // own copy), so without this, coming back to Home kept showing whatever was
  // true when it first mounted until a manual pull-to-refresh. Every tab
  // screen in this app follows the same rule now — see Messages/Discover for
  // the same fix, and the project memory entry on this whole pass.
  useFocusEffect(load);

  // Re-tapping the Home tab while already on it scrolls back to the top.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // Only iOS's tab bar floats over content (see app/(tabs)/_layout.tsx) —
  // compensate so the last section doesn't end up hidden behind the glass.
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;

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

  function handleDismissFeatured(id: string) {
    setDismissedFeaturedIds((prev) => new Set(prev).add(id));
  }

  const nearestPins = useMemo(() => {
    return [...atlasPins]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [atlasPins]);

  const latestPin = nearestPins[0] ?? null;

  // Home only surfaces a file everyone (or anyone with the link) can actually
  // see — a private file only its owner can open would be a dead-end tease
  // for every other neighbor looking at Home. listFiles() already scopes the
  // response to "mine + is_public" (see hubService), so this only needs to
  // additionally require is_public/web_public to exclude the caller's own
  // still-private uploads.
  const latestPublicFiles = useMemo(() => {
    const visible = files.filter((f) => f.is_public || f.web_public);
    return [...visible].sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()).slice(0, 6);
  }, [files]);

  const latestListing = listings[0] ?? null;

  const latestPost = useMemo(
    () => [...posts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null,
    [posts]
  );

  const featuredEvent = useMemo(() => {
    const upcoming = events
      .filter((event) => event.event_date && !isPastEvent(event.event_date))
      .sort((a, b) => new Date(a.event_date!).getTime() - new Date(b.event_date!).getTime());
    if (upcoming.length > 0) return upcoming[0];

    const upcomingIds = new Set(events.map((event) => event.id));
    return posts
      .filter((post) => post.category === 'EVENT' && post.event_date && !upcomingIds.has(post.id))
      .sort((a, b) => new Date(b.event_date!).getTime() - new Date(a.event_date!).getTime())[0] ?? null;
  }, [events, posts]);

  function handleVotePoll(post: HubPost, optionIndex: number) {
    if (!session) return;
    const previousPoll = post.poll;
    setPosts((prev) => prev.map((item) => (item.id === post.id ? applyVote(item, optionIndex) : item)));
    votePoll(session.hub.tunnelUrl, session.token, post.id, optionIndex).catch(() => {
      setPosts((prev) => prev.map((item) => (item.id === post.id ? { ...item, poll: previousPoll } : item)));
    });
  }

  // featuredEvent is derived (useMemo) from posts/events, not its own state
  // — updating both source lists here is what makes the memo recompute with
  // the new my_rsvp/rsvp_count, same "apply everywhere it could be" pattern
  // app/events.tsx uses for its own upcoming/past split.
  function handleToggleRsvp(event: HubPost) {
    if (!session) return;
    const wasGoing = event.my_rsvp;
    const apply = (list: HubPost[]) =>
      list.map((e) => (e.id === event.id ? { ...e, my_rsvp: !wasGoing, rsvp_count: e.rsvp_count + (wasGoing ? -1 : 1) } : e));
    setPosts(apply);
    setEvents(apply);
    toggleRsvp(session.hub.tunnelUrl, session.token, event.id).catch(() => {
      const rollback = (list: HubPost[]) =>
        list.map((e) => (e.id === event.id ? { ...e, my_rsvp: wasGoing, rsvp_count: event.rsvp_count } : e));
      setPosts(rollback);
      setEvents(rollback);
    });
  }

  if (!session) return null;

  const visibleFeatured = featured.filter((item) => !dismissedFeaturedIds.has(item.id));

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle} numberOfLines={1}>
          {session.hub.name}
        </ThemedText>
        {/* Pulled off the tab bar — that slot now shows notifications
            instead (see app/(tabs)/_layout.tsx) — same CustomIcon "search"
            vector this button used to render there, just relocated. */}
        <Pressable onPress={() => router.push('/discover')} hitSlop={12} accessibilityLabel="Search" accessibilityRole="button">
          <CustomIcon size={24} name="search" color={Colors[colorScheme].text} />
        </Pressable>
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 24 + extraBottomInset }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <FeaturedCarousel
          items={visibleFeatured}
          tunnelUrl={session.hub.tunnelUrl}
          token={session.token}
          onDismiss={handleDismissFeatured}
        />

        {featuredEvent && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Events</ThemedText>
            <LatestEventRow event={featuredEvent} />
            <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/events')}>
              <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
                <IconSymbol name="calendar" size={18} color={Brand} />
              </View>
              <View style={styles.atlasLatestContent}>
                <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                  See all events
                </ThemedText>
              </View>
            </Pressable>
          </View>
        )}

        {latestPin && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>From the Atlas</ThemedText>
            <LatestAtlasRow
              pin={latestPin}
              meters={hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], latestPin.latitude, latestPin.longitude) : null}
              tunnelUrl={session.hub.tunnelUrl}
              token={session.token}
            />
            {/* Trailing "See all" row instead of the header link — same
                concept as Discover's in-list "See all" cards/rows, just a
                single row here since this section only ever previews one
                pin (no real list to append to). */}
            <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/atlas' as Href)}>
              <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
                <IconSymbol name="chevron.right" size={18} color={Brand} />
              </View>
              <View style={styles.atlasLatestContent}>
                <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                  See all Atlas pins
                </ThemedText>
              </View>
            </Pressable>
          </View>
        )}

        {latestPublicFiles.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Latest uploads to {session.hub.name}</ThemedText>
            <View style={styles.fileGrid}>
              {latestPublicFiles.map((file) => (
                <FileHomeRow
                  key={file.file_id}
                  file={file}
                  tunnelUrl={session.hub.tunnelUrl}
                  token={session.token}
                  uploaderUsername={members.get(file.owner_id)?.username}
                />
              ))}
            </View>
            <SeeAllFilesRow />
          </View>
        )}

        {latestListing && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Marketplace</ThemedText>
            <ListingCard
              listing={latestListing}
              tunnelUrl={session.hub.tunnelUrl}
              token={session.token}
              onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: latestListing.id } })}
              style={styles.marketplaceFeatureCard}
              imageAspectRatio={1}
            />
            <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/marketplace' as Href)}>
              <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
                <IconSymbol name="storefront.fill" size={18} color={Brand} />
              </View>
              <View style={styles.atlasLatestContent}>
                <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                  See all marketplace
                </ThemedText>
              </View>
            </Pressable>
          </View>
        )}

        {initiativeUpdates.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Initiatives</ThemedText>
            {initiativeUpdates.map(({ entry, initiativeId, initiativeTitle, initiativeCategory, initiativeColorName, hasBannerImage }) => {
              const category = initiativeCategoryMeta(initiativeCategory);
              const color = initiativeColor(initiativeColorName);
              return (
                <Pressable
                  key={entry.id}
                  style={styles.atlasLatestRow}
                  onPress={() => router.push({ pathname: '/initiatives/[id]', params: { id: initiativeId } })}>
                  {hasBannerImage ? (
                    // A real uploaded banner (see api/server.js's
                    // GET/POST .../:id/banner) wins over the category tile —
                    // 113px/1:1, same scale/radius as the tile it replaces.
                    <Image
                      source={{ uri: initiativeBannerUrl(session.hub.tunnelUrl, initiativeId) }}
                      style={styles.initiativeTile}
                      contentFit="cover"
                    />
                  ) : (
                    // No banner uploaded — falls back to Discover's own
                    // InitiativeDiscoverRow tile treatment, at the same
                    // standard 44px "no photo" icon size fileLatestIcon
                    // already establishes elsewhere on this screen.
                    <View style={[styles.fileLatestIcon, { backgroundColor: color }]}>
                      <IconSymbol name={category.icon} size={18} color="#fff" />
                    </View>
                  )}
                  <View style={styles.atlasLatestContent}>
                    <ThemedText type="defaultSemiBold" style={styles.atlasLatestTitle} numberOfLines={2}>
                      {entry.text}
                    </ThemedText>
                    <ThemedText style={styles.atlasLatestMeta} numberOfLines={1}>
                      {initiativeTitle} · {timeAgo(entry.created_at)}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
            <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/initiatives' as Href)}>
              <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
                <IconSymbol name="target" size={18} color={Brand} />
              </View>
              <View style={styles.atlasLatestContent}>
                <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                  See all initiatives
                </ThemedText>
              </View>
            </Pressable>
          </View>
        )}

        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel}>Discussions</ThemedText>
          {latestPost && (
            <PostRow
              post={latestPost}
              tunnelUrl={session.hub.tunnelUrl}
              token={session.token}
              onToggleLike={handleToggleLike}
              onVotePoll={handleVotePoll}
              onToggleRsvp={handleToggleRsvp}
              compactAuthor
            />
          )}
          {!loading && posts.length === 0 && <ThemedText style={styles.rowMeta}>No posts yet.</ThemedText>}
          {posts.length > 1 && (
            <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/feed')}>
              <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
                <IconSymbol name="message.fill" size={18} color={Brand} />
              </View>
              <View style={styles.atlasLatestContent}>
                <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                  See all discussions
                </ThemedText>
              </View>
            </Pressable>
          )}
        </View>

      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  // The one separator per section now — sits directly above that section's
  // own trailing "See all X" row (between the real content and the nav
  // link), not at the section's outer boundary. Combine with
  // atlasLatestRow on each trailing link (e.g. `[styles.atlasLatestRow,
  // styles.trailingSeparator]`) rather than section-level, so a section
  // with no trailing link (nothing to see more of) shows no line at all.
  trailingSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  atlasLatestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 14,
    // Hairline top/bottom separators removed for now (product ask, to see
    // how the section reads without them) — was borderTopWidth/
    // borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8884'.
  },
  atlasLatestIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atlasLatestThumb: {
    width: 38,
    height: 38,
    aspectRatio: undefined,
    borderRadius: 11,
  },
  // Wider than the plain 38px category-icon swatch above — this is a real
  // preview (photo or live map), not a decorative glyph, so it earns more
  // room. Started at 170, narrowed to 2/3 of that per product ask.
  atlasLatestPreview: {
    width: 113,
    height: 110,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#8882',
    // Bleeds flush to atlasLatestRow's own top/bottom/left edges, same
    // treatment (and same reasoning) as fileLatestThumb/fileLatestIcon.
    marginTop: -14,
    marginBottom: -14,
    marginLeft: -20,
  },
  atlasLatestPreviewMedia: {
    width: '100%',
    height: '100%',
    aspectRatio: undefined,
    borderRadius: 0,
  },
  fileLatestThumb: {
    width: 44,
    height: 44,
    aspectRatio: undefined,
    borderRadius: 12,
  },
  fileLatestIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atlasLatestPanoramaxCredit: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  atlasLatestPanoramaxCreditLabel: {
    fontSize: 9,
    fontWeight: '600',
  },
  atlasLatestContent: {
    flex: 1,
    gap: 4,
  },
  atlasLatestTitle: {
    fontSize: 16,
    lineHeight: 21,
  },
  atlasLatestMeta: {
    opacity: 0.6,
    fontSize: 12.5,
  },
  atlasLatestDescription: {
    fontSize: 14,
    lineHeight: 19,
    opacity: 0.8,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
  // 2 columns, up to 6 files (3 rows) — same idea as atlasLatestRow's list
  // layout, just wrapped instead of stacked, so each card gets its own
  // (non-bleeding) style rather than reusing the full-width row.
  fileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  fileGridCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileGridCardContent: {
    flex: 1,
    gap: 4,
  },
  // ListingCard is normally a fixed-width strip card with rounded corners
  // (Discover's own marketplaceCard is 180px) — this cancels the section's
  // 20px padding on both sides (same trick as atlasLatestPreview/
  // fileLatestThumb) so the single showcased item bleeds flush to the
  // screen edges, and overrides ListingCard's own borderRadius: 14 to sharp
  // corners, matching the other Home visuals.
  marketplaceFeatureCard: {
    marginHorizontal: -20,
    borderRadius: 0,
  },
  // Same idea as Discover's own InitiativeDiscoverRow tile (colored swatch +
  // category icon), just scaled way up — 113px/1:1 per product ask, with a
  // rounded radius proportional to that size rather than Discover's 10 (its
  // tile is only 36px there).
  initiativeTile: {
    width: 113,
    height: 113,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
