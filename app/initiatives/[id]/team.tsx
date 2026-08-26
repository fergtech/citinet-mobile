import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/theme';
import { getInitiative } from '@/lib/api/hubService';
import { Initiative, InitiativeMemberSummary } from '@/lib/api/types';
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

  if (!session) return null;

  const members = initiative?.members ?? [];

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Contributors" />

      {loading && !initiative && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {initiative && (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <ThemedText style={styles.count}>
              {members.length} {members.length === 1 ? 'neighbor' : 'neighbors'} contributing
            </ThemedText>
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
