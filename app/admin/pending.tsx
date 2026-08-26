import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useFocusEffect } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useNativeHeaderOptions } from '@/hooks/use-native-header-options';
import { approvePendingUser, listPendingUsers, rejectPendingUser } from '@/lib/api/hubService';
import { PendingUser } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { timeAgo } from '@/lib/ui/time-ago';
import { useSession } from '@/lib/session/session-context';

export default function PendingApprovalsScreen() {
  const headerHeight = useHeaderHeight();
  const headerOptions = useNativeHeaderOptions('Pending approvals');
  const { session } = useSession();

  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listPendingUsers(session.hub.tunnelUrl, session.token)
      .then(setPending)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  function handleApprove(user: PendingUser) {
    if (!session) return;
    setActionId(user.user_id);
    approvePendingUser(session.hub.tunnelUrl, session.token, user.user_id)
      .then(() => setPending((prev) => prev.filter((u) => u.user_id !== user.user_id)))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't approve that request."))
      .finally(() => setActionId(null));
  }

  function handleReject(user: PendingUser) {
    if (!session) return;
    confirmDestructive(`Decline @${user.username}'s access request?`, 'Decline', () => {
      setActionId(user.user_id);
      rejectPendingUser(session.hub.tunnelUrl, session.token, user.user_id)
        .then(() => setPending((prev) => prev.filter((u) => u.user_id !== user.user_id)))
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't decline that request."))
        .finally(() => setActionId(null));
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={[styles.flex, { paddingTop: headerHeight }]}>
      <Stack.Screen options={headerOptions} />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {!loading && pending.length === 0 && !error && (
        <ThemedText style={styles.empty}>No one is waiting for approval.</ThemedText>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        {pending.map((user) => {
          const busy = actionId === user.user_id;
          return (
            <View key={user.user_id} style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText style={styles.username}>{user.username}</ThemedText>
                <ThemedText style={styles.rowMeta}>Requested {timeAgo(user.created_at)}</ThemedText>
              </View>
              {busy ? (
                <ActivityIndicator size="small" />
              ) : (
                <View style={styles.actions}>
                  <Pressable onPress={() => handleReject(user)} hitSlop={8} accessibilityLabel="Decline">
                    <IconSymbol name="xmark" size={18} color="#b0392f" />
                  </Pressable>
                  <Pressable onPress={() => handleApprove(user)} hitSlop={8} accessibilityLabel="Approve">
                    <IconSymbol name="checkmark.circle.fill" size={20} color="#1f9e5c" />
                  </Pressable>
                </View>
              )}
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  username: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 12.5,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
});
