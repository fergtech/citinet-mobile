import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';

import { PostRow } from '@/components/post-row';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getSpace,
  joinSpace,
  leaveSpace,
  listInitiatives,
  listSpaceFiles,
  listSpacePosts,
  spaceBannerUrl,
  toggleLike,
  toggleRsvp,
  votePoll,
} from '@/lib/api/hubService';
import { HubPost, Initiative, Space, SpaceFile } from '@/lib/api/types';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { spaceVisibilityMeta } from '@/lib/spaces/meta';
import { useSession } from '@/lib/session/session-context';
import { confirmDestructive } from '@/lib/ui/confirm';
import { formatEventWhen } from '@/lib/ui/format-event';
import { applyVote } from '@/lib/ui/poll';
import { timeAgo } from '@/lib/ui/time-ago';

type TabId = 'posts' | 'events' | 'initiatives' | 'files';

// Spec calls for "five tabs" but only documents real queries for four
// (Posts/Events/Initiatives/Files) — building exactly the four that are
// actually specified rather than guessing at a fifth.
const TABS: { id: TabId; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'events', label: 'Events' },
  { id: 'initiatives', label: 'Initiatives' },
  { id: 'files', label: 'Files' },
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

export default function SpaceScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { session } = useSession();

  const [space, setSpace] = useState<Space | null>(null);
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [spaceInitiatives, setSpaceInitiatives] = useState<Initiative[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    if (!session || !slug) return;
    setLoading(true);
    setError(null);
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
          setSpaceInitiatives(allInitiatives.filter((i) => i.space_id === nextSpace.id));
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this space."))
      .finally(() => setLoading(false));
  }, [session, slug]);

  useFocusEffect(load);

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

  function handleToggleLike(post: HubPost) {
    if (!session) return;
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
    const previousPoll = post.poll;
    setPosts((prev) => prev.map((p) => (p.id === post.id ? applyVote(p, optionIndex) : p)));
    votePoll(session.hub.tunnelUrl, session.token, post.id, optionIndex).catch(() => {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, poll: previousPoll } : p)));
    });
  }

  function handleTabPress(tab: TabId) {
    if (tab === 'initiatives') {
      // Spec: "Initiatives ... (wired: navigates to the Initiatives list)" —
      // unlike Posts/Events/Files this tab isn't an inline pane at all, it's
      // a real navigation away from this screen. That IS this tab's
      // "interactive" per spec's "Only Posts and Initiatives are interactive."
      router.push('/initiatives' as Href);
      return;
    }
    setActiveTab(tab);
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

  if (!session) return null;

  const visibility = space ? spaceVisibilityMeta(space.visibility) : null;
  const isActiveMember = space?.my_status === 'active';
  const isPending = space?.my_status === 'pending';
  const feedPosts = posts.filter((p) => !p.event_date);
  const eventPosts = posts.filter((p) => !!p.event_date);

  return (
    <ThemedView style={styles.flex}>
      {loading && !space && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {space && visibility && (
        <ScrollView contentContainerStyle={styles.scrollBody}>
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

            {isActiveMember ? (
              <Pressable onPress={handleJoinPress} style={[styles.joinButton, styles.joinButtonActive]}>
                <ThemedText type="defaultSemiBold" style={[styles.joinButtonLabel, { color: Colors[colorScheme].text }]}>
                  Joined ✓
                </ThemedText>
              </Pressable>
            ) : isPending ? (
              // Quiet, outlined, non-destructive to tap — literally not even
              // a Pressable, so there's nothing a stray tap could trigger.
              <View style={[styles.joinButton, styles.joinButtonPending]}>
                <ThemedText type="defaultSemiBold" style={[styles.joinButtonLabel, { color: Brand }]}>
                  Requested
                </ThemedText>
              </View>
            ) : (
              <Pressable
                onPress={handleJoinPress}
                disabled={joining}
                style={[styles.joinButton, { backgroundColor: Brand, opacity: joining ? 0.6 : 1 }]}>
                <ThemedText type="defaultSemiBold" style={styles.joinButtonLabel} lightColor="#fff" darkColor="#fff">
                  Join
                </ThemedText>
              </Pressable>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
              {TABS.map((tab) => {
                const active = tab.id === activeTab;
                // spaceInitiatives is otherwise only used for the tab's own
                // "wired: navigates to the Initiatives list" behavior — this
                // count is what makes that query's result actually visible
                // on this screen rather than fetched and thrown away.
                const label =
                  tab.id === 'initiatives' && spaceInitiatives.length > 0 ? `${tab.label} (${spaceInitiatives.length})` : tab.label;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => handleTabPress(tab.id)}
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

            <Pressable onPress={handleStartInitiative} style={styles.startInitiativeRow}>
              <View style={styles.startInitiativeIcon}>
                <IconSymbol name="target" size={18} color={Brand} />
              </View>
              <ThemedText type="defaultSemiBold" style={styles.startInitiativeLabel}>
                Start an initiative here
              </ThemedText>
              <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
            </Pressable>

            {!isActiveMember && activeTab !== 'initiatives' && (
              <ThemedText style={styles.joinPrompt}>Join this space to see its {activeTab}.</ThemedText>
            )}

            {isActiveMember && activeTab === 'posts' && (
              <>
                {feedPosts.map((post) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
                    onToggleLike={handleToggleLike}
                    onVotePoll={handleVotePoll}
                    onToggleRsvp={handleToggleRsvp}
                  />
                ))}
                {feedPosts.length === 0 && <ThemedText style={styles.emptyState}>No posts yet.</ThemedText>}
              </>
            )}

            {isActiveMember && activeTab === 'events' && (
              <>
                {eventPosts.map((post) => (
                  <SpaceEventRow key={post.id} post={post} />
                ))}
                {eventPosts.length === 0 && <ThemedText style={styles.emptyState}>No events yet.</ThemedText>}
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
  joinButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
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
});
