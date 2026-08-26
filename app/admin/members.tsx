import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useFocusEffect } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNativeHeaderOptions } from '@/hooks/use-native-header-options';
import { listMembers, removeMember, setMemberRole } from '@/lib/api/hubService';
import { HubMember, MemberRole } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useSession } from '@/lib/session/session-context';

export default function MembersRolesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const headerHeight = useHeaderHeight();
  const headerOptions = useNativeHeaderOptions('Members & roles');
  const { session } = useSession();

  const [members, setMembers] = useState<HubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listMembers(session.hub.tunnelUrl, session.token)
      .then(setMembers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  function handleSetRole(member: HubMember, role: MemberRole) {
    if (!session) return;
    setActionId(member.user_id);
    setMemberRole(session.hub.tunnelUrl, session.token, member.user_id, role)
      .then(() => setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role, is_admin: role === 'admin' } : m))))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't update that member's role."))
      .finally(() => setActionId(null));
  }

  function handleRemove(member: HubMember) {
    if (!session) return;
    confirmDestructive(`Remove @${member.username} from this hub?`, 'Remove', () => {
      setActionId(member.user_id);
      removeMember(session.hub.tunnelUrl, session.token, member.user_id)
        .then(() => setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id)))
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't remove that member."))
        .finally(() => setActionId(null));
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={[styles.flex, { paddingTop: headerHeight }]}>
      <Stack.Screen options={headerOptions} />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ScrollView contentContainerStyle={styles.body}>
        {members.map((member) => {
          const isSelf = member.user_id === session.userId;
          const role: MemberRole = member.role === 'admin' || member.role === 'moderator' ? member.role : 'member';
          const busy = actionId === member.user_id;
          return (
            <View key={member.user_id} style={styles.row}>
              <HubAvatar userId={member.user_id} displayName={member.display_name || member.username} tunnelUrl={session.hub.tunnelUrl} size={36} />
              <View style={styles.rowText}>
                <View style={styles.nameRow}>
                  <ThemedText style={styles.name} numberOfLines={1}>
                    {member.display_name || member.username}
                    {isSelf ? ' (you)' : ''}
                  </ThemedText>
                  {role !== 'member' && (
                    <View style={[styles.roleBadge, role === 'admin' && styles.roleBadgeAdmin]}>
                      <ThemedText style={[styles.roleBadgeLabel, role === 'admin' && styles.roleBadgeLabelAdmin]}>
                        {role === 'admin' ? 'Admin' : 'Mod'}
                      </ThemedText>
                    </View>
                  )}
                </View>
              </View>
              {!isSelf &&
                (busy ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <View style={styles.actions}>
                    {role === 'member' && (
                      <Pressable onPress={() => handleSetRole(member, 'moderator')} hitSlop={8}>
                        <ThemedText style={[styles.actionLabel, { color: Brand }]}>+ Mod</ThemedText>
                      </Pressable>
                    )}
                    {role === 'moderator' && (
                      <Pressable onPress={() => handleSetRole(member, 'member')} hitSlop={8}>
                        <ThemedText style={styles.actionLabel}>− Mod</ThemedText>
                      </Pressable>
                    )}
                    <Pressable onPress={() => handleRemove(member)} hitSlop={8} accessibilityLabel="Remove member">
                      <IconSymbol name="xmark" size={16} color={Colors[colorScheme].icon} />
                    </Pressable>
                  </View>
                ))}
            </View>
          );
        })}
      </ScrollView>
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
    marginTop: 12,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 15,
    flexShrink: 1,
  },
  roleBadge: {
    backgroundColor: '#8882',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  roleBadgeAdmin: {
    backgroundColor: '#8882',
  },
  roleBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.7,
  },
  roleBadgeLabelAdmin: {
    opacity: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
