import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { assignTask, getInitiative, getInitiativeTaskMeta, unassignTask, updateTaskStatus } from '@/lib/api/hubService';
import { Initiative, InitiativeTaskSummary, TaskMeta } from '@/lib/api/types';
import { canCycleTaskStatus, effectiveTaskStatus, nextTaskStatus, TASK_DISPLAY_STATUS_META, TASK_STATUS_ORDER, taskStatusMeta } from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';

type StatusFilter = 'All' | string;

function taskDetailRoute(initiativeId: string, taskId: string): Href {
  return `/initiatives/${initiativeId}/tasks/${taskId}` as unknown as Href;
}

// Built from the `tasks` array embedded in GET /api/initiatives/:id, plus
// GET /:id/task-meta for assignee/checklist/blocked — both confirmed against
// api/server.js. Tapping a row opens the real task-detail screen (status,
// checklist, notes). The status pill itself cycles status inline for
// checklist-less tasks the viewer owns (mirroring citinet web's TasksPane);
// an unclaimed task nobody has been assigned to shows "Claim this task" —
// claiming makes the viewer the assignee, which is what unlocks checklist
// edits on the detail screen (assertTaskOwner server-side requires the
// caller be the creator or the assignee).
export default function InitiativeTasksScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [taskMeta, setTaskMeta] = useState<Record<string, TaskMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [cyclingId, setCyclingId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getInitiative(session.hub.tunnelUrl, session.token, id),
      getInitiativeTaskMeta(session.hub.tunnelUrl, session.token, id).catch(() => []),
    ])
      .then(([nextInitiative, metaList]) => {
        setInitiative(nextInitiative);
        setTaskMeta(Object.fromEntries(metaList.map((m) => [m.task_id, m])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load tasks."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  const creatorNames = useMemo(() => new Map((initiative?.members ?? []).map((m) => [m.id, m.name])), [initiative]);

  const filtered = useMemo(() => {
    const tasks = initiative?.tasks ?? [];
    return statusFilter === 'All' ? tasks : tasks.filter((t) => t.status === statusFilter);
  }, [initiative, statusFilter]);

  function cycleStatus(task: InitiativeTaskSummary) {
    if (!session || !initiative || cyclingId) return;
    const next = nextTaskStatus(task.status);
    setCyclingId(task.id);
    setInitiative({ ...initiative, tasks: initiative.tasks.map((t) => (t.id === task.id ? { ...t, status: next } : t)) });
    updateTaskStatus(session.hub.tunnelUrl, session.token, task.id, next, initiative.id, task.title)
      .catch((err) => {
        setInitiative((prev) => (prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? task : t)) } : prev));
        setError(err instanceof Error ? err.message : "Couldn't update that task.");
      })
      .finally(() => setCyclingId(null));
  }

  function claimTask(task: InitiativeTaskSummary) {
    if (!session || !id || claimingId) return;
    setClaimingId(task.id);
    assignTask(session.hub.tunnelUrl, session.token, task.id, id, true)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't claim that task."))
      .finally(() => setClaimingId(null));
  }

  function releaseTask(task: InitiativeTaskSummary) {
    if (!session || !id || claimingId) return;
    setClaimingId(task.id);
    unassignTask(session.hub.tunnelUrl, session.token, task.id, id)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't release that task."))
      .finally(() => setClaimingId(null));
  }

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
            const meta = taskMeta[item.id];
            const disp = effectiveTaskStatus(item, meta);
            const dispMeta = TASK_DISPLAY_STATUS_META[disp];
            const creator = creatorNames.get(item.created_by);
            const canCycle = !!initiative && canCycleTaskStatus(item, meta, session.userId);
            const unclaimed = !meta?.assignee_user_id && item.created_by !== session.userId;
            const claimedByMe = meta?.assignee_user_id === session.userId;
            return (
              <Pressable
                style={styles.row}
                onPress={() => initiative && router.push(taskDetailRoute(initiative.id, item.id))}>
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold" numberOfLines={2}>
                    {item.title}
                  </ThemedText>
                  <View style={styles.rowMetaLine}>
                    <Pressable
                      hitSlop={6}
                      disabled={!canCycle || cyclingId === item.id}
                      onPress={() => cycleStatus(item)}
                      style={[styles.statusPill, { backgroundColor: dispMeta.color }, !canCycle && styles.statusPillStatic]}>
                      <ThemedText style={styles.statusPillLabel} lightColor="#fff" darkColor="#fff">
                        {dispMeta.label}
                      </ThemedText>
                    </Pressable>
                    {!!meta?.checklist_total && (
                      <ThemedText style={styles.rowMeta}>
                        {meta.checklist_done}/{meta.checklist_total} steps
                      </ThemedText>
                    )}
                    {creator ? <ThemedText style={styles.rowMeta}>by {creator}</ThemedText> : null}
                  </View>
                </View>
                {unclaimed && (
                  <Pressable
                    style={[styles.claimButton, claimingId === item.id && { opacity: 0.6 }]}
                    disabled={claimingId === item.id}
                    onPress={() => claimTask(item)}>
                    <ThemedText style={styles.claimButtonLabel}>{claimingId === item.id ? 'Claiming…' : 'Claim this task'}</ThemedText>
                  </Pressable>
                )}
                {claimedByMe && (
                  <Pressable
                    style={[styles.releaseButton, claimingId === item.id && { opacity: 0.6 }]}
                    disabled={claimingId === item.id}
                    onPress={() => releaseTask(item)}>
                    <ThemedText style={styles.releaseButtonLabel}>{claimingId === item.id ? 'Releasing…' : 'Release'}</ThemedText>
                  </Pressable>
                )}
                <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
              </Pressable>
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
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  rowMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillStatic: {
    opacity: 0.55,
  },
  statusPillLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
  },
  claimButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Brand,
  },
  claimButtonLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#fff',
  },
  releaseButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  releaseButtonLabel: {
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
