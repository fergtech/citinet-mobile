import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { HubAvatar } from '@/components/hub-avatar';
import { HubMedia } from '@/components/hub-media';
import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getInitiative, getInitiativeActivity, joinInitiative } from '@/lib/api/hubService';
import { Initiative, InitiativeActivityEntry } from '@/lib/api/types';
import {
  initiativeCategoryMeta,
  initiativeColor,
  initiativeLatestUpdate,
  initiativeMemberCount,
  initiativeOpenRoleCount,
  initiativeOrganizerName,
  initiativeProgress,
  initiativeStatusMeta,
  initiativeTaskCounts,
} from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';
import { timeAgo } from '@/lib/ui/time-ago';

// Best-effort icon per activity kind — the real ACTIVITY_ICON map this
// mirrors lives in citinet web's InitiativeCard.tsx, not available this
// session (see hubService.ts's Initiatives section note). Falls back to a
// generic dot for any kind not covered here.
const ACTIVITY_ICON: Record<string, IconSymbolName> = {
  task_created: 'checklist',
  task_completed: 'checkmark.circle.fill',
  task_assigned: 'person.fill',
  member_joined: 'person.2.fill',
  role_filled: 'person.badge.plus',
  resource_provided: 'shippingbox.fill',
  update_posted: 'message.fill',
};

// Team/Tasks/Open roles/Resources are now real screens (app/initiatives/[id]/*)
// — `as unknown as Href` is only here because expo-router's typed-routes
// declarations regenerate from the running dev server, not from this
// process, so a freshly added route isn't necessarily reflected yet.
function nestedRoute(id: string, segment: string): Href {
  return `/initiatives/${id}/${segment}` as unknown as Href;
}

export default function InitiativeDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [activity, setActivity] = useState<InitiativeActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getInitiative(session.hub.tunnelUrl, session.token, id),
      getInitiativeActivity(session.hub.tunnelUrl, session.token, id, 5).catch(() => []),
    ])
      .then(([nextInitiative, nextActivity]) => {
        setInitiative(nextInitiative);
        setActivity(nextActivity);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this initiative."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  function handleJoin() {
    if (!session || !initiative || joining) return;
    const wasMember = initiative.viewerIsMember;
    const prior = initiative;
    // Optimistic add/remove in the embedded `members` array too, so the
    // Contributors avatar stack and count update immediately — the design
    // handoff calls this out explicitly (volunteering must surface the
    // viewer in Contributors right away, not wait on a refetch). The
    // `/join` response body's real shape still isn't confirmed, so once it
    // resolves this re-fetches the trusted GET rather than applying that
    // response directly — see the note in lib/api/types.ts on why nothing
    // here trusts an unverified response shape to replace state wholesale.
    const priorMembers = initiative.members ?? [];
    const optimisticMembers = wasMember
      ? priorMembers.filter((m) => m.id !== session.userId)
      : [...priorMembers, { id: session.userId, name: session.username, role: null, joinedAt: new Date().toISOString() }];
    setInitiative({ ...initiative, viewerIsMember: !wasMember, members: optimisticMembers });
    setJoining(true);
    joinInitiative(session.hub.tunnelUrl, session.token, initiative.id)
      .then(() => getInitiative(session.hub.tunnelUrl, session.token, initiative.id))
      .then(setInitiative)
      .catch(() => setInitiative(prior))
      .finally(() => setJoining(false));
  }

  if (!session) return null;

  const category = initiative ? initiativeCategoryMeta(initiative.category) : null;
  const status = initiative ? initiativeStatusMeta(initiative.status) : null;
  const color = initiative ? initiativeColor(initiative.color) : null;
  const counts = initiative ? initiativeTaskCounts(initiative) : { total: 0, done: 0 };
  const progress = initiative ? initiativeProgress(initiative) : 0;
  const memberCount = initiative ? initiativeMemberCount(initiative) : 0;
  const openRoleCount = initiative ? initiativeOpenRoleCount(initiative) : 0;
  const latestUpdate = initiative ? initiativeLatestUpdate(initiative) : null;
  // Every direct `initiative.<array>` access below goes through this rather
  // than the raw field — the crash-causing bug that prompted this: a
  // response missing `members` entirely threw on `.slice`/`.length` instead
  // of degrading, unlike every derived stat above, which was already
  // optional-chained (see lib/initiatives/meta.ts).
  const members = initiative?.members ?? [];

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title={initiative?.title ?? 'Initiative'} />

      {loading && !initiative && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {initiative && category && status && color && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.banner}>
            {initiative.banner_mode === 'image' && initiative.banner_image_file_name ? (
              <>
                <HubMedia
                  fileName={initiative.banner_image_file_name}
                  tunnelUrl={session.hub.tunnelUrl}
                  token={session.token}
                  style={styles.bannerMedia}
                />
                <View style={styles.bannerScrim} />
              </>
            ) : initiative.banner_mode === 'gradient' && initiative.banner_gradient_from && initiative.banner_gradient_to ? (
              <LinearGradient
                colors={[initiative.banner_gradient_from, initiative.banner_gradient_to]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: initiative.banner_mode === 'solid' && initiative.banner_color ? initiative.banner_color : color }]} />
            )}
            <View style={styles.bannerContent}>
              <View style={styles.bannerIcon}>
                <IconSymbol name={category.icon} size={22} color="#fff" />
              </View>
              <ThemedText style={styles.bannerCategory} lightColor="#fff" darkColor="#fff">
                {category.label.toUpperCase()}
              </ThemedText>
              <ThemedText style={styles.bannerSpace} lightColor="#ffffffcc" darkColor="#ffffffcc">
                {initiative.space_name ? `In ${initiative.space_name}` : 'Hub-wide'}
              </ThemedText>
            </View>
          </View>

          <View style={styles.statusLine}>
            <View style={[styles.statusDot, { backgroundColor: status.color }]} />
            <ThemedText style={[styles.statusLabel, { color: status.color }]}>{status.label}</ThemedText>
            <ThemedText style={styles.rowMeta}> · Updated {timeAgo(initiative.updated_at)}</ThemedText>
          </View>

          <ThemedText style={styles.title}>{initiative.title}</ThemedText>
          <ThemedText style={styles.goal}>{initiative.goal}</ThemedText>
          {!!initiative.description && <ThemedText style={styles.description}>{initiative.description}</ThemedText>}

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
            </View>
            <ThemedText style={styles.progressPct}>{Math.round(progress * 100)}%</ThemedText>
          </View>
          <ThemedText style={styles.progressCaption}>
            {counts.done} of {counts.total} tasks done · {memberCount} {memberCount === 1 ? 'neighbor' : 'neighbors'} contributing
          </ThemedText>

          <Pressable
            onPress={handleJoin}
            disabled={joining}
            style={[styles.joinButton, initiative.viewerIsMember ? styles.joinButtonJoined : { backgroundColor: Brand }, joining && { opacity: 0.6 }]}>
            <ThemedText
              type="defaultSemiBold"
              style={styles.joinLabel}
              lightColor={initiative.viewerIsMember ? undefined : '#fff'}
              darkColor={initiative.viewerIsMember ? undefined : '#fff'}>
              {initiative.viewerIsMember ? 'Joined ✓' : 'Join this initiative'}
            </ThemedText>
          </Pressable>

          <Pressable style={styles.contributorsRow} onPress={() => router.push(nestedRoute(initiative.id, 'team'))}>
            <View style={styles.avatarStack}>
              {members.slice(0, 4).map((member, i) => (
                <View key={member.id} style={[styles.avatarStackItem, { marginLeft: i === 0 ? 0 : -10, zIndex: 4 - i }]}>
                  <HubAvatar userId={member.id} displayName={member.name} tunnelUrl={session.hub.tunnelUrl} size={32} />
                </View>
              ))}
              {members.length > 4 && (
                <View style={[styles.avatarStackItem, styles.avatarOverflow, { marginLeft: -10 }]}>
                  <ThemedText style={styles.avatarOverflowLabel}>+{members.length - 4}</ThemedText>
                </View>
              )}
            </View>
            <View style={styles.contributorsText}>
              <ThemedText type="defaultSemiBold" style={styles.contributorsTitle}>
                Contributors
              </ThemedText>
              <ThemedText style={styles.rowMeta}>
                {memberCount} {memberCount === 1 ? 'neighbor' : 'neighbors'} contributing
              </ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>

          <View style={styles.tapCards}>
            <Pressable style={styles.tapCard} onPress={() => router.push(nestedRoute(initiative.id, 'tasks'))}>
              <View style={styles.tapCardTile}>
                <IconSymbol name="checklist" size={16} color={Colors[colorScheme].text} />
              </View>
              <ThemedText type="defaultSemiBold" style={styles.tapCardLabel}>
                Tasks
              </ThemedText>
              <ThemedText style={styles.tapCardMeta} numberOfLines={1}>
                {counts.total > 0 ? `${counts.total - counts.done} open · ${counts.total} total` : 'None yet'}
              </ThemedText>
            </Pressable>
            <Pressable style={styles.tapCard} onPress={() => router.push(nestedRoute(initiative.id, 'roles'))}>
              <View style={styles.tapCardTile}>
                <IconSymbol name="hand.raised.fill" size={16} color={Colors[colorScheme].text} />
              </View>
              <ThemedText type="defaultSemiBold" style={styles.tapCardLabel}>
                Open roles
              </ThemedText>
              <ThemedText style={styles.tapCardMeta} numberOfLines={1}>
                {openRoleCount > 0 ? `${openRoleCount} open ${openRoleCount === 1 ? 'role' : 'roles'}` : 'Team is full'}
              </ThemedText>
            </Pressable>
            <Pressable style={styles.tapCard} onPress={() => router.push(nestedRoute(initiative.id, 'resources'))}>
              <View style={styles.tapCardTile}>
                <IconSymbol name="shippingbox.fill" size={16} color={Colors[colorScheme].text} />
              </View>
              <ThemedText type="defaultSemiBold" style={styles.tapCardLabel}>
                Resources
              </ThemedText>
              <ThemedText style={styles.tapCardMeta} numberOfLines={1}>
                View resources
              </ThemedText>
            </Pressable>
          </View>

          {latestUpdate && (
            <View style={styles.updateCard}>
              <ThemedText style={styles.sectionLabel}>Latest update</ThemedText>
              <View style={styles.updateHeader}>
                <ThemedText type="defaultSemiBold" numberOfLines={1}>
                  {latestUpdate.author ?? initiativeOrganizerName(initiative)}
                </ThemedText>
                {!!latestUpdate.when && <ThemedText style={styles.rowMeta}>{timeAgo(latestUpdate.when)}</ThemedText>}
              </View>
              <ThemedText style={styles.updateBody}>{latestUpdate.body}</ThemedText>
            </View>
          )}

          {activity.length > 0 && (
            <View style={styles.activitySection}>
              <ThemedText style={styles.sectionLabel}>Recent activity</ThemedText>
              {activity.map((entry) => (
                <View key={entry.id} style={styles.activityRow}>
                  <IconSymbol name={ACTIVITY_ICON[entry.kind] ?? 'circle'} size={14} color={Colors[colorScheme].icon} />
                  <ThemedText style={styles.activityText}>{entry.text}</ThemedText>
                  <ThemedText style={styles.rowMeta}>{timeAgo(entry.created_at)}</ThemedText>
                </View>
              ))}
            </View>
          )}
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
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginVertical: 8,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  banner: {
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
  },
  bannerMedia: {
    ...StyleSheet.absoluteFillObject,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  bannerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.35)',
  },
  bannerContent: {
    flex: 1,
    padding: 14,
    justifyContent: 'flex-end',
    gap: 2,
  },
  bannerIcon: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerCategory: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bannerSpace: {
    fontSize: 12.5,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 27,
    marginTop: 6,
  },
  goal: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.7,
    marginTop: 6,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  progressTrack: {
    flex: 1,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#8882',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressPct: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  progressCaption: {
    fontSize: 11.5,
    opacity: 0.55,
    marginTop: 5,
  },
  joinButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  joinButtonJoined: {
    backgroundColor: '#8881',
  },
  joinLabel: {
    fontSize: 15,
  },
  contributorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarStackItem: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarOverflow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#8882',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverflowLabel: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  contributorsText: {
    flex: 1,
    gap: 1,
  },
  contributorsTitle: {
    fontSize: 13.5,
  },
  tapCards: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
  },
  tapCard: {
    flex: 1,
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: '#8881',
    padding: 12,
    gap: 4,
  },
  tapCardTile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#8882',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapCardLabel: {
    fontSize: 13.5,
    marginTop: 4,
  },
  tapCardMeta: {
    fontSize: 11.5,
    opacity: 0.55,
    lineHeight: 15,
  },
  updateCard: {
    marginTop: 24,
  },
  updateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  updateBody: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  activitySection: {
    marginTop: 24,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  activityText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.85,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
});
