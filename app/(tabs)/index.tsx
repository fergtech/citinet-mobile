import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { HubInfoModal } from '@/components/hub-info-modal';
import { HomeActivityCard, type HomeActivityCardData } from '@/components/home-activity-card';
import { type InitiativeUpdateRow } from '@/components/initiative-update-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ColorCycleText } from '@/components/ui/color-cycle-text';
import { CustomIcon } from '@/components/ui/custom-icon';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { DashboardSkeleton } from '@/components/ui/list-skeleton';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readCache, writeCache } from '@/lib/api/dataCache';
import {
  getInitiative,
  getInitiativeActivity,
  getPosts,
  getUpcomingEvents,
  listAtlasPins,
  listInitiativeResources,
  listInitiatives,
  getMyVendor,
  listMarketplaceListings,
  listMembers,
} from '@/lib/api/hubService';
import {
  AtlasPin,
  HubPost,
  InitiativeResource,
  InitiativeTaskSummary,
  MarketplaceListing,
} from '@/lib/api/types';
import { flushWriteQueue } from '@/lib/api/write-queue';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { categoryMeta } from '@/lib/marketplace/categories';
import { useSession } from '@/lib/session/session-context';
import { isLocalConnection } from '@/lib/ui/is-local-connection';
import { useTabBarVisibility } from '@/lib/ui/tab-bar-visibility';

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
// Hidden for now — the Create button in the tab bar covers the same ground.
// Flip to true to bring the pill row back; the actions themselves are intact.
const SHOW_QUICK_ACTIONS = false;

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
  listings: MarketplaceListing[];
  initiativeUpdates: InitiativeUpdateRow[];
  // Optional: caches written before the engagement/ownership rules landed
  // don't have them.
  memberCount?: number;
  myVendorId?: string | null;
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
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [initiativeUpdates, setInitiativeUpdates] = useState<InitiativeUpdateRow[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [myVendorId, setMyVendorId] = useState<string | null>(null);
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
      setListings(cached.listings);
      setInitiativeUpdates(cached.initiativeUpdates);
      setMemberCount(cached.memberCount ?? 0);
      setMyVendorId(cached.myVendorId ?? null);
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
        // GET /api/marketplace/listings already returns newest-first (see
        // Discover's own recentListings comment), so the first entry is the
        // latest item added — no extra sort needed here.
        listMarketplaceListings(session.hub.tunnelUrl, session.token).catch(() => []),
        fetchInitiativeUpdates(session.hub.tunnelUrl, session.token),
        // Only the count (hub size for the engagement threshold) and whether
        // the caller owns a vendor page (to skip their own listings).
        listMembers(session.hub.tunnelUrl, session.token).catch(() => []),
        getMyVendor(session.hub.tunnelUrl, session.token).catch(() => null),
      ])
        .then(([postsPage, nextEvents, nextPins, nextListings, nextInitiativeUpdates, nextMembers, nextMyVendor]) => {
          setPosts(postsPage.posts);
          setEvents(nextEvents);
          setAtlasPins(nextPins);
          setListings(nextListings);
          setInitiativeUpdates(nextInitiativeUpdates);
          setMemberCount(nextMembers.length);
          setMyVendorId(nextMyVendor?.id ?? null);
          hasContentRef.current = true;
          writeCache(session.hub.slug, HOME_CACHE_KEY, {
            posts: postsPage.posts,
            events: nextEvents,
            atlasPins: nextPins,
            listings: nextListings,
            initiativeUpdates: nextInitiativeUpdates,
            memberCount: nextMembers.length,
            myVendorId: nextMyVendor?.id ?? null,
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

  // The drawer's Citinet wordmark navigates here with a fresh `refresh`
  // timestamp: back to the top, and refetch even if Home was already focused
  // (useFocusEffect above only fires on a focus change).
  const { refresh } = useLocalSearchParams<{ refresh?: string }>();
  useEffect(() => {
    if (!refresh) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new refresh stamp should re-run this.
  }, [refresh]);

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

  // One card per common feature area (Feed posts, Events, Atlas, Marketplace,
  // Initiatives). Files and Notes are deliberately left out (product ask,
  // 2026-10-01). Selection rules, per card:
  //  1. Nothing the signed-in user made themselves.
  //  2. Default: the latest item in that area.
  //  3. Exception: for items that can take likes/comments, any with
  //     likes >= 5% of the hub's member count, OR comments >= that, take
  //     precedence over "latest" — and among those, the latest wins.
  //     (Atlas pins only have comments; listings/initiative updates have
  //     neither, so they're always just the latest.)
  // A bucket with nothing eligible is skipped; cards are ordered by recency
  // across buckets. Card look: see components/home-activity-card.tsx.
  const latestCards = useMemo(() => {
    const me = session?.userId;
    const myNames = [session?.username, session?.displayName].filter(Boolean).map((n) => n!.trim().toLowerCase());
    // Min 1 so zero-engagement items never count as "popular" in a tiny hub.
    const threshold = Math.max(1, Math.ceil(memberCount * 0.05));

    const newest = <T,>(items: T[], at: (item: T) => string) =>
      [...items].sort((a, b) => new Date(at(b)).getTime() - new Date(at(a)).getTime())[0];
    // `engagement` omitted → item type can't take likes/comments.
    const pick = <T,>(items: T[], at: (item: T) => string, engagement?: (item: T) => number[]) => {
      const popular = engagement ? items.filter((item) => engagement(item).some((n) => n >= threshold)) : [];
      return newest(popular.length > 0 ? popular : items, at);
    };
    const cards: { timestamp: number; card: HomeActivityCardData }[] = [];

    const post = pick(
      posts.filter((p) => p.category !== 'EVENT' && p.author_id !== me),
      (p) => p.created_at,
      (p) => [p.like_count, p.reply_count]
    );
    if (post) {
      cards.push({
        timestamp: new Date(post.created_at).getTime(),
        card: {
          key: `post-${post.id}`,
          label: post.category,
          title: post.title || post.body?.slice(0, 60) || 'Untitled',
          caption: post.title ? post.body : null,
          authorUsername: post.author_username,
          authorId: post.author_id,
          mediaFileName: post.media_file_name,
          onPress: () => router.push({ pathname: '/post/[id]', params: { id: post.id } }),
        },
      });
    }

    // `events` (upcoming) ∪ EVENT-category `posts` not already in it.
    const eventIds = new Set(events.map((e) => e.id));
    const event = pick(
      [...events, ...posts.filter((p) => p.category === 'EVENT' && !eventIds.has(p.id))].filter((e) => e.author_id !== me),
      (e) => e.created_at,
      (e) => [e.like_count, e.reply_count]
    );
    if (event) {
      cards.push({
        timestamp: new Date(event.created_at).getTime(),
        card: {
          key: `event-${event.id}`,
          label: 'Event',
          title: event.title ?? 'Event',
          caption: event.body,
          authorUsername: event.author_username,
          authorId: event.author_id,
          mediaFileName: event.media_file_name,
          // The pin a "Create an event" flow linked to this post, else one whose
          // title matches the event's location text (same rule as
          // components/event-atlas-link.tsx); otherwise the card geocodes it.
          eventVisual: {
            location: event.event_location,
            pin:
              atlasPins.find((p) => p.event_post_id === event.id) ??
              (event.event_location
                ? (atlasPins.find((p) => p.title.trim().toLowerCase() === event.event_location!.trim().toLowerCase()) ?? null)
                : null),
          },
          onPress: () => router.push({ pathname: '/post/[id]', params: { id: event.id } }),
        },
      });
    }

    const pin = pick(
      atlasPins.filter((p) => p.author_id !== me),
      (p) => p.created_at,
      (p) => [p.reply_count]
    );
    if (pin) {
      cards.push({
        timestamp: new Date(pin.created_at).getTime(),
        card: {
          key: `pin-${pin.id}`,
          label: ATLAS_CATEGORIES[pin.category]?.label ?? 'Atlas Pin',
          title: pin.title,
          caption: pin.description,
          authorUsername: pin.author_username,
          authorId: pin.author_id,
          mediaFileName: pin.image_file_name,
          atlasPin: pin,
          onPress: () => router.push({ pathname: '/atlas/[id]', params: { id: pin.id } }),
        },
      });
    }

    const listing = pick(
      listings.filter((l) => !myVendorId || l.vendor_id !== myVendorId),
      (l) => l.created_at
    );
    if (listing) {
      cards.push({
        timestamp: new Date(listing.created_at).getTime(),
        card: {
          key: `listing-${listing.id}`,
          label: 'Marketplace',
          title: listing.title,
          caption: listing.description,
          authorUsername: null,
          mediaFileName: listing.image_file_name,
          mediaIsPublic: false,
          placeholder: categoryMeta(listing.category),
          vendor: { id: listing.vendor_id, name: listing.vendor_name, logoFileName: listing.vendor_logo_file_name },
          onPress: () => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } }),
        },
      });
    }

    // Initiative activity rows only carry a free-text actor_name (no user id),
    // so "mine" is a best-effort match on username/display name.
    const update = pick(
      initiativeUpdates.filter((u) => !u.entry.actor_name || !myNames.includes(u.entry.actor_name.trim().toLowerCase())),
      (u) => u.entry.created_at
    );
    if (update) {
      cards.push({
        timestamp: new Date(update.entry.created_at).getTime(),
        card: {
          key: `initiative-${update.entry.id}`,
          label: 'Initiative',
          title: update.entry.text,
          caption: update.initiativeTitle,
          authorUsername: null,
          initiativeVisual: {
            id: update.initiativeId,
            category: update.initiativeCategory,
            colorName: update.initiativeColorName,
            hasBannerImage: update.hasBannerImage,
          },
          onPress: () => router.push(initiativeActivityHref(update.initiativeId, update.entry.kind, update.taskId)),
        },
      });
    }

    return cards.sort((a, b) => b.timestamp - a.timestamp).map((c) => c.card);
  }, [posts, events, atlasPins, listings, initiativeUpdates, memberCount, myVendorId, session?.userId, session?.username, session?.displayName]);

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

        {SHOW_QUICK_ACTIONS && (
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
        )}

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
          <View style={styles.cardList}>
            {latestCards.length === 0
              ? !loading && <ThemedText style={styles.rowMeta}>No activity yet.</ThemedText>
              : latestCards.map((card) => (
                  <HomeActivityCard
                    key={card.key}
                    card={card}
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
                    currentUserId={session.userId}
                  />
                ))}
          </View>
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
  cardList: {
    paddingHorizontal: 20,
    gap: 14,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
});
