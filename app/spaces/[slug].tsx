import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, useWindowDimensions, View } from 'react-native';

import { LiveCard } from '@/components/comms/live-card';
import { MinimizedBroadcastBar } from '@/components/comms/minimized-broadcast-bar';
import { SpaceInitiativeCard } from '@/components/initiative-update-card';
import { PostRow } from '@/components/post-row';
import { SpaceEventComposer, SpacePostComposer } from '@/components/space-composer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteSpace,
  getInitiative,
  getInitiativeActivity,
  getSpace,
  joinSpace,
  leaveSpace,
  listInitiatives,
  listLiveComms,
  listSpaceFiles,
  listSpacePosts,
  spaceBannerUrl,
  toggleLike,
  toggleRsvp,
  updateSpace,
} from '@/lib/api/hubService';
import { HubPost, Initiative, InitiativeActivityEntry, LiveCommsItem, Space, SpaceFile, SpaceVisibility } from '@/lib/api/types';
import { flushWriteQueue, voteOrQueue } from '@/lib/api/write-queue';
import { useBroadcast } from '@/lib/comms/broadcast-context';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { initiativeActivityIcon } from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';
import { SPACE_CATEGORY_FILTERS, spaceCategoryMeta, spaceVisibilityMeta } from '@/lib/spaces/meta';
import { confirmDestructive } from '@/lib/ui/confirm';
import { formatEventWhen } from '@/lib/ui/format-event';
import { applyVote } from '@/lib/ui/poll';
import { usePostConsumption } from '@/lib/ui/post-consumption';
import { timeAgo } from '@/lib/ui/time-ago';

type TabId = 'posts' | 'events' | 'initiatives' | 'files' | 'settings';

// The fifth tab the original spec called for — deferred until now since only
// four had confirmed queries at the time. Appended only for an admin/owner
// viewer (see the isAdmin-gated push into visibleTabs below), matching
// citinet-web's own SpacesScreen (`tabs = [...4 tabs, ...(isAdmin ?
// ['settings'] : [])]`).
const TABS: { id: TabId; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'events', label: 'Events' },
  { id: 'initiatives', label: 'Initiatives' },
  { id: 'files', label: 'Files' },
];

// Same fixed swatch sets as citinet-web's own BANNER_SOLID_COLORS/
// BANNER_GRADIENTS (SpacesScreen.tsx) — a small curated palette rather than a
// full custom color picker, matching that screen's own UI exactly.
const BANNER_SOLID_COLORS = ['#0f766e', '#0369a1', '#1d4ed8', '#6d28d9', '#be123c', '#b45309', '#374151'];
const BANNER_GRADIENTS: { from: string; to: string }[] = [
  { from: '#2563eb', to: '#7c3aed' },
  { from: '#0f766e', to: '#2563eb' },
  { from: '#be123c', to: '#7c2d12' },
  { from: '#1d4ed8', to: '#0f766e' },
  { from: '#c2410c', to: '#be123c' },
  { from: '#374151', to: '#111827' },
  { from: '#7c3aed', to: '#ec4899' },
  { from: '#065f46', to: '#0f766e' },
];

// Visual-only per spec ("Only Posts and Initiatives are interactive... the
// rest are visual") — no tap-through, no RSVP button. Splits from the same
// listSpacePosts() fetch as the Posts tab (event_date IS NOT NULL).
function SpaceEventRow({ post }: { post: HubPost }) {
  return (
    <View style={styles.eventRow}>
      <ThemedText type="defaultSemiBold" numberOfLines={1}>
        {post.title || 'Event'}
      </ThemedText>
      {!!post.event_date && (
        <View style={styles.eventMetaLine}>
          <IconSymbol name="calendar" size={13} color={Brand} />
          <ThemedText style={[styles.eventMetaText, { color: Brand }]} numberOfLines={1}>
            {formatEventWhen(post.event_date)}
          </ThemedText>
        </View>
      )}
      {!!post.event_location && (
        <View style={styles.eventMetaLine}>
          <IconSymbol name="mappin.and.ellipse" size={13} color="#888" />
          <ThemedText style={styles.eventMetaText} numberOfLines={1}>
            {post.event_location}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

// Visual-only, same reasoning as SpaceEventRow — also sidesteps a real access
// gap: these files are uploaded is_public: false (see listSpaceFiles's own
// note), so a tap-through to the general files screen would 403/hide them
// for any member who isn't the uploader.
function SpaceFileRow({ file }: { file: SpaceFile }) {
  const kind = fileKind(file.file_name, file.mime_type);
  const meta = FILE_KIND_META[kind];
  return (
    <View style={styles.fileRow}>
      <View style={[styles.fileIcon, { backgroundColor: meta.color }]}>
        <IconSymbol name={meta.icon} size={16} color="#fff" />
      </View>
      <View style={styles.fileContent}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {file.file_name}
        </ThemedText>
        <ThemedText style={styles.fileMeta} numberOfLines={1}>
          {formatBytes(file.size_bytes)} · {timeAgo(file.uploaded_at)}
          {file.uploaded_by ? ` · @${file.uploaded_by}` : ''}
        </ThemedText>
      </View>
    </View>
  );
}

// One activity row from this space's own initiatives (Initiative.space_id),
// paired with enough of its parent to render without a second lookup —
// mirrors citinet-web's own SpacesScreen (SpaceInitiativeActivityItem/
// InitiativeActivityCard): that screen merges initiative activity straight
// into its Feed tab's chronological post list, styled as a feed row, so a
// space member sees "someone completed a task" alongside the space's own
// posts instead of only inside each initiative individually. Ported here
// scoped to the Posts tab specifically (this app splits Posts/Events into
// separate tabs where web has one combined Feed).
type SpaceInitiativeActivityItem = InitiativeActivityEntry & { initiativeId: string; initiativeTitle: string };

async function fetchSpaceInitiativeActivity(tunnelUrl: string, token: string, initiatives: Initiative[]): Promise<SpaceInitiativeActivityItem[]> {
  const perInitiative = await Promise.all(
    initiatives.map((initiative) =>
      getInitiativeActivity(tunnelUrl, token, initiative.id, 5)
        .then((entries) => entries.map((entry) => ({ ...entry, initiativeId: initiative.id, initiativeTitle: initiative.title })))
        .catch(() => [] as SpaceInitiativeActivityItem[])
    )
  );
  return perInitiative.flat();
}

// Same "immutable log, not a live status snapshot" caveat as citinet-web's
// own InitiativeActivityCard — an entry's sentence stays exactly as written
// even after the task/resource it describes changes state again.
function SpaceInitiativeActivityRow({ item, onPress }: { item: SpaceInitiativeActivityItem; onPress: () => void }) {
  return (
    <Pressable style={styles.fileRow} onPress={onPress}>
      <View style={[styles.fileIcon, { backgroundColor: Brand }]}>
        <IconSymbol name={initiativeActivityIcon(item.kind)} size={16} color="#fff" />
      </View>
      <View style={styles.fileContent}>
        <ThemedText numberOfLines={2}>
          <ThemedText type="defaultSemiBold">{item.actor_name || 'Someone'}</ThemedText> {item.text}
        </ThemedText>
        <ThemedText style={styles.fileMeta} numberOfLines={1}>
          on {item.initiativeTitle} · {timeAgo(item.created_at)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function SpaceScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { session } = useSession();
  const { markEngaged } = usePostConsumption();
  // Explicit width AND height, not width+aspectRatio — confirmed by a debug
  // swap to Home's own InitiativeUpdateCard (identical underlying
  // InitiativeCoverCard, default fixed-150/aspectRatio:3:5 sizing, plain
  // horizontal ScrollView container) that the card itself renders fine;
  // only this screen's own 2-column attempt (a flexWrap grid + a width/
  // aspectRatio style override) came out collapsed to zero height. aspectRatio
  // combined with flexWrap is a known-flaky pairing in RN's layout engine —
  // two concrete numbers sidesteps it rather than trying to get Yoga to
  // resolve one from the other. content's own paddingHorizontal (20) and
  // initiativeGrid's own gap (10) are subtracted so two cards plus the one
  // gap between them exactly fill the row.
  const { width: windowWidth } = useWindowDimensions();
  const initiativeCardWidth = (windowWidth - 20 * 2 - 10) / 2;
  const initiativeCardHeight = initiativeCardWidth * (5 / 4); // 4:5 width:height

  const [space, setSpace] = useState<Space | null>(null);
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [spaceInitiatives, setSpaceInitiatives] = useState<Initiative[]>([]);
  const [initiativeActivity, setInitiativeActivity] = useState<SpaceInitiativeActivityItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Settings tab (admin/owner only, see isAdmin below) — seeded from `space`
  // once it first loads (the effect below), not on every reload, so a saved-
  // but-not-yet-reflected edit or an in-progress draft never gets clobbered
  // by this same screen's own focus-triggered refetch.
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsVisibility, setSettingsVisibility] = useState<SpaceVisibility>('public');
  const [settingsCategory, setSettingsCategory] = useState('');
  const [settingsWebPublic, setSettingsWebPublic] = useState(false);
  const [settingsSeeded, setSettingsSeeded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingBanner, setSavingBanner] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState(false);

  // Space-scoped "Live now" — same shape/flow as app/(tabs)/messages.tsx's
  // own hub-wide live strip, just fed via listLiveComms's spaceSlug param
  // (GET /api/comms/live?space_slug=X, membership-checked server-side) so a
  // broadcast started here never leaks into the hub-wide list and vice
  // versa. See messages.tsx for the fuller reasoning behind each piece below.
  const { broadcast, joinAsViewer, restore } = useBroadcast();
  const [spaceLive, setSpaceLive] = useState<LiveCommsItem[]>([]);
  // A room this device just left/ended, suppressed from the strip even if a
  // fetch still lists it — see messages.tsx's own justEndedRoomName for the
  // full race-condition reasoning.
  const [justEndedRoomName, setJustEndedRoomName] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session || !slug) return;
    setLoading(true);
    setError(null);
    // Opportunistic retry of anything queued (see lib/api/write-queue.ts) —
    // fire-and-forget, not sequenced ahead of the fetch below: a write this
    // sends will show up on this screen's next focus/refresh. A no-op, no
    // network call, when the queue's empty.
    flushWriteQueue().catch(() => {});
    getSpace(session.hub.tunnelUrl, session.token, slug)
      .then((nextSpace) => {
        setSpace(nextSpace);
        // Posts/files 403 ("Join this space to view...") for anyone who
        // isn't an active member — only fetched when that's true, matching
        // the server's own gate rather than firing a request expected to fail.
        const isActiveMember = nextSpace.my_status === 'active';
        return Promise.all([
          isActiveMember ? listSpacePosts(session.hub.tunnelUrl, session.token, slug).catch(() => []) : Promise.resolve([]),
          isActiveMember ? listSpaceFiles(session.hub.tunnelUrl, session.token, slug).catch(() => []) : Promise.resolve([]),
          // No server-side space_id filter on GET /api/initiatives (see
          // listInitiatives's own note) — fetch every hub initiative and
          // filter down client-side.
          listInitiatives(session.hub.tunnelUrl, session.token).catch(() => []),
        ]).then(([nextPosts, nextFiles, allInitiatives]) => {
          setPosts(nextPosts);
          setFiles(nextFiles);
          const nextSpaceInitiatives = allInitiatives.filter((i) => i.space_id === nextSpace.id);
          setSpaceInitiatives(nextSpaceInitiatives);
          // Fire-and-forget, not awaited alongside posts/files/initiatives
          // above — a per-initiative activity slice shouldn't hold up the
          // rest of the screen's load, same as citinet-web's own
          // fetchSpaceInitiativeActivity call (SpacesScreen.tsx).
          if (isActiveMember && nextSpaceInitiatives.length > 0) {
            fetchSpaceInitiativeActivity(session.hub.tunnelUrl, session.token, nextSpaceInitiatives)
              .then(setInitiativeActivity)
              .catch(() => setInitiativeActivity([]));
          } else {
            setInitiativeActivity([]);
          }
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this space."))
      .finally(() => setLoading(false));
  }, [session, slug]);

  useFocusEffect(load);

  useEffect(() => {
    if (!space || settingsSeeded) return;
    setSettingsName(space.name);
    setSettingsDescription(space.description ?? '');
    setSettingsVisibility(space.visibility);
    setSettingsCategory(space.category ?? '');
    setSettingsWebPublic(!!space.web_public);
    setSettingsSeeded(true);
  }, [space, settingsSeeded]);

  // Real fetch (GET /api/comms/live?space_slug=X) — gated on active
  // membership like posts/files above, matching the server's own gate
  // rather than firing a request expected to 403. `space` (not the
  // isActiveMember const below, which isn't computed until render) is read
  // directly since this is a plain callback, not JSX.
  const refreshSpaceLive = useCallback(() => {
    if (!session || !slug || space?.my_status !== 'active') return;
    listLiveComms(session.hub.tunnelUrl, session.token, slug).then((items) => {
      setSpaceLive(items);
      setJustEndedRoomName((prev) => (prev && !items.some((item) => item.room_name === prev) ? null : prev));
    });
  }, [session, slug, space?.my_status]);

  useFocusEffect(refreshSpaceLive);

  // Focus alone only catches a broadcast *this device* started/ended in
  // this space — polling every 15s while this screen is actually visible is
  // the low-effort middle ground for another device's new one, same as
  // messages.tsx's own identical tradeoff.
  useFocusEffect(
    useCallback(() => {
      const id = setInterval(refreshSpaceLive, 15000);
      return () => clearInterval(id);
    }, [refreshSpaceLive])
  );

  // Reacts to the phase transition directly (not just focus) so starting/
  // ending a broadcast without ever navigating away still updates this
  // screen's own live strip — see messages.tsx's own identical effect.
  useEffect(() => {
    if (broadcast.phase === 'live' || broadcast.phase === 'idle') refreshSpaceLive();
    if (broadcast.phase === 'ended' && broadcast.roomName) setJustEndedRoomName(broadcast.roomName);
  }, [broadcast.phase, broadcast.roomName, refreshSpaceLive]);

  // Synthesized straight from broadcast state rather than waited on
  // spaceLive (the fetch) — see messages.tsx's own identical myLiveItem for
  // the full reasoning (the tunnel round trip lands noticeably later than
  // on the web portal). Gated on spaceSlug matching this space specifically
  // — a hub-wide broadcast this device started shouldn't show up here.
  const myLiveItem = useMemo<LiveCommsItem | null>(() => {
    if (broadcast.phase !== 'live' || broadcast.role !== 'host' || !broadcast.roomName || broadcast.spaceSlug !== slug || !session) return null;
    return {
      kind: 'broadcast',
      room_name: broadcast.roomName,
      title: broadcast.title,
      host_id: session.userId,
      host_username: session.displayName,
      participant_count: 1,
    };
  }, [broadcast.phase, broadcast.role, broadcast.roomName, broadcast.spaceSlug, broadcast.title, slug, session]);

  // Computed once, used for both the "Live now" header's visibility and the
  // strip itself — see messages.tsx's own identical reasoning (ending your
  // only broadcast could otherwise leave the eyebrow showing over an empty
  // strip if these were filtered separately).
  const visibleSpaceLive = useMemo(() => {
    const source = myLiveItem && !spaceLive.some((item) => item.room_name === myLiveItem.room_name) ? [myLiveItem, ...spaceLive] : spaceLive;
    return source.filter(
      (item) =>
        item.room_name !== justEndedRoomName &&
        (item.host_id !== session?.userId || (broadcast.phase === 'live' && broadcast.roomName === item.room_name))
    );
  }, [spaceLive, myLiveItem, session, broadcast.phase, broadcast.roomName, justEndedRoomName]);

  function handleJoinPress() {
    if (!session || !space) return;
    if (space.my_status === 'active') {
      confirmDestructive(`Leave ${space.name}?`, 'Leave', () => {
        leaveSpace(session.hub.tunnelUrl, session.token, space.slug)
          .then(load)
          .catch((err) => setError(err instanceof Error ? err.message : "Couldn't leave this space."));
      });
      return;
    }
    // Pending is a quiet, non-destructive dead-end per spec — this handler
    // only reaches the join call for the true not-joined state.
    if (space.my_status === 'pending') return;
    setJoining(true);
    joinSpace(session.hub.tunnelUrl, session.token, space.slug)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't join this space."))
      .finally(() => setJoining(false));
  }

  // Server-gated to the space's own admins/owner (canManageSpace) — mirrored
  // here by only rendering the Settings tab at all when isAdmin.
  function saveSettings() {
    if (!session || !space || settingsSaving) return;
    setSettingsSaving(true);
    setSettingsSaved(false);
    setSettingsError(null);
    updateSpace(session.hub.tunnelUrl, session.token, space.slug, {
      name: settingsName.trim(),
      description: settingsDescription.trim(),
      visibility: settingsVisibility,
      category: settingsCategory,
      web_public: settingsWebPublic,
    })
      .then((updated) => {
        setSpace(updated);
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 2500);
      })
      .catch((err) => setSettingsError(err instanceof Error ? err.message : "Couldn't save those settings."))
      .finally(() => setSettingsSaving(false));
  }

  function saveBannerStyle(fields: { banner_mode: 'solid' | 'gradient'; banner_color?: string; banner_gradient_from?: string; banner_gradient_to?: string }) {
    if (!session || !space || savingBanner) return;
    setSavingBanner(true);
    updateSpace(session.hub.tunnelUrl, session.token, space.slug, fields)
      .then(setSpace)
      .catch((err) => setSettingsError(err instanceof Error ? err.message : "Couldn't update the banner."))
      .finally(() => setSavingBanner(false));
  }

  // Owner-only server-side (or a hub-level admin) — mirrored here by only
  // rendering the Delete button when space.my_role === 'owner'. Posts are
  // kept, just detached — see deleteSpace's own note.
  function handleDeleteSpace() {
    if (!session || !space || deletingSpace) return;
    confirmDestructive(`Delete ${space.name}? This can't be undone.`, 'Delete', () => {
      setDeletingSpace(true);
      deleteSpace(session.hub.tunnelUrl, session.token, space.slug)
        .then(() => router.back())
        .catch((err) => {
          setSettingsError(err instanceof Error ? err.message : "Couldn't delete this space.");
          setDeletingSpace(false);
        });
    });
  }

  function handleToggleLike(post: HubPost) {
    if (!session) return;
    markEngaged(post.id);
    const wasLiked = post.my_liked;
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, my_liked: !wasLiked, like_count: p.like_count + (wasLiked ? -1 : 1) } : p))
    );
    toggleLike(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, my_liked: wasLiked, like_count: post.like_count } : p)));
    });
  }

  function handleToggleRsvp(post: HubPost) {
    if (!session) return;
    markEngaged(post.id);
    const wasGoing = post.my_rsvp;
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, my_rsvp: !wasGoing, rsvp_count: p.rsvp_count + (wasGoing ? -1 : 1) } : p))
    );
    toggleRsvp(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, my_rsvp: wasGoing, rsvp_count: post.rsvp_count } : p)));
    });
  }

  function handleVotePoll(post: HubPost, optionIndex: number) {
    if (!session) return;
    markEngaged(post.id);
    const previousPoll = post.poll;
    setPosts((prev) => prev.map((p) => (p.id === post.id ? applyVote(p, optionIndex) : p)));
    voteOrQueue(session.hub.tunnelUrl, session.token, post.id, optionIndex).catch(() => {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, poll: previousPoll } : p)));
    });
  }

  function handleStartInitiative() {
    if (!space) return;
    // No 3-step create wizard exists anywhere in this app yet (design spec
    // assumes one; app/initiatives/create.tsx is a single real screen built
    // alongside this one — see its own note) — space_id prefill lands on
    // hub_initiative_meta.space_id via createInitiative, same field this
    // screen's own Initiatives filter reads.
    router.push({ pathname: '/initiatives/create', params: { spaceId: space.id, spaceName: space.name } });
  }

  // Same destination logic as Home's own initiativeActivityHref (app/(tabs)/
  // index.tsx), and matches citinet-web's own SpacesScreen openInitiativeActivity
  // — 'task' resolves to that specific task's tracker (best-effort, via
  // substring-matching this entry's sentence against the initiative's current
  // task titles, since the activity log carries no ref_id back to the task
  // itself), 'resource'/'team' go to their tab, and anything else (an
  // unresolved task match, or a future activity kind) falls back to the
  // initiative's own overview. Resolved on tap here rather than pre-resolved
  // during load (Home's approach) — this feed shows every entry as the
  // immutable log it is, unfiltered by current task/resource state, so
  // there's no already-fetched task list sitting around to reuse.
  async function openInitiativeActivity(item: SpaceInitiativeActivityItem) {
    if (!session) return;
    if (item.kind === 'task') {
      try {
        const initiative = await getInitiative(session.hub.tunnelUrl, session.token, item.initiativeId);
        const matchedTask = initiative.tasks.find((task) => item.text.includes(task.title));
        if (matchedTask) {
          router.push(`/initiatives/${item.initiativeId}/tasks/${matchedTask.id}` as unknown as Href);
          return;
        }
      } catch {
        // Falls through to the overview below.
      }
    } else if (item.kind === 'resource') {
      router.push(`/initiatives/${item.initiativeId}/resources` as unknown as Href);
      return;
    } else if (item.kind === 'team') {
      router.push(`/initiatives/${item.initiativeId}/team` as unknown as Href);
      return;
    }
    router.push({ pathname: '/initiatives/[id]', params: { id: item.initiativeId } });
  }

  if (!session) return null;

  const visibility = space ? spaceVisibilityMeta(space.visibility) : null;
  const isActiveMember = space?.my_status === 'active';
  const isPending = space?.my_status === 'pending';
  const isAdmin = space?.my_role === 'owner' || space?.my_role === 'admin';
  const visibleTabs = isAdmin ? [...TABS, { id: 'settings' as const, label: 'Settings' }] : TABS;
  const feedPosts = posts.filter((p) => !p.event_date);
  const eventPosts = posts.filter((p) => !!p.event_date);

  // Posts and this space's own initiative activity merged into one
  // chronological list, same idea as citinet-web's own SpacesScreen feedItems
  // — scoped to the Posts tab specifically since this app keeps Events as
  // its own tab where web folds everything into one Feed.
  type PostsFeedItem = { kind: 'post'; createdAt: string; post: HubPost } | { kind: 'activity'; createdAt: string; activity: SpaceInitiativeActivityItem };
  const postsFeedItems: PostsFeedItem[] = [
    ...feedPosts.map((post): PostsFeedItem => ({ kind: 'post', createdAt: post.created_at, post })),
    ...initiativeActivity.map((activity): PostsFeedItem => ({ kind: 'activity', createdAt: activity.created_at, activity })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <ThemedView style={styles.flex}>
      {loading && !space && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {/* Outside the ScrollView, not inside it — stays visible while
          scrolling posts, same as messages.tsx's own placement. Unlike that
          screen, this one has no header row of its own reserving safe-area
          space above the banner (the banner starts flush at the top; only
          its floating back/broadcast buttons account for the notch, via the
          same top:56 this wrap mirrors) — so this needs its own top margin
          or it renders flush under the status bar/notch. */}
      {broadcast.phase === 'live' && broadcast.minimized && (
        <View style={styles.minimizedBarWrap}>
          <MinimizedBroadcastBar onPress={restore} />
        </View>
      )}

      {space && visibility && (
        <ScrollView
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic">
          <View style={styles.banner}>
            {space.banner_mode === 'image' && space.banner_image_file_name ? (
              <Image
                source={{ uri: spaceBannerUrl(session.hub.tunnelUrl, space.slug) }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : space.banner_mode === 'gradient' && space.banner_gradient_from && space.banner_gradient_to ? (
              <LinearGradient
                colors={[space.banner_gradient_from, space.banner_gradient_to]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : space.banner_mode === 'solid' && space.banner_color ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: space.banner_color }]} />
            ) : (
              // Default for a space with no banner_mode set at all — "Currently
              // mocked as teal→brand gradient" per spec.
              <LinearGradient colors={['#0d9488', Brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={styles.backButton}
              accessibilityLabel="Back"
              accessibilityRole="button">
              <BlurView intensity={40} tint="light" style={[StyleSheet.absoluteFill, styles.backButtonBlur]} />
              <IconSymbol name="chevron.left" size={20} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <ThemedText style={styles.spaceName} numberOfLines={2}>
                {space.name}
              </ThemedText>
              <View style={styles.visibilityBadge}>
                <IconSymbol name={visibility.icon} size={12} color={Brand} />
                <ThemedText style={[styles.visibilityLabel, { color: Brand }]}>{visibility.label}</ThemedText>
              </View>
            </View>

            {!!space.description?.trim() && <ThemedText style={styles.description}>{space.description}</ThemedText>}

            <View style={styles.metaRow}>
              <ThemedText style={styles.metaItem}>
                <ThemedText type="defaultSemiBold">{Number(space.member_count) || 0}</ThemedText> neighbors
              </ThemedText>
              <ThemedText style={styles.metaItem}>
                <ThemedText type="defaultSemiBold">{space.post_count}</ThemedText> posts
              </ThemedText>
            </View>

            <View style={styles.actionRow}>
              {isActiveMember ? (
                <Pressable onPress={handleJoinPress} style={[styles.joinButton, styles.joinButtonActive, styles.joinButtonFlex]}>
                  <ThemedText type="defaultSemiBold" style={[styles.joinButtonLabel, { color: Colors[colorScheme].text }]}>
                    Joined ✓
                  </ThemedText>
                </Pressable>
              ) : isPending ? (
                // Quiet, outlined, non-destructive to tap — literally not even
                // a Pressable, so there's nothing a stray tap could trigger.
                <View style={[styles.joinButton, styles.joinButtonPending, styles.joinButtonFlex]}>
                  <ThemedText type="defaultSemiBold" style={[styles.joinButtonLabel, { color: Brand }]}>
                    Requested
                  </ThemedText>
                </View>
              ) : (
                <Pressable
                  onPress={handleJoinPress}
                  disabled={joining}
                  style={[styles.joinButton, styles.joinButtonFlex, { backgroundColor: Brand, opacity: joining ? 0.6 : 1 }]}>
                  <ThemedText type="defaultSemiBold" style={styles.joinButtonLabel} lightColor="#fff" darkColor="#fff">
                    Join
                  </ThemedText>
                </Pressable>
              )}
              {/* Right next to the Joined pill — the button the user actually
                  scans this row for — rather than a floating icon over the
                  banner, easy to miss on first visit. Same server-side gate
                  as before (POST /api/comms/token 403s a space_slug for
                  anyone who isn't an active member). */}
              {isActiveMember && (
                <Pressable
                  onPress={() => router.push({ pathname: '/broadcast/setup', params: { spaceSlug: space.slug, spaceName: space.name } })}
                  style={styles.broadcastPill}
                  accessibilityLabel="Broadcast to this space"
                  accessibilityRole="button">
                  <IconSymbol name="dot.radiowaves.left.and.right" size={16} color="#fff" />
                  <ThemedText type="defaultSemiBold" style={styles.broadcastPillLabel} lightColor="#fff" darkColor="#fff">
                    Go live
                  </ThemedText>
                </Pressable>
              )}
            </View>

            {/* Visible regardless of which tab is active — same reasoning
                as messages.tsx's own "Live now" strip sitting above (not
                inside) any one list. */}
            {isActiveMember && visibleSpaceLive.length > 0 && (
              <View style={styles.liveSection}>
                <View style={styles.liveEyebrowRow}>
                  <View style={styles.liveDot} />
                  <ThemedText style={styles.eyebrow}>Live now</ThemedText>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveStrip}>
                  {visibleSpaceLive.map((item) => {
                    // A card for the broadcast I'm already in (as host or as
                    // a joined viewer/guest, just minimized) must restore
                    // that session, not start a fresh join — same reasoning
                    // as messages.tsx's own isMine.
                    const isMine = broadcast.phase === 'live' && broadcast.roomName === item.room_name;
                    return (
                      <LiveCard
                        key={item.room_name}
                        item={item}
                        onPress={item.kind === 'broadcast' ? (isMine ? restore : () => joinAsViewer(item)) : undefined}
                        showPreview={item.kind === 'broadcast' && !isMine}
                      />
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
              {visibleTabs.map((tab) => {
                const active = tab.id === activeTab;
                const label =
                  tab.id === 'initiatives' && spaceInitiatives.length > 0 ? `${tab.label} (${spaceInitiatives.length})` : tab.label;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => setActiveTab(tab.id)}
                    style={[styles.tabPill, active && { backgroundColor: Colors[colorScheme].text }]}>
                    <ThemedText
                      style={styles.tabLabel}
                      lightColor={active ? Colors.light.background : undefined}
                      darkColor={active ? Colors.dark.background : undefined}>
                      {label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {activeTab === 'initiatives' && (
              <Pressable onPress={handleStartInitiative} style={styles.startInitiativeRow}>
                <View style={styles.startInitiativeIcon}>
                  <IconSymbol name="target" size={18} color={Brand} />
                </View>
                <ThemedText type="defaultSemiBold" style={styles.startInitiativeLabel}>
                  Start an initiative here
                </ThemedText>
                <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
              </Pressable>
            )}

            {!isActiveMember && activeTab !== 'initiatives' && (
              <ThemedText style={styles.joinPrompt}>Join this space to see its {activeTab}.</ThemedText>
            )}

            {isActiveMember && activeTab === 'posts' && (
              <>
                <View style={styles.composerWrap}>
                  <SpacePostComposer tunnelUrl={session.hub.tunnelUrl} token={session.token} spaceSlug={space.slug} onPosted={load} />
                </View>
                {postsFeedItems.map((item) =>
                  item.kind === 'activity' ? (
                    <SpaceInitiativeActivityRow
                      key={`activity-${item.activity.id}`}
                      item={item.activity}
                      onPress={() => openInitiativeActivity(item.activity)}
                    />
                  ) : (
                    <PostRow
                      key={item.post.id}
                      post={item.post}
                      tunnelUrl={session.hub.tunnelUrl}
                      token={session.token}
                      onToggleLike={handleToggleLike}
                      onVotePoll={handleVotePoll}
                      onToggleRsvp={handleToggleRsvp}
                    />
                  )
                )}
                {postsFeedItems.length === 0 && <ThemedText style={styles.emptyState}>No posts yet.</ThemedText>}
              </>
            )}

            {isActiveMember && activeTab === 'events' && (
              <>
                <View style={styles.composerWrap}>
                  <SpaceEventComposer tunnelUrl={session.hub.tunnelUrl} token={session.token} spaceSlug={space.slug} onPosted={load} />
                </View>
                {eventPosts.map((post) => (
                  <SpaceEventRow key={post.id} post={post} />
                ))}
                {eventPosts.length === 0 && <ThemedText style={styles.emptyState}>No events yet.</ThemedText>}
              </>
            )}

            {/* Not gated behind isActiveMember, unlike Posts/Events/Files —
                spaceInitiatives comes from a hub-wide listInitiatives call
                filtered client-side (see load()'s own note), never from a
                space-membership-gated endpoint, so a non-member could always
                see these, same as before this tab stopped navigating away. */}
            {activeTab === 'initiatives' && (
              <>
                {spaceInitiatives.length > 0 && (
                  <View style={styles.initiativeGrid}>
                    {spaceInitiatives.map((initiative) => (
                      <SpaceInitiativeCard
                        key={initiative.id}
                        initiative={initiative}
                        tunnelUrl={session.hub.tunnelUrl}
                        onPress={() => router.push({ pathname: '/initiatives/[id]', params: { id: initiative.id } })}
                        style={{ width: initiativeCardWidth, height: initiativeCardHeight, aspectRatio: undefined }}
                      />
                    ))}
                  </View>
                )}
                {spaceInitiatives.length === 0 && <ThemedText style={styles.emptyState}>No initiatives yet.</ThemedText>}
              </>
            )}

            {isActiveMember && activeTab === 'files' && (
              <>
                {files.map((file) => (
                  <SpaceFileRow key={file.id} file={file} />
                ))}
                {files.length === 0 && <ThemedText style={styles.emptyState}>No files yet.</ThemedText>}
              </>
            )}

            {/* Gated on isAdmin at the tab-list level (visibleTabs above) —
                re-checked here too since activeTab is plain state that could
                in principle still be 'settings' from a moment before a role
                actually changed. */}
            {activeTab === 'settings' && isAdmin && (
              <View style={styles.settingsSection}>
                <ThemedText style={styles.settingsLabel}>Banner style</ThemedText>
                <ThemedText style={styles.settingsSwatchGroupLabel}>Solid colors</ThemedText>
                <View style={styles.swatchRow}>
                  {BANNER_SOLID_COLORS.map((color) => (
                    <Pressable
                      key={color}
                      disabled={savingBanner}
                      onPress={() => saveBannerStyle({ banner_mode: 'solid', banner_color: color })}
                      style={[styles.solidSwatch, { backgroundColor: color }]}
                    />
                  ))}
                </View>
                <ThemedText style={styles.settingsSwatchGroupLabel}>Gradients</ThemedText>
                <View style={styles.swatchRow}>
                  {BANNER_GRADIENTS.map((g, i) => (
                    <Pressable key={i} disabled={savingBanner} onPress={() => saveBannerStyle({ banner_mode: 'gradient', banner_gradient_from: g.from, banner_gradient_to: g.to })}>
                      <LinearGradient colors={[g.from, g.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradientSwatch} />
                    </Pressable>
                  ))}
                </View>

                <ThemedText style={[styles.settingsLabel, styles.settingsLabelSpaced]}>Space name</ThemedText>
                <TextInput
                  value={settingsName}
                  onChangeText={setSettingsName}
                  style={[styles.settingsInput, { color: Colors[colorScheme].text }]}
                />

                <ThemedText style={[styles.settingsLabel, styles.settingsLabelSpaced]}>Description</ThemedText>
                <TextInput
                  value={settingsDescription}
                  onChangeText={setSettingsDescription}
                  multiline
                  style={[styles.settingsInput, styles.settingsTextarea, { color: Colors[colorScheme].text }]}
                />

                <ThemedText style={[styles.settingsLabel, styles.settingsLabelSpaced]}>Visibility</ThemedText>
                <View style={styles.visibilityRow}>
                  {(
                    [
                      { value: 'public', label: 'Public' },
                      { value: 'private', label: 'Private' },
                      { value: 'invite-only', label: 'Invite only' },
                    ] as const
                  ).map((opt) => {
                    const active = settingsVisibility === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setSettingsVisibility(opt.value)}
                        style={[styles.visibilityChip, active && { backgroundColor: Brand }]}>
                        <ThemedText style={styles.visibilityChipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                          {opt.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <ThemedText style={[styles.settingsLabel, styles.settingsLabelSpaced]}>Category</ThemedText>
                <ThemedText style={styles.settingsHint}>Helps neighbors find it in Discover</ThemedText>
                <View style={styles.categoryRow}>
                  <Pressable
                    onPress={() => setSettingsCategory('')}
                    style={[styles.categoryChip, settingsCategory === '' && { backgroundColor: Brand }]}>
                    <ThemedText style={styles.categoryChipLabel} lightColor={settingsCategory === '' ? '#fff' : undefined} darkColor={settingsCategory === '' ? '#fff' : undefined}>
                      None
                    </ThemedText>
                  </Pressable>
                  {SPACE_CATEGORY_FILTERS.filter((c) => c.value !== 'all').map((c) => {
                    const active = settingsCategory === c.value;
                    const meta = spaceCategoryMeta(c.value);
                    return (
                      <Pressable key={c.value} onPress={() => setSettingsCategory(c.value)} style={[styles.categoryChip, active && { backgroundColor: Brand }]}>
                        {meta && <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />}
                        <ThemedText style={styles.categoryChipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                          {c.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.webPublicRow, styles.settingsLabelSpaced]}>
                  <View style={styles.webPublicText}>
                    <ThemedText type="defaultSemiBold" style={styles.settingsLabel}>
                      Share to open web
                    </ThemedText>
                    <ThemedText style={styles.settingsHint}>Anyone with the link can read this space, no hub account needed.</ThemedText>
                  </View>
                  <Switch value={settingsWebPublic} onValueChange={setSettingsWebPublic} trackColor={{ true: Brand }} />
                </View>

                {settingsError && <ThemedText style={styles.settingsError}>{settingsError}</ThemedText>}

                <Pressable style={[styles.saveSettingsButton, settingsSaving && { opacity: 0.6 }]} disabled={settingsSaving} onPress={saveSettings}>
                  <ThemedText type="defaultSemiBold" style={styles.saveSettingsLabel} lightColor="#fff" darkColor="#fff">
                    {settingsSaving ? 'Saving…' : settingsSaved ? 'Saved ✓' : 'Save settings'}
                  </ThemedText>
                </Pressable>

                {space.my_role === 'owner' && (
                  <Pressable style={styles.deleteSpaceButton} disabled={deletingSpace} onPress={handleDeleteSpace}>
                    <ThemedText style={[styles.deleteSpaceLabel, { color: '#dc2626' }]}>{deletingSpace ? 'Deleting…' : 'Delete space'}</ThemedText>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  spinner: {
    marginTop: 80,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginTop: 40,
  },
  scrollBody: {
    paddingBottom: 40,
  },
  banner: {
    height: 150,
  },
  // Positioning matches this app's one other full-bleed floating back button
  // (atlas/panoramax-view.tsx's closeButton) for visual consistency between
  // the two full-bleed overlay contexts.
  backButton: {
    position: 'absolute',
    top: 56,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonBlur: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  minimizedBarWrap: {
    marginTop: 56,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  spaceName: {
    flex: 1,
    fontFamily: Fonts?.serif,
    fontSize: 24,
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginTop: 4,
  },
  visibilityLabel: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  description: {
    fontSize: 14,
    lineHeight: 21.7, // 14 * 1.55
    marginTop: 10,
    opacity: 0.85,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
  },
  metaItem: {
    fontSize: 14,
    opacity: 0.6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  joinButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonFlex: {
    flex: 1,
  },
  joinButtonActive: {
    backgroundColor: '#8882',
  },
  joinButtonPending: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand,
    backgroundColor: 'transparent',
  },
  joinButtonLabel: {
    fontSize: 15.5,
  },
  // Same red as the LIVE badge on LiveCard/the minimized bar's dot — a
  // filled pill rather than a bare icon circle, so a first-time visitor
  // scanning this row for "how do I join in" actually notices it next to
  // the Joined pill instead of hunting the banner corners.
  broadcastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#DC2B2B',
  },
  broadcastPillLabel: {
    fontSize: 14.5,
  },
  tabRow: {
    gap: 8,
    paddingVertical: 4,
    marginTop: 20,
  },
  tabPill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  tabLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  startInitiativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    marginTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  startInitiativeIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand + '1a',
  },
  startInitiativeLabel: {
    flex: 1,
    fontSize: 15,
  },
  joinPrompt: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 20,
    textAlign: 'center',
  },
  emptyState: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 20,
    textAlign: 'center',
  },
  eventRow: {
    paddingVertical: 14,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  eventMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventMetaText: {
    fontSize: 13,
    opacity: 0.7,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileContent: {
    flex: 1,
    gap: 2,
  },
  fileMeta: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  // Fixed 2 columns, not an auto-wrapping strip of Home's own fixed-150px
  // cards — this tab is the full listing (not a capped teaser), so it reads
  // better as a real grid than a horizontally-scrolling row. width/height are
  // computed per-render (initiativeCardWidth/Height, above) and merged into
  // each SpaceInitiativeCard's own style prop at the call site.
  initiativeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  composerWrap: {
    marginTop: 4,
    marginBottom: 14,
  },
  // Same eyebrow/dot/strip treatment as app/(tabs)/messages.tsx's own
  // "Live now" section (styles duplicated, not shared — three small
  // generic label/dot styles, not worth a shared file the way LiveCard/
  // MinimizedBroadcastBar's real behavior was).
  liveSection: {
    marginTop: 16,
  },
  liveEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2B2B',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
  },
  liveStrip: {
    gap: 10,
    paddingVertical: 4,
  },
  settingsSection: {
    marginTop: 4,
  },
  settingsLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  settingsLabelSpaced: {
    marginTop: 20,
  },
  settingsSwatchGroupLabel: {
    fontSize: 11.5,
    opacity: 0.55,
    marginTop: 10,
    marginBottom: 6,
  },
  settingsHint: {
    fontSize: 11.5,
    opacity: 0.55,
    marginTop: 2,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  solidSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#8884',
  },
  gradientSwatch: {
    width: 56,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#8884',
  },
  settingsInput: {
    marginTop: 6,
    fontSize: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#8882',
  },
  settingsTextarea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  visibilityChip: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#8881',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityChipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  categoryChipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  webPublicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#8881',
  },
  webPublicText: {
    flex: 1,
    gap: 2,
  },
  settingsError: {
    color: '#b0392f',
    fontSize: 12.5,
    marginTop: 12,
  },
  saveSettingsButton: {
    height: 44,
    borderRadius: 12,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveSettingsLabel: {
    fontSize: 14.5,
  },
  deleteSpaceButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    paddingTop: 24,
  },
  deleteSpaceLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
