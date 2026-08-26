import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listBlockedMembers, unblockMember } from '@/lib/api/hubService';
import { BlockedMember } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

export default function BlockedUsersScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();

  const [members, setMembers] = useState<BlockedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listBlockedMembers(session.hub.tunnelUrl, session.token)
      .then(setMembers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  function handleUnblock(userId: string) {
    if (!session) return;
    setUnblockingId(userId);
    unblockMember(session.hub.tunnelUrl, session.token, userId)
      .then(() => setMembers((prev) => prev.filter((m) => m.user_id !== userId)))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't unblock that member."))
      .finally(() => setUnblockingId(null));
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Blocked users" />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {!loading && members.length === 0 && !error && (
        <ThemedText style={styles.empty}>You haven&apos;t blocked anyone.</ThemedText>
      )}

      <View style={styles.body}>
        {members.map((member) => (
          <View key={member.user_id} style={styles.row}>
            <HubAvatar
              userId={member.user_id}
              displayName={member.display_name || member.username}
              tunnelUrl={session.hub.tunnelUrl}
              size={36}
            />
            <ThemedText style={styles.name} numberOfLines={1}>
              {member.display_name || member.username}
            </ThemedText>
            <Pressable
              onPress={() => handleUnblock(member.user_id)}
              disabled={unblockingId === member.user_id}
              style={[styles.unblockButton, { borderColor: Colors[colorScheme].icon }]}>
              {unblockingId === member.user_id ? (
                <ActivityIndicator size="small" />
              ) : (
                <ThemedText style={styles.unblockLabel}>Unblock</ThemedText>
              )}
            </Pressable>
          </View>
        ))}
      </View>
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
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
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
  name: {
    flex: 1,
    fontSize: 15,
  },
  unblockButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 76,
    alignItems: 'center',
  },
  unblockLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
