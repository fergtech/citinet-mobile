import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useFocusEffect } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useNativeHeaderOptions } from '@/hooks/use-native-header-options';
import { getModLog } from '@/lib/api/hubService';
import { ModLogEntry } from '@/lib/api/types';
import { timeAgo } from '@/lib/ui/time-ago';
import { useSession } from '@/lib/session/session-context';

// action_type is a free-form snake_case string set by whichever route logged
// it (see logMod() in api/server.js) — humanized generically rather than
// mapped 1:1, since new action types get added on the server without mobile
// needing a matching update here.
function humanizeAction(actionType: string): string {
  const words = actionType.split('_');
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + ' ' + words.slice(1).join(' ');
}

export default function ModLogScreen() {
  const headerHeight = useHeaderHeight();
  const headerOptions = useNativeHeaderOptions('Mod log');
  const { session } = useSession();
  const [entries, setEntries] = useState<ModLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    getModLog(session.hub.tunnelUrl, session.token)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  if (!session) return null;

  return (
    <ThemedView style={[styles.flex, { paddingTop: headerHeight }]}>
      <Stack.Screen options={headerOptions} />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {!loading && entries.length === 0 && !error && <ThemedText style={styles.empty}>Nothing logged yet.</ThemedText>}

      <ScrollView contentContainerStyle={styles.body}>
        {entries.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <HubAvatar userId={entry.actor_id} displayName={entry.actor_username ?? '?'} tunnelUrl={session.hub.tunnelUrl} size={30} />
            <View style={styles.rowText}>
              <ThemedText style={styles.line}>
                <ThemedText style={styles.actor}>{entry.actor_username ?? 'Someone'}</ThemedText> {humanizeAction(entry.action_type).toLowerCase()}
                {entry.target_name ? ` — ${entry.target_name}` : ''}
              </ThemedText>
              {entry.reason && <ThemedText style={styles.reason}>{entry.reason}</ThemedText>}
              <ThemedText style={styles.rowMeta}>{timeAgo(entry.created_at)}</ThemedText>
            </View>
          </View>
        ))}
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
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  line: {
    fontSize: 14,
    lineHeight: 19,
  },
  actor: {
    fontWeight: '600',
  },
  reason: {
    fontSize: 12.5,
    opacity: 0.7,
  },
  rowMeta: {
    opacity: 0.5,
    fontSize: 12,
  },
});
