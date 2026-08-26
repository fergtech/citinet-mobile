import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/theme';
import { getInitiative } from '@/lib/api/hubService';
import { Initiative, InitiativeTaskSummary } from '@/lib/api/types';
import { TASK_STATUS_ORDER, taskStatusMeta } from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';

type StatusFilter = 'All' | string;

// Built entirely from the `tasks` array already embedded in
// GET /api/initiatives/:id — confirmed live. A dedicated task-detail screen
// (with assignee/checklist/notes) isn't built yet, and the standalone
// /tasks list endpoint hubService.ts exposes is unconfirmed, so rows here
// are display-only for now rather than tapping into something unverified.
export default function InitiativeTasksScreen() {
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    getInitiative(session.hub.tunnelUrl, session.token, id)
      .then(setInitiative)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load tasks."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  const creatorNames = useMemo(() => new Map((initiative?.members ?? []).map((m) => [m.id, m.name])), [initiative]);

  const filtered = useMemo(() => {
    const tasks = initiative?.tasks ?? [];
    return statusFilter === 'All' ? tasks : tasks.filter((t) => t.status === statusFilter);
  }, [initiative, statusFilter]);

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Tasks" />

      {loading && !initiative && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {initiative && (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <Pressable
                onPress={() => setStatusFilter('All')}
                style={[styles.chip, statusFilter === 'All' && { backgroundColor: Brand }]}>
                <ThemedText style={styles.chipLabel} lightColor={statusFilter === 'All' ? '#fff' : undefined} darkColor={statusFilter === 'All' ? '#fff' : undefined}>
                  All
                </ThemedText>
              </Pressable>
              {TASK_STATUS_ORDER.map((s) => {
                const meta = taskStatusMeta(s);
                const active = statusFilter === s;
                return (
                  <Pressable key={s} onPress={() => setStatusFilter(s)} style={[styles.chip, active && { backgroundColor: meta.color }]}>
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {meta.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          }
          renderItem={({ item }: { item: InitiativeTaskSummary }) => {
            const meta = taskStatusMeta(item.status);
            const creator = creatorNames.get(item.created_by);
            return (
              <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: meta.color }]} />
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold" numberOfLines={2}>
                    {item.title}
                  </ThemedText>
                  <ThemedText style={styles.rowMeta}>
                    <ThemedText style={[styles.rowMeta, { color: meta.color, fontWeight: '600' }]}>{meta.label}</ThemedText>
                    {creator ? ` · by ${creator}` : ''}
                  </ThemedText>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            !loading ? (
              <ThemedText style={styles.empty}>
                {statusFilter === 'All' ? 'No tasks yet — the organizer is still shaping the plan.' : 'No tasks with that status.'}
              </ThemedText>
            ) : null
          }
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
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#8881',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginTop: 5,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
    marginTop: 32,
    textAlign: 'center',
  },
});
