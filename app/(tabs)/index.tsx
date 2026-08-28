import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';
import { Image } from 'expo-image';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { EventAtlasLink } from '@/components/event-atlas-link';
import { FeaturedCarousel } from '@/components/featured-carousel';
import { HubInfoModal } from '@/components/hub-info-modal';
import { HubMedia } from '@/components/hub-media';
import { InitiativeUpdateCard, type InitiativeUpdateRow } from '@/components/initiative-update-card';
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
  getInitiative,
  getInitiativeActivity,
  getPosts,
  getUpcomingEvents,
  listAtlasPins,
  listFiles,
  listInitiativeResources,
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
  InitiativeResource,
  InitiativeTaskSummary,
  MarketplaceListing,
} from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { findNearestPanoramaxImage, type PanoramaxImage } from '@/lib/atlas/panoramax';
import { FILE_KIND_META, fileKind } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';
import { formatEventWhen, isPastEvent } from '@/lib/ui/format-event';
import { isLocalConnection } from '@/lib/ui/is-local-connection';
import { applyVote } from '@/lib/ui/poll';
import { timeAgo } from '@/lib/ui/time-ago';

// InitiativeUpdateRow now lives in components/initiative-update-card.tsx,
// the card that renders it — this just builds the array.

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
  const candidates = perInitiative
    .flat()
    .filter((row) => row.entry.kind === 'task' || row.entry.kind === 'team' || row.entry.kind === 'resource')
    .sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime());

  // The activity feed is an immutable log, not a live status snapshot —
  // "Completed X" and "marked X as provided" rows stay exactly as written
  // even after the task gets reopened or the pledge gets undone. Checked
  // every task/resource mutation in this file: updateTaskStatus logs a
  // "completed <title>" row only when status flips to 'done' (nothing logs
  // one for reopening), and provideResource is the only resource mutation
  // that appears to log anything (nothing logs an "unprovided" row either).
  // So a 'task' row is only ever about completion, and a 'resource' row is
  // only ever about being provided — meaning each one is trustworthy only
  // as long as that's still true right now. hub_initiative_activity rows
  // also carry no ref_id back to what they're about (see
  // InitiativeActivityEntry) — only a rendered sentence like "Completed
  // 'Track device inventory sheet'" — so both the link target *and* the
  // staleness check below resolve the same way: substring-matching that
  // sentence against the initiative's current task/resource list (exact
  // quoting isn't guaranteed, so this doesn't try to parse it out).
  //
  // 'team' rows are left unvalidated — unlike tasks/resources, it's not
  // confirmed here whether they're exclusively about role fills (which can
  // similarly revert via stepDownFromRole) or plain roster joins (which
  // can't in the same binary way), and guessing wrong risks hiding valid
  // updates instead of fixing stale ones.
  //
  // Both fetches only cover initiatives that actually have a task/resource
  // candidate above, not every initiative in the hub.
  const taskInitiativeIds = [...new Set(candidates.filter((row) => row.entry.kind === 'task').map((row) => row.initiativeId))];
  const resourceInitiativeIds = [...new Set(candidates.filter((row) => row.entry.kind === 'resource').map((row) => row.initiativeId))];

  const [taskListByInitiative, resourceListByInitiative] = await Promise.all([
    Promise.all(
      taskInitiativeIds.map((initiativeId) =>
        getInitiative(tunnelUrl, token, initiativeId)
          .then((initiative): [string, InitiativeTaskSummary[]] => [initiativeId, initiative.tasks])
          .catch((): [string, InitiativeTaskSummary[]] => [initiativeId, []])
      )
    ).then((entries) => new Map(entries)),
    Promise.all(
      resourceInitiativeIds.map((initiativeId) =>
        listInitiativeResources(tunnelUrl, token, initiativeId)
          .then((resources): [string, InitiativeResource[]] => [initiativeId, resources])
          .catch((): [string, InitiativeResource[]] => [initiativeId, []])
      )
    ).then((entries) => new Map(entries)),
  ]);

  const resolved = candidates
    .map((row) => {
      if (row.entry.kind === 'task') {
        const tasks = taskListByInitiative.get(row.initiativeId) ?? [];
        const matchedTask = tasks.find((task) => row.entry.text.includes(task.title));
        if (!matchedTask || matchedTask.status !== 'done') return null;
        return { ...row, taskId: matchedTask.id };
      }
      if (row.entry.kind === 'resource') {
        const resources = resourceListByInitiative.get(row.initiativeId) ?? [];
        const matchedResource = resources.find((resource) => row.entry.text.includes(resource.item));
        if (!matchedResource || !matchedResource.provided) return null;
        return row;
      }
      return row;
    })
    .filter((row): row is InitiativeUpdateRow => row !== null);

  return resolved.slice(0, 3);
}

// Where a given activity row should actually land. 'task' goes to the real
// task detail screen when taskId resolution (above) succeeded; 'resource'
// and 'team' fall back to their tab rather than the single item, since
// neither has a per-item detail route anywhere in this app (only tasks do —
// see app/initiatives/[id]/tasks/[taskId].tsx). Any other case (an
// unresolved task match, or a future activity kind) falls back to the
// initiative's own overview, same as before this row linked anywhere more
// specific.
function initiativeActivityHref(initiativeId: string, kind: string, taskId: string | undefined): Href {
  if (kind === 'task' && taskId) return `/initiatives/${initiativeId}/tasks/${taskId}` as unknown as Href;
  if (kind === 'resource') return `/initiatives/${initiativeId}/resources` as unknown as Href;
  if (kind === 'team') return `/initiatives/${initiativeId}/team` as unknown as Href;
  return { pathname: '/initiatives/[id]', params: { id: initiativeId } } as unknown as Href;
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
      style={[styles.atlasLatestRow, styles.eventRowCompact]}
      onPress={() => router.push({ pathname: '/post/[id]', params: { id: event.id } })}>
      <View style={[styles.atlasLatestContent, styles.eventContentCompact]}>
        <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, styles.eventTitleLarger]} numberOfLines={2}>
          {event.title ?? 'Event'}
        </ThemedText>
        <ThemedText style={styles.atlasLatestMeta} numberOfLines={1}>
          {event.event_date ? formatEventWhen(event.event_date, true) : 'Date TBA'}
          {event.rsvp_count > 0 ? ` · ${event.rsvp_count} going` : ''}
        </ThemedText>
        {!!event.body?.trim() && (
          <ThemedText style={styles.atlasLatestDescription} numberOfLines={2}>
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
  const [showHubInfo, setShowHubInfo] = useState(false);
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

  // Already newest-first (see hubService's listMarketplaceListings comment),
  // same slice-without-resorting Discover's own recentListings strip uses.
  const latestListings = listings.slice(0, 5);

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

  // Section ordering keys off when a section last got something new, not
  // what that latest thing happens to be about — so this deliberately uses
  // created_at (when the event was posted), not event_date (when it's
  // scheduled to happen). A just-added event pushes the whole Events
  // section to the top even if it's scheduled a month out; the one actually
  // displayed there stays featuredEvent (soonest upcoming) as before, this
  // is only a separate signal for section placement. Same
  // events + EVENT-category-posts union featuredEvent itself draws from.
  const eventsLatestAt = useMemo(() => {
    const eventIds = new Set(events.map((event) => event.id));
    const relevant = [...events, ...posts.filter((post) => post.category === 'EVENT' && !eventIds.has(post.id))];
    if (relevant.length === 0) return null;
    return Math.max(...relevant.map((item) => new Date(item.created_at).getTime()));
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

  // Sections reorder by recency — whichever one has the most recent new
  // thing (a post, an event, a pin, a file, a listing, an initiative
  // update) leads, then the next-most-recent, and so on. FeaturedCarousel
  // is curated/pinned separately above and isn't part of this ranking.
  // Discussions always has an entry (even with 0 posts, "No posts yet."
  // still renders, same as before) so it needs a real sort key too — 0
  // (oldest possible) rather than being left out, so it naturally settles
  // to the bottom rather than winning ties against genuinely-empty timestamps.
  const homeSections: { key: string; latestAt: number; node: ReactNode }[] = [];

  if (featuredEvent) {
    homeSections.push({
      key: 'events',
      latestAt: eventsLatestAt ?? 0,
      node: (
        <View style={styles.section} key="events">
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
      ),
    });
  }

  if (latestPin) {
    homeSections.push({
      key: 'atlas',
      latestAt: new Date(latestPin.created_at).getTime(),
      node: (
        <View style={styles.section} key="atlas">
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
              <CustomIcon name="landLayerLocation" size={18} color={Brand} />
            </View>
            <View style={styles.atlasLatestContent}>
              <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                See all Atlas pins
              </ThemedText>
            </View>
          </Pressable>
        </View>
      ),
    });
  }

  if (latestPublicFiles.length > 0) {
    homeSections.push({
      key: 'files',
      latestAt: new Date(latestPublicFiles[0].uploaded_at).getTime(),
      node: (
        <View style={styles.section} key="files">
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
      ),
    });
  }

  if (latestListings.length > 0) {
    homeSections.push({
      key: 'marketplace',
      latestAt: new Date(latestListings[0].created_at).getTime(),
      node: (
        <View style={styles.section} key="marketplace">
          <ThemedText style={styles.sectionLabel}>Marketplace</ThemedText>
          {/* Same horizontal-strip shape as FeaturedCarousel atop the
              screen — edgeToEdgeScroll cancels the section's own 20px
              padding so cards start flush at the screen edge, same trick
              atlasLatestPreview uses for its own full-bleed preview. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.edgeToEdgeScroll}
            contentContainerStyle={styles.marketplaceStrip}>
            {latestListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                tunnelUrl={session.hub.tunnelUrl}
                token={session.token}
                onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })}
                style={styles.marketplaceStripCard}
              />
            ))}
          </ScrollView>
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
      ),
    });
  }

  if (initiativeUpdates.length > 0) {
    homeSections.push({
      key: 'initiatives',
      latestAt: new Date(initiativeUpdates[0].entry.created_at).getTime(),
      node: (
        <View style={styles.section} key="initiatives">
          <ThemedText style={styles.sectionLabel}>Initiatives</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.edgeToEdgeScroll}
            contentContainerStyle={styles.initiativeStrip}>
            {initiativeUpdates.map((row) => (
              <InitiativeUpdateCard
                key={row.entry.id}
                row={row}
                tunnelUrl={session.hub.tunnelUrl}
                onPress={() => router.push(initiativeActivityHref(row.initiativeId, row.entry.kind, row.taskId))}
              />
            ))}
          </ScrollView>
          <Pressable style={[styles.atlasLatestRow, styles.trailingSeparator]} onPress={() => router.push('/initiatives' as Href)}>
            <View style={[styles.atlasLatestIcon, { backgroundColor: Brand + '22' }]}>
              <CustomIcon name="bullseyeArrow" size={18} color={Brand} />
            </View>
            <View style={styles.atlasLatestContent}>
              <ThemedText type="defaultSemiBold" style={[styles.atlasLatestTitle, { color: Brand }]}>
                See all initiatives
              </ThemedText>
            </View>
          </Pressable>
        </View>
      ),
    });
  }

  homeSections.push({
    key: 'discussions',
    latestAt: latestPost ? new Date(latestPost.created_at).getTime() : 0,
    node: (
      <View style={styles.section} key="discussions">
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
    ),
  });

  homeSections.sort((a, b) => b.latestAt - a.latestAt);

  const isLocal = isLocalConnection(session.hub.tunnelUrl);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerTitleRow}
          onPress={() => setShowHubInfo(true)}
          accessibilityLabel={`${session.hub.name} hub info`}
          accessibilityRole="button">
          <ThemedText type="title" style={styles.headerTitle} numberOfLines={1}>
            {session.hub.name}
          </ThemedText>
          {/* http:// only ever comes from a LAN connection (mDNS-discovered
              or manually entered, per lib/discovery/nearbyHubs.ts and
              hub-select.tsx's handleManualConnect) -- every registry/tunnel
              hub uses https://, so this needs no new plumbing to tell them
              apart. */}
          <View style={[styles.connectionBadge, isLocal ? styles.connectionBadgeLocal : styles.connectionBadgeWeb]}>
            <ThemedText style={[styles.connectionBadgeText, { color: isLocal ? '#22c55e' : Colors[colorScheme].icon }]}>
              {isLocal ? 'Local' : 'Web'}
            </ThemedText>
          </View>
        </Pressable>
        {/* Pulled off the tab bar — that slot now shows notifications
            instead (see app/(tabs)/_layout.tsx) — same CustomIcon "search"
            vector this button used to render there, just relocated. */}
        <Pressable onPress={() => router.push('/discover')} hitSlop={12} accessibilityLabel="Search" accessibilityRole="button">
          <CustomIcon size={24} name="search" color={Colors[colorScheme].text} />
        </Pressable>
      </View>

      <HubInfoModal
        visible={showHubInfo}
        onClose={() => setShowHubInfo(false)}
        hub={session.hub}
        isLocalConnection={isLocal}
      />

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

        {homeSections.map((section) => section.node)}
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
  headerTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 22,
  },
  connectionBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  connectionBadgeLocal: {
    backgroundColor: '#22c55e22',
    borderColor: '#22c55e55',
  },
  connectionBadgeWeb: {
    backgroundColor: '#8882',
    borderColor: '#8884',
  },
  connectionBadgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
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
  // Scoped to LatestEventRow only -- every other row sharing atlasLatestRow/
  // atlasLatestContent (Atlas, Files, Marketplace, Initiatives) keeps the
  // normal spacing; this section specifically asked for a tighter card.
  eventRowCompact: {
    paddingVertical: 10,
  },
  eventContentCompact: {
    gap: 2,
  },
  // atlasLatestTitle is 16/21 (fontSize/lineHeight) -- same +2 bump asked
  // for here, scoped to just this row like eventRowCompact above.
  eventTitleLarger: {
    fontSize: 18,
    lineHeight: 23,
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
  // Cancels the section's own 20px horizontal padding (same trick as
  // atlasLatestPreview/fileLatestThumb) so the strip's cards start flush at
  // the screen edge, same as FeaturedCarousel/Discover's own strips.
  edgeToEdgeScroll: {
    marginHorizontal: -20,
  },
  // No horizontal padding on purpose — matches FeaturedCarousel/Discover's
  // own strips, which start flush at the exact screen edge (draggable from
  // the edge, first card touching it) rather than inset like the section
  // label above it.
  marketplaceStrip: {
    gap: 10,
  },
  // Smaller than Discover's own marketplaceCard (180px, ListingCard's
  // default borderRadius: 14) — this strip is a Home preview, not
  // Discover's full browsing shelf, so a touch narrower and a touch less
  // rounded reads as the more compact of the two.
  marketplaceStripCard: {
    width: 150,
    borderRadius: 10,
  },
  // Same edge-to-edge/gap convention as marketplaceStrip above — the cards
  // themselves (InitiativeUpdateCard) own their own fixed width/aspect ratio.
  initiativeStrip: {
    gap: 10,
  },
});
