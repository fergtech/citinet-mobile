import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/theme';
import { getInitiative, inviteToInitiative, listMembers } from '@/lib/api/hubService';
import { HubMember, Initiative, InitiativeMemberSummary } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';

// Built entirely from the `members` array already embedded in
// GET /api/initiatives/:id — confirmed live (see lib/api/types.ts), rather
// than the separate /team endpoint hubService.ts also exposes, whose
// response shape was never confirmed. Simplest and safest: reuse data
// that's already proven correct instead of a second unverified call.
export default function InitiativeTeamScreen() {
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No creator gate here (unlike Add task/Add role) — POST /:id/invite has
  // none server-side either, it just fires a notification, so any
  // contributor can pull in someone else. Fetched lazily, only once the
  // panel is actually opened, and only once per screen visit.
  const [showInvite, setShowInvite] = useState(false);
  const [hubMembers, setHubMembers] = useState<HubMember[] | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    getInitiative(session.hub.tunnelUrl, session.token, id)
      .then(setInitiative)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load contributors."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  function toggleInvite() {
    if (!session) return;
    setShowInvite((v) => !v);
    if (!hubMembers) {
      listMembers(session.hub.tunnelUrl, session.token)
        .then(setHubMembers)
        .catch(() => setHubMembers([]));
    }
  }

  function invite(userId: string) {
    if (!session || invitingId) return;
    setInvitingId(userId);
    inviteToInitiative(session.hub.tunnelUrl, session.token, id, userId)
      .then(() => setInvitedIds((prev) => new Set(prev).add(userId)))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't send that invite."))
      .finally(() => setInvitingId(null));
  }

  if (!session) return null;

  const members = initiative?.members ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const inviteCandidates = (hubMembers ?? []).filter((m) => m.user_id !== session.userId && !memberIds.has(m.user_id));

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Contributors" rightIcon="person.badge.plus" onRightPress={toggleInvite} rightAccessibilityLabel="Invite someone" />

      {loading && !initiative && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {initiative && (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <ThemedText style={styles.count}>
                {members.length} {members.length === 1 ? 'neighbor' : 'neighbors'} contributing
              </ThemedText>
              {showInvite && (
                <View style={styles.inviteSection}>
                  <ThemedText style={styles.inviteSectionLabel}>Invite someone</ThemedText>
                  {hubMembers === null && <ActivityIndicator style={styles.inviteSpinner} />}
                  {hubMembers !== null && inviteCandidates.length === 0 && (
                    <ThemedText style={styles.inviteEmpty}>Everyone in the hub is already contributing.</ThemedText>
                  )}
                  {inviteCandidates.map((m) => {
                    const invited = invitedIds.has(m.user_id);
                    return (
                      <View key={m.user_id} style={styles.inviteRow}>
                        <HubAvatar userId={m.user_id} displayName={m.display_name ?? m.username} tunnelUrl={session.hub.tunnelUrl} size={32} />
                        <ThemedText style={styles.inviteRowLabel} numberOfLines={1}>
                          {m.display_name || m.username}
                        </ThemedText>
                        <Pressable
                          style={[styles.inviteButton, invited && styles.inviteButtonDone]}
                          disabled={invited || invitingId === m.user_id}
                          onPress={() => invite(m.user_id)}>
                          <ThemedText style={styles.inviteButtonLabel} lightColor={invited ? undefined : '#fff'} darkColor={invited ? undefined : '#fff'}>
                            {invited ? 'Invited' : invitingId === m.user_id ? '…' : 'Invite'}
                          </ThemedText>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }: { item: InitiativeMemberSummary }) => {
            const isYou = item.id === session.userId;
            return (
              <Pressable style={styles.row} onPress={() => goToProfile(item.id, session.userId)}>
                <HubAvatar userId={item.id} displayName={item.name} tunnelUrl={session.hub.tunnelUrl} size={42} />
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1}>
                    {isYou ? 'You' : item.name}
                  </ThemedText>
                  {!!item.role && (
                    <ThemedText style={[styles.role, { color: Brand }]} numberOfLines={1}>
                      {item.role}
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No contributors yet.</ThemedText> : null}
        />
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
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  inviteSection: {
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  inviteSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  inviteSpinner: {
    marginVertical: 12,
  },
  inviteEmpty: {
    fontSize: 12.5,
    opacity: 0.55,
    paddingVertical: 8,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  inviteRowLabel: {
    flex: 1,
    fontSize: 14,
  },
  inviteButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Brand,
  },
  inviteButtonDone: {
    backgroundColor: '#8882',
  },
  inviteButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  count: {
    fontSize: 11.5,
    opacity: 0.5,
    fontVariant: ['tabular-nums'],
    marginBottom: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  role: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
    marginTop: 32,
    textAlign: 'center',
  },
});
