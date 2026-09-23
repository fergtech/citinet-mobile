import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useAppDrawer } from '@/components/app-drawer';
import { BrandGradient } from '@/components/brand-gradient';
import { HubAvatar } from '@/components/hub-avatar';
import { HubInfoModal } from '@/components/hub-info-modal';
import { HubMedia } from '@/components/hub-media';
import { type InitiativeUpdateRow } from '@/components/initiative-update-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ColorCycleText } from '@/components/ui/color-cycle-text';
import { CustomIcon } from '@/components/ui/custom-icon';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { DashboardSkeleton } from '@/components/ui/list-skeleton';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readCache, writeCache } from '@/lib/api/dataCache';
import {
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
} from '@/lib/api/hubService';
import {
  AtlasPin,
  HubFile,
  HubMember,
  HubPost,
  InitiativeResource,
  InitiativeTaskSummary,
  MarketplaceListing,
} from '@/lib/api/types';
import { flushWriteQueue } from '@/lib/api/write-queue';
import { fileKind } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';
import { isLocalConnection } from '@/lib/ui/is-local-connection';
import { useTabBarVisibility } from '@/lib/ui/tab-bar-visibility';
import { timeAgo } from '@/lib/ui/time-ago';

// InitiativeUpdateRow now lives in components/initiative-update-card.tsx,
// even though the card itself no longer renders on Home (see the unified
// activity list below) — fetchInitiativeUpdates still builds this same
// shape, and that component still renders it on the initiative's own screen.

const HOME_CACHE_KEY = 'home-dashboard';

// The same five commands citinet-web's Dashboard.tsx quick-action row
// offers (create-post, create-event, add-pin, new-listing, find-people) —
// matched 1:1, in the same order, so the two feel like the same feature
// wearing different clothes rather than two different feature sets. The
// rest of this app's create surface (file upload, poll, initiative, club —
// see app/modal.tsx's own SECTIONS) stays reachable the way it already was,
// via the tab bar's center "+" button, same as before this pass. Pushes
// straight to each editor rather than through app/modal.tsx first, so no
// `from: 'compose'` param here: that value specifically tells an editor it
// was reached via the launcher and should dismiss(2) (itself + the
// launcher) on success — going through it here would pop one screen too
// many, past Home.
const QUICK_ACTIONS: { key: string; icon: IconSymbolName; label: string; href: Href }[] = [
  { key: 'post', icon: 'pencil', label: 'Post', href: '/compose-post' as Href },
  { key: 'event', icon: 'calendar', label: 'Event', href: '/event-editor' as Href },
  { key: 'pin', icon: 'mappin.and.ellipse', label: 'Add Pin', href: '/atlas/editor' as Href },
  { key: 'listing', icon: 'tag.fill', label: 'New Listing', href: '/marketplace/editor' as Href },
  { key: 'people', icon: 'person.2.fill', label: 'Find People', href: '/discover' as Href },
];

// Verbatim match of web's greetingForHour, including "Still up" rather than
// a plain "Good night" for the small hours — same wry touch, same threshold.
function timeOfDayGreeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Everything load() below fetches, cached as one blob (same one-blob-per-
// screen shape as Feed's own dataCache use) so reopening Home shows the last
// known dashboard instantly instead of a blank spinner. `members` is the raw
// array from listMembers, not the Map load() builds from it — Map doesn't
// survive JSON.stringify (comes back as "{}"), so the cache-seed effect
// rebuilds the Map from this array the same way load() itself does.
type HomeCacheData = {
  posts: HubPost[];
  events: HubPost[];
  atlasPins: AtlasPin[];
  files: HubFile[];
  listings: MarketplaceListing[];
  initiativeUpdates: InitiativeUpdateRow[];
  members: HubMember[];
};

// One card in the "Featured" grid — see the featuredCards memo below.
type FeaturedCard = {
  key: string;
  label: string;
  icon: IconSymbolName;
  title: string;
  timestamp: number;
  onPress: () => void;
  // Set when the source item actually carries an uploaded image/video —
  // that file, not a synthesized fallback (no Atlas Panoramax/map lookup
  // here, unlike the old dedicated Atlas preview row), rendered as the
  // card's cover instead of the plain icon-badge layout. mediaIsPublic
  // mirrors HubMedia's own isPublic prop — true for pin/post media (always
  // public server-side, same as any post attachment) and file cards,
  // false-only-possible for a file that's neither is_public nor web_public
  // (excluded before a card is ever built — see featuredCards below).
  mediaFileName?: string | null;
  mediaIsPublic?: boolean;
};

// A row of the unified "Recent Activity" list — see the activityRows memo
// below. Either avatarUserId or icon is set, never both: a real per-user
// avatar when the source item has a resolvable actor, an icon badge when it
// doesn't (marketplace listings, initiative updates).
type ActivityRow = {
  key: string;
  timestamp: number;
  onPress: () => void;
  actorLabel: string;
  summary: string;
  avatarUserId?: string | null;
  avatarName?: string;
  icon?: IconSymbolName;
  iconColor?: string;
};

// web's own Recent Activity slices to 5 (see useActivityFeed.ts) — mobile
// folds in two more source types (marketplace, initiatives) that web's
// dashboard doesn't surface at all, so a slightly larger cap keeps all five
// source types realistically able to show up rather than being crowded out
// by whichever type happens to post most often.
const RECENT_ACTIVITY_LIMIT = 8;

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

  // At most one card per initiative — `resolved` is still sorted most-recent
  // first (the sort in `candidates` above survives the .map/.filter), so
  // keeping only the first row seen per initiativeId keeps each initiative's
  // single latest update while still ranking across initiatives by recency.
  // Without this, an initiative with two recent task completions could take
  // two of the section's three slots and crowd out a different initiative.
  const seenInitiatives = new Set<string>();
  const deduped = resolved.filter((row) => {
    if (seenInitiatives.has(row.initiativeId)) return false;
    seenInitiatives.add(row.initiativeId);
    return true;
  });

  return deduped.slice(0, 3);
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

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session, otherSessions, switchToHub } = useSession();
  const appDrawer = useAppDrawer();

  const [posts, setPosts] = useState<HubPost[]>([]);
  const [events, setEvents] = useState<HubPost[]>([]);
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [initiativeUpdates, setInitiativeUpdates] = useState<InitiativeUpdateRow[]>([]);
  const [members, setMembers] = useState<Map<string, HubMember>>(new Map());
  const [showHubInfo, setShowHubInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Flips true once Home has shown *something* (cache-seeded or fetched) —
  // same role as Feed's own hasContentRef: gates a refocus reload to run
  // silently (no blocking spinner, no error banner on failure), and gates
  // the quiet-retry-before-erroring behavior below to only the case where
  // there's truly nothing on screen yet.
  const hasContentRef = useRef(false);
  // Same in-flight/pending-replay guard as app/(tabs)/feed.tsx's own load()
  // — Home's useFocusEffect(load) below has always re-fetched on every
  // refocus with nothing stopping two calls from overlapping (e.g. bouncing
  // between tabs), which against a single self-hosted hub can itself produce
  // real connection failures, not just wasted duplicate work.
  const loadInFlightRef = useRef(false);
  const pendingLoadRef = useRef<{ silent?: boolean } | null>(null);

  // Seed instantly from the last successful response, cached per hub — same
  // pattern as Feed's own cache-seed effect (lib/api/dataCache.ts), so
  // reopening Home (cold start, or right after a hub restart) shows the
  // last-seen dashboard instead of a blank screen while the real fetch is
  // still in flight.
  useEffect(() => {
    if (!session) return;
    hasContentRef.current = false;
    readCache<HomeCacheData>(session.hub.slug, HOME_CACHE_KEY).then((cached) => {
      if (!cached) return;
      setPosts(cached.posts);
      setEvents(cached.events);
      setAtlasPins(cached.atlasPins);
      setFiles(cached.files);
      setListings(cached.listings);
      setInitiativeUpdates(cached.initiativeUpdates);
      setMembers(new Map(cached.members.map((m) => [m.user_id, m])));
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
      // not sequenced ahead of the fetch below the way Feed/Post Detail do it,
      // to avoid restructuring this already-large Promise.all; a write this
      // flush just sent will show up on Home's next focus/refresh instead of
      // this exact one. A no-op, no network call, when the queue's empty.
      flushWriteQueue().catch(() => {});
      // Retrying below only re-quiets a failure of *this* Promise.all as a
      // whole — a real per-section fallback (one section's failure not
      // blocking the rest) is a bigger change than this fix covers.
      let retrying = false;
      Promise.all([
        getPosts(session.hub.tunnelUrl, session.token),
        getUpcomingEvents(session.hub.tunnelUrl, session.token),
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
        .then(([postsPage, nextEvents, nextPins, nextFiles, nextListings, nextMembers, nextInitiativeUpdates]) => {
          setPosts(postsPage.posts);
          setEvents(nextEvents);
          setAtlasPins(nextPins);
          setFiles(nextFiles);
          setListings(nextListings);
          setMembers(new Map(nextMembers.map((m) => [m.user_id, m])));
          setInitiativeUpdates(nextInitiativeUpdates);
          hasContentRef.current = true;
          writeCache(session.hub.slug, HOME_CACHE_KEY, {
            posts: postsPage.posts,
            events: nextEvents,
            atlasPins: nextPins,
            files: nextFiles,
            listings: nextListings,
            initiativeUpdates: nextInitiativeUpdates,
            members: nextMembers,
          } satisfies HomeCacheData);
        })
        .catch((err) => {
          // A cold app+server restart (fresh hub process, tunnel still
          // re-establishing) can fail this very first Promise.all with a
          // real connection error even though the exact same request
          // succeeds a second later — observed directly: a manual
          // pull-to-refresh moments after this error immediately works.
          // A SILENT failure (refocus reload with content already on
          // screen, cache-seeded or fetched) never surfaces the banner at
          // all, same policy as Feed — it just gets one quiet retry. A
          // non-silent load with nothing on screen yet gets the same quiet
          // retry before it's treated as a real, banner-worthy failure; a
          // non-silent load that DOES already have content (a manual
          // pull-to-refresh) shows the error immediately since the user
          // explicitly asked for this one and deserves real feedback.
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

  // Focus-based, not mount-only: a like/reply/save made on Post Detail, Feed,
  // Events, or Atlas doesn't touch Home's own state (each screen fetches its
  // own copy), so without this, coming back to Home kept showing whatever was
  // true when it first mounted until a manual pull-to-refresh. Every tab
  // screen in this app follows the same rule now — see Messages/Discover for
  // the same fix, and the project memory entry on this whole pass. Silent
  // once there's already content on screen, same as Feed — the pull-to-
  // refresh RefreshControl below always calls load() with no args, so it
  // still shows its own spinner regardless.
  useFocusEffect(
    useCallback(() => {
      load({ silent: hasContentRef.current });
    }, [load])
  );

  // Re-tapping the Home tab while already on it scrolls back to the top.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // Hides the floating tab bar (app/(tabs)/_layout.tsx, rendered via
  // components/animated-tab-bar.tsx) on scroll-down, brings it back on
  // scroll-up — same idea as Twitter/Instagram's own bottom bars. A real
  // Reanimated transform (lib/ui/tab-bar-visibility.ts), shared across the
  // whole tab navigator but only ever driven from here — Discover/Alerts/
  // Messages/Profile never call setHidden, so they're unaffected and the
  // bar always shows there.
  const { setHidden: setTabBarHidden } = useTabBarVisibility();
  const lastScrollY = useRef(0);
  // Net movement in the CURRENT direction since the last time it crossed a
  // threshold (or reversed) — not last frame's delta. Comparing only to the
  // immediately previous scroll event effectively measured speed, not
  // distance: a slow drag never produces a single-frame delta past the
  // threshold no matter how far it's actually travelled, so the bar never
  // reacted at all below a certain scroll speed. Accumulating here instead
  // means N slow small steps in the same direction add up exactly like one
  // fast big one.
  const accumulatedDelta = useRef(0);

  // A small dead zone (SCROLL_HIDE_THRESHOLD) so a slight rubber-band wobble
  // at rest doesn't flicker the bar, and it's never hidden near the very top
  // (NEAR_TOP_THRESHOLD) — landing back at the top of the feed always shows
  // it again regardless of which way the last scroll went.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const diff = y - lastScrollY.current;
      const SCROLL_HIDE_THRESHOLD = 12;
      const NEAR_TOP_THRESHOLD = 40;

      // Direction reversed (or this is the first move) — start a fresh run
      // from here rather than carrying over an opposite-sign accumulation,
      // which would otherwise blunt/delay the very next real direction.
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

  // Only iOS's tab bar floats over content (see app/(tabs)/_layout.tsx) —
  // compensate so the list doesn't end up hidden behind the glass.
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;

  // One card per feature area (Atlas/Posts/Events/Files), each showing
  // whatever's freshest in that category — the same computed-not-curated
  // "Featured cards" web Dashboard.tsx builds from its activity feed
  // (freshest of pin_added / discussion|announcement|project|request /
  // event / file_shared), not the old admin-curated hub_featured carousel
  // this replaced. Deliberate: an admin's picks read as top-down and
  // disconnected from what a given member actually cares about, where "here's
  // what's freshest in each part of the hub" stays neutral and in the
  // logged-in member's own frame (product ask, 2026-09-20). Fixed pin/post/
  // event/file order, same as web — no cross-category ranking, each bucket
  // just shows its own single freshest item or is skipped if empty.
  const featuredCards = useMemo<FeaturedCard[]>(() => {
    const cards: FeaturedCard[] = [];

    const latestPin = [...atlasPins].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (latestPin) {
      cards.push({
        key: 'pin',
        label: 'Latest Atlas Pin',
        icon: 'mappin.and.ellipse',
        title: latestPin.title,
        timestamp: new Date(latestPin.created_at).getTime(),
        onPress: () => router.push({ pathname: '/atlas/[id]', params: { id: latestPin.id } }),
        // Only an uploaded photo counts as cover — no Panoramax/map fallback
        // lookup here, unlike the old dedicated Atlas preview row.
        mediaFileName: latestPin.image_file_name,
        mediaIsPublic: true,
      });
    }

    const latestPost = [...posts]
      .filter((post) => post.category !== 'EVENT')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (latestPost) {
      cards.push({
        key: 'post',
        label: 'Newest Community Post',
        icon: 'newspaper.fill',
        title: latestPost.title || latestPost.body?.slice(0, 60) || 'Untitled',
        timestamp: new Date(latestPost.created_at).getTime(),
        onPress: () => router.push({ pathname: '/post/[id]', params: { id: latestPost.id } }),
        // Post attachments are always public server-side (see HubMedia's own
        // isPublic comment) — same as any PostRow/FeaturedCarousel media.
        mediaFileName: latestPost.media_file_name,
        mediaIsPublic: true,
      });
    }

    // Same union as activityRows below — `events` ∪ EVENT-category `posts`
    // not already in `events`.
    const eventIds = new Set(events.map((event) => event.id));
    const latestEvent = [...events, ...posts.filter((post) => post.category === 'EVENT' && !eventIds.has(post.id))].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
    if (latestEvent) {
      cards.push({
        key: 'event',
        label: 'Recent Event',
        icon: 'calendar',
        title: latestEvent.title ?? 'Event',
        timestamp: new Date(latestEvent.created_at).getTime(),
        onPress: () => router.push({ pathname: '/post/[id]', params: { id: latestEvent.id } }),
        mediaFileName: latestEvent.media_file_name,
        mediaIsPublic: true,
      });
    }

    const latestFile = [...files]
      .filter((file) => file.is_public || file.web_public)
      .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0];
    if (latestFile) {
      const kind = fileKind(latestFile.file_name, latestFile.mime_type);
      cards.push({
        key: 'file',
        label: 'Newly Shared File',
        icon: 'doc.text.fill',
        title: latestFile.file_name,
        timestamp: new Date(latestFile.uploaded_at).getTime(),
        onPress: () => router.push({ pathname: '/files/[id]', params: { id: latestFile.file_id } }),
        // The file itself is the cover, but only when it's actually a
        // renderable image/video — the same hasPreview gate the old
        // FileHomeRow used, so a PDF/doc card still falls back to the icon
        // badge instead of HubMedia failing to decode it as an image.
        mediaFileName: kind === 'image' || kind === 'video' ? latestFile.file_name : null,
        mediaIsPublic: latestFile.is_public || latestFile.web_public,
      });
    }

    return cards;
  }, [atlasPins, posts, events, files]);

  // One flat, merged, recency-sorted list — the mobile match for web
  // Dashboard.tsx's own "Recent Activity" (see useActivityFeed.ts there):
  // every source Home already fetches, folded into the same shape and
  // capped to RECENT_ACTIVITY_LIMIT, replacing what used to be five
  // separately labeled/dividered sections below the carousel. Detail stays
  // one tap away on each feature's own tab; this is a browse surface, not a
  // duplicate of it.
  const activityRows = useMemo<ActivityRow[]>(() => {
    const rows: ActivityRow[] = [];

    // Posts ∪ events, deduped by id — `events` (getUpcomingEvents) can
    // include upcoming EVENT-category posts outside `posts`' own page, and
    // `posts` can include EVENT-category posts (past, or beyond that
    // upcoming set) that aren't in `events` — same union the old
    // eventsLatestAt memo computed before this list replaced it.
    const postsById = new Map<string, HubPost>();
    for (const post of posts) postsById.set(post.id, post);
    for (const event of events) if (!postsById.has(event.id)) postsById.set(event.id, event);

    for (const post of postsById.values()) {
      rows.push({
        key: `post-${post.id}`,
        timestamp: new Date(post.created_at).getTime(),
        onPress: () => router.push({ pathname: '/post/[id]', params: { id: post.id } }),
        actorLabel: post.author_username ? `@${post.author_username}` : 'A neighbor',
        summary: 'posted',
        avatarUserId: post.author_id,
        avatarName: post.author_username ?? '?',
      });
    }

    for (const pin of atlasPins) {
      rows.push({
        key: `pin-${pin.id}`,
        timestamp: new Date(pin.created_at).getTime(),
        onPress: () => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } }),
        actorLabel: pin.author_username ? `@${pin.author_username}` : 'A neighbor',
        summary: 'pinned to the Atlas',
        avatarUserId: pin.author_id,
        avatarName: pin.author_username ?? '?',
      });
    }

    // Same "everyone (or anyone with the link) can actually see it" scope as
    // the old Files section — is_public (hub) or web_public (anyone with the
    // link); listFiles() already scopes the response to "mine + is_public".
    for (const file of files) {
      if (!file.is_public && !file.web_public) continue;
      const uploader = members.get(file.owner_id)?.username;
      rows.push({
        key: `file-${file.file_id}`,
        timestamp: new Date(file.uploaded_at).getTime(),
        onPress: () => router.push({ pathname: '/files/[id]', params: { id: file.file_id } }),
        actorLabel: uploader ? `@${uploader}` : 'A neighbor',
        summary: 'shared a file',
        avatarUserId: file.owner_id,
        avatarName: uploader ?? '?',
      });
    }

    // Marketplace/initiatives have no single per-user actor the way a post,
    // pin, or file upload does (a listing belongs to a vendor; an initiative
    // activity row only carries a free-text actor_name, not a resolvable
    // user id) — an icon badge stands in for the avatar on these two, same
    // leading-visual slot, just no photo to put there.
    for (const listing of listings) {
      rows.push({
        key: `listing-${listing.id}`,
        timestamp: new Date(listing.created_at).getTime(),
        onPress: () => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } }),
        actorLabel: listing.vendor_name,
        summary: 'listed an item',
        icon: 'tag.fill',
        iconColor: Brand,
      });
    }

    for (const update of initiativeUpdates) {
      rows.push({
        key: `initiative-${update.entry.id}`,
        timestamp: new Date(update.entry.created_at).getTime(),
        onPress: () => router.push(initiativeActivityHref(update.initiativeId, update.entry.kind, update.taskId)),
        actorLabel: update.initiativeTitle,
        summary: update.entry.text,
        icon: 'target',
        iconColor: Brand,
      });
    }

    rows.sort((a, b) => b.timestamp - a.timestamp);
    return rows.slice(0, RECENT_ACTIVITY_LIMIT);
  }, [posts, events, atlasPins, files, listings, initiativeUpdates, members]);

  if (!session) return null;

  const firstName = (session.displayName || session.username).split(' ')[0];
  const now = new Date();
  const greeting = timeOfDayGreeting(now.getHours());
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const isLocal = isLocalConnection(session.hub.tunnelUrl);

  return (
    <ThemedView style={styles.container}>
      <HubInfoModal
        visible={showHubInfo}
        onClose={() => setShowHubInfo(false)}
        hub={session.hub}
        isLocalConnection={isLocal}
        otherSessions={otherSessions}
        onSwitchHub={switchToHub}
      />

      {/* One unified scroll, header included — re-tapping the Home tab
          already scrolls back to the very top (useScrollToTop(scrollRef)
          below), so pinning the header/search/quick-actions outside the
          scroll bought nothing but a permanent chunk of lost vertical space
          (product ask, 2026-09-20). */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 24 + extraBottomInset }}
        // progressViewOffset pushes the spinner down by roughly the header's
        // own top clearance (see styles.header's paddingTop: 60, same flat
        // value) — now that the header is the scroll's own first child
        // instead of sitting fixed above it, an un-offset spinner would
        // rest right at the very top of the screen (behind the status bar/
        // notch on both platforms) instead of somewhere actually visible.
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} progressViewOffset={60} />}
        onScroll={handleScroll}
        scrollEventThrottle={16}>
        <View style={styles.header}>
          {/* Tap-to-open fallback for AppDrawer (components/app-drawer.tsx),
              not just its left-edge swipe — important on Android, where that
              edge-swipe competes with (and often loses to) the system's own
              back gesture in gesture-navigation mode, see EDGE_WIDTH's comment
              there. A button gives Android users a reliable way in regardless
              of how that gesture race goes. */}
          <Pressable onPress={appDrawer.toggle} hitSlop={12} accessibilityLabel="Menu" accessibilityRole="button">
            <IconSymbol name="line.3.horizontal" size={22} color={Colors[colorScheme].text} />
          </Pressable>
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
        </View>

        <View style={styles.greetingRow}>
          <ThemedText type="title" style={styles.greetingText} numberOfLines={1}>
            {greeting}, <ColorCycleText style={styles.greetingText}>{firstName}</ColorCycleText>
          </ThemedText>
          <ThemedText style={styles.dateTimeText} numberOfLines={1}>
            {dateStr} · {timeStr}
          </ThemedText>
        </View>

        {/* The one search surface for Home, standing in for the web
            dashboard's single universal search bar — navigates to the real
            Discover screen (app/(tabs)/discover.tsx), which already covers
            posts/events/atlas/marketplace/initiatives/files/people/other hubs
            with real server-side search. Used to open a separate DiscoverDrawer
            that duplicated a subset of that same screen; that drawer's gone
            now (2026-09-20 nav cleanup), so this is a direct navigation, not a
            toggle. Rendered as a real search-bar shape rather than an icon so
            it reads as an entry point, not a utility button, same intent as
            the web version even though this app has no typed command-routing
            to match its "doubles as a command palette" half. The `focus`
            param (a fresh timestamp every tap) tells Discover's own screen to
            open its keyboard the moment it's actually visible — see that
            screen's own handledFocusRef comment for why it's a changing value
            and not a fixed '1'. */}
        <Pressable
          style={styles.searchBar}
          onPress={() => router.push({ pathname: '/discover', params: { focus: String(Date.now()) } })}
          accessibilityLabel="Search"
          accessibilityRole="button">
          <CustomIcon size={16} name="search" color={Colors[colorScheme].icon} />
          <ThemedText style={styles.searchBarPlaceholder} numberOfLines={1}>
            Search posts, events, pins, people…
          </ThemedText>
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActionsRow}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable key={action.key} style={styles.quickActionPill} onPress={() => router.push(action.href)}>
              <IconSymbol name={action.icon} size={15} color={Colors[colorScheme].text} />
              <ThemedText style={styles.quickActionLabel}>{action.label}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {/* Only blocks the body when there's truly nothing to show yet —
            cache-seeded content (see the readCache effect above) renders
            immediately and revalidates in the background instead, same as
            Feed/Post Detail's own pattern. Shaped section placeholders, not a
            spinner — see components/ui/list-skeleton.tsx. The header/search/
            quick-actions above render regardless, so menu/hub-switch/search
            stay reachable even before the first load settles. */}
        {loading && !hasContentRef.current ? (
          <DashboardSkeleton />
        ) : (
          <>
            {featuredCards.length > 0 && (
              <View style={styles.section}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.featuredScroll}
                  contentContainerStyle={styles.featuredGrid}>
                  {featuredCards.map((card) =>
                    card.mediaFileName ? (
                      // Cover treatment — same idea as the old FeaturedCarousel's
                      // media cards (full-bleed image/video, dark-scrim
                      // overlay text), just applied per feature-area card
                      // instead of an admin-curated one.
                      <Pressable key={card.key} style={styles.featuredCard} onPress={card.onPress}>
                        <HubMedia
                          fileName={card.mediaFileName}
                          tunnelUrl={session.hub.tunnelUrl}
                          token={session.token}
                          isPublic={card.mediaIsPublic}
                          previewSeconds={4}
                          style={styles.featuredCardMedia}
                        />
                        <LinearGradient
                          colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
                          locations={[0, 0.5, 1]}
                          style={styles.featuredCardScrim}>
                          <ThemedText style={[styles.featuredCardEyebrow, styles.featuredCardTextOnMedia]}>{card.label}</ThemedText>
                          <ThemedText
                            type="defaultSemiBold"
                            numberOfLines={1}
                            style={[styles.featuredCardTitle, styles.featuredCardTextOnMedia]}>
                            {card.title}
                          </ThemedText>
                          <ThemedText numberOfLines={1} style={[styles.featuredCardMeta, styles.featuredCardTextOnMedia]}>
                            {timeAgo(new Date(card.timestamp).toISOString())} · View →
                          </ThemedText>
                        </LinearGradient>
                      </Pressable>
                    ) : (
                      <Pressable key={card.key} style={[styles.featuredCard, styles.featuredCardPlainCard]} onPress={card.onPress}>
                        <BrandGradient style={styles.featuredCardIconBadge}>
                          <IconSymbol name={card.icon} size={16} color="#fff" />
                        </BrandGradient>
                        <ThemedText style={styles.featuredCardEyebrow}>{card.label}</ThemedText>
                        <ThemedText type="defaultSemiBold" style={styles.featuredCardTitle} numberOfLines={1}>
                          {card.title}
                        </ThemedText>
                        <ThemedText style={styles.featuredCardMeta} numberOfLines={1}>
                          {timeAgo(new Date(card.timestamp).toISOString())} · View →
                        </ThemedText>
                      </Pressable>
                    )
                  )}
                </ScrollView>
              </View>
            )}

            <View style={styles.section}>
              <ThemedText style={styles.sectionLabel}>Recent Activity</ThemedText>
              {activityRows.length === 0 ? (
                !loading && <ThemedText style={styles.rowMeta}>No activity yet.</ThemedText>
              ) : (
                activityRows.map((row, index) => (
                  <Pressable
                    key={row.key}
                    style={[styles.activityRow, index === activityRows.length - 1 && styles.activityRowLast]}
                    onPress={row.onPress}>
                    {row.icon ? (
                      <View style={[styles.activityIconBadge, { backgroundColor: (row.iconColor ?? Brand) + '22' }]}>
                        <IconSymbol name={row.icon} size={16} color={row.iconColor ?? Brand} />
                      </View>
                    ) : (
                      <HubAvatar
                        userId={row.avatarUserId ?? null}
                        displayName={row.avatarName ?? '?'}
                        tunnelUrl={session.hub.tunnelUrl}
                        size={36}
                      />
                    )}
                    <ThemedText numberOfLines={2} style={styles.activityText}>
                      <ThemedText style={styles.activityActor}>{row.actorLabel} </ThemedText>
                      {row.summary} <ThemedText style={styles.activityTime}>· {timeAgo(new Date(row.timestamp).toISOString())}</ThemedText>
                    </ThemedText>
                  </Pressable>
                ))
              )}
            </View>

            {/* Same footer link as web Dashboard.tsx, same destination — this
                app's actual public issue tracker, not a placeholder. */}
            <Pressable
              style={styles.feedbackLink}
              onPress={() => Linking.openURL('https://github.com/fergtech/citinet/issues/new/choose')}>
              <ThemedText style={styles.feedbackLinkText}>Help shape Citinet</ThemedText>
              <IconSymbol name="chevron.right" size={13} color={Brand} />
            </Pressable>
          </>
        )}
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
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  greetingRow: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  greetingText: {
    fontSize: 24,
    lineHeight: 29,
  },
  dateTimeText: {
    opacity: 0.5,
    fontSize: 13,
    marginTop: 2,
  },
  // Hairline border, no fill — same "soft border, no boxed chrome" read as
  // the rest of Home, not a solid search-field background.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  searchBarPlaceholder: {
    flex: 1,
    opacity: 0.6,
    fontSize: 14.5,
  },
  quickActionsRow: {
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  // Outlined pill, not filled — same reasoning as searchBar above; the
  // Brand-colored icon carries enough weight against the flat background
  // without needing a tinted fill behind it.
  quickActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  quickActionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  // Cancels `section`'s own 20px horizontal padding (same trick the old
  // marketplace/initiative strips used) so cards start flush at the screen
  // edge instead of inset like the section label above them.
  featuredScroll: {
    marginHorizontal: -20,
  },
  // Single horizontally-scrollable row, not a wrapped 2-column grid (product
  // ask, 2026-09-20 — reads as one glanceable strip instead of a block that
  // pushes the rest of Home down). Hairline-bordered, not web's blurred
  // glass fill — same "soft border, no boxed chrome" idiom as searchBar/
  // quickActionPill above.
  featuredGrid: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
  },
  // A fixed pixel height (not aspectRatio) on purpose — the media variant's
  // only children (HubMedia, the gradient scrim) are both absolutely
  // positioned, so the Pressable itself has no real intrinsic content size
  // to size from. aspectRatio + all-absolute children is a genuinely
  // fragile combination in RN's layout engine (observed directly: it
  // produced a wildly oversized card with a large blank gap below it, not
  // the intended 4:5 box) — an explicit height sidesteps that ambiguity
  // entirely. Both card variants share this same width/height so the strip
  // reads as one consistent row instead of mismatched card sizes.
  featuredCard: {
    width: 150,
    height: 140,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    overflow: 'hidden',
  },
  featuredCardPlainCard: {
    padding: 12,
  },
  featuredCardMedia: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  featuredCardScrim: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 10,
  },
  // White + text shadow so the label/title/meta stay legible over whatever
  // photo/video the card happens to be covering — same treatment
  // FeaturedCarousel's own overlayTitle/overlayCaption used.
  featuredCardTextOnMedia: {
    color: '#fff',
    opacity: 1,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  featuredCardIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  featuredCardEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.55,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  featuredCardTitle: {
    fontSize: 14,
    marginTop: 2,
  },
  featuredCardMeta: {
    fontSize: 11.5,
    opacity: 0.55,
    marginTop: 3,
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
  },
  // One flat row per activityRows entry, hairline divider between rows (not
  // after the last one) — the merged-list version of the same "no boxed/
  // tinted cards, full-bleed rows" convention the old per-category sections
  // used, just one list instead of five.
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  activityActor: {
    fontWeight: '600',
  },
  activityTime: {
    opacity: 0.6,
  },
  feedbackLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    marginTop: 4,
  },
  feedbackLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand,
  },
});
