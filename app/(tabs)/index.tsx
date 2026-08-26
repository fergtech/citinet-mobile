import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';

import { EventAtlasLink } from '@/components/event-atlas-link';
import { FeaturedCarousel } from '@/components/featured-carousel';
import { fileVisibilityMeta } from '@/components/files/file-row';
import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PostRow } from '@/components/post-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/theme';
import { getFeatured, getPosts, getUpcomingEvents, listAtlasPins, listFiles, toggleLike, toggleRsvp, votePoll } from '@/lib/api/hubService';
import { AtlasPin, FeaturedItem, HubFile, HubPost } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';
import { formatEventWhen, isPastEvent } from '@/lib/ui/format-event';
import { applyVote } from '@/lib/ui/poll';
import { timeAgo } from '@/lib/ui/time-ago';

// Each Home section is a bounded preview with a "View more" link to its own
// full screen, not an inline expand — keeps the dashboard glanceable and keeps
// later sections reachable no matter how much content an earlier one has.
function LatestAtlasRow({ pin, meters }: { pin: AtlasPin; meters: number | null }) {
  const meta = ATLAS_CATEGORIES[pin.category];

  return (
    <Pressable
      style={styles.atlasLatestRow}
      onPress={() => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } })}>
      <View style={[styles.atlasLatestIcon, { backgroundColor: meta.color }]}>
        <IconSymbol name={meta.icon} size={20} color="#fff" />
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

// The latest file visible beyond just its owner — is_public (hub) or
// web_public (anyone with the link) — same shape as LatestAtlasRow, with a
// matching trailing "See all" row underneath rather than a same-line chip.
function FileHomeRow({ file, tunnelUrl, token }: { file: HubFile; tunnelUrl: string; token: string }) {
  const kind = fileKind(file.file_name, file.mime_type);
  const meta = FILE_KIND_META[kind];
  const vis = fileVisibilityMeta(file);
  // Only image/video can actually be rendered as a thumbnail (expo-image/expo-video
  // both need a real visual asset to decode) — everything else keeps the type icon.
  const hasPreview = kind === 'image' || kind === 'video';

  return (
    <>
      <Pressable
        style={styles.atlasLatestRow}
        onPress={() => router.push({ pathname: '/files/[id]', params: { id: file.file_id } })}>
        {hasPreview ? (
          <HubMedia
            fileName={file.file_name}
            tunnelUrl={tunnelUrl}
            token={token}
            previewSeconds={4}
            style={styles.atlasLatestThumb}
          />
        ) : (
          <View style={[styles.atlasLatestIcon, { backgroundColor: meta.color }]}>
            <IconSymbol name={meta.icon} size={20} color="#fff" />
          </View>
        )}
        <View style={styles.atlasLatestContent}>
          <ThemedText type="defaultSemiBold" style={styles.atlasLatestTitle} numberOfLines={1}>
            {file.file_name}
          </ThemedText>
          <ThemedText style={styles.atlasLatestMeta} numberOfLines={1}>
            {vis.label} · {formatBytes(file.size_bytes)} · {timeAgo(file.uploaded_at)}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable style={styles.atlasLatestRow} onPress={() => router.push('/files?tab=shared' as Href)}>
        <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
          <IconSymbol name="externaldrive.fill" size={18} color={Brand} />
        </View>
        <View style={styles.atlasLatestContent}>
          <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
            See all files
          </ThemedText>
        </View>
      </Pressable>
    </>
  );
}

export default function HomeScreen() {
  const { session } = useSession();

  const hubCenter = useHubCenter();
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [events, setEvents] = useState<HubPost[]>([]);
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [files, setFiles] = useState<HubFile[]>([]);
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
    ])
      .then(([nextPosts, nextEvents, nextFeatured, nextPins, nextFiles]) => {
        setPosts(nextPosts);
        setEvents(nextEvents);
        setFeatured(nextFeatured);
        setAtlasPins(nextPins);
        setFiles(nextFiles);
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
  const latestPublicFile = useMemo(() => {
    const visible = files.filter((f) => f.is_public || f.web_public);
    return [...visible].sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0] ?? null;
  }, [files]);

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
        <ThemedText type="title" style={styles.headerTitle}>
          {session.hub.name}
        </ThemedText>
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
            <Pressable style={styles.atlasLatestRow} onPress={() => router.push('/events')}>
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
            />
            {/* Trailing "See all" row instead of the header link — same
                concept as Discover's in-list "See all" cards/rows, just a
                single row here since this section only ever previews one
                pin (no real list to append to). */}
            <Pressable style={styles.atlasLatestRow} onPress={() => router.push('/atlas' as Href)}>
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

        {latestPublicFile && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Latest upload to {session.hub.name}</ThemedText>
            <FileHomeRow file={latestPublicFile} tunnelUrl={session.hub.tunnelUrl} token={session.token} />
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
            <Pressable style={styles.atlasLatestRow} onPress={() => router.push('/feed')}>
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
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  headerTitle: {
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
});
