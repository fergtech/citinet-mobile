import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/theme';
import { useNativeHeaderOptions } from '@/hooks/use-native-header-options';
import { listReports, resolveReport } from '@/lib/api/hubService';
import { ReportEntry } from '@/lib/api/types';
import { timeAgo } from '@/lib/ui/time-ago';
import { useSession } from '@/lib/session/session-context';

const REASON_LABELS: Record<ReportEntry['reason'], string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  inappropriate: 'Inappropriate content',
  scam: 'Scam or fraud',
  other: 'Something else',
};

const TARGET_LABELS: Record<ReportEntry['target_type'], string> = {
  post: 'Post',
  reply: 'Comment',
  message: 'Message',
  listing: 'Listing',
  member: 'Member',
};

type Filter = 'open' | 'all';

export default function ReportsScreen() {
  const headerHeight = useHeaderHeight();
  const headerOptions = useNativeHeaderOptions('Reports');
  const { session } = useSession();
  const [filter, setFilter] = useState<Filter>('open');
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listReports(session.hub.tunnelUrl, session.token, filter)
      .then(setReports)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session, filter]);

  useFocusEffect(load);

  function handleResolve(report: ReportEntry, status: 'reviewed' | 'dismissed') {
    if (!session) return;
    setActionId(report.id);
    resolveReport(session.hub.tunnelUrl, session.token, report.id, status)
      .then(() => setReports((prev) => prev.filter((r) => r.id !== report.id)))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't update that report."))
      .finally(() => setActionId(null));
  }

  if (!session) return null;

  return (
    <ThemedView style={[styles.flex, { paddingTop: headerHeight }]}>
      <Stack.Screen options={headerOptions} />

      {/* Fixed-height wrapper around the horizontal ScrollView — its own
          reported height isn't reliable on its own (same fix already applied
          to Files' chipsRowWrap/Notes' visFilterRowWrap), so the row's height
          is enforced from outside it. Without this the chip row expands to
          fill the flex column's remaining space instead of hugging its
          content — exactly what showed up as full-height pills here. */}
      <View style={styles.chipsRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Pressable onPress={() => setFilter('open')} style={[styles.chip, filter === 'open' && { backgroundColor: Brand }]}>
            <ThemedText style={styles.chipLabel} lightColor={filter === 'open' ? '#fff' : undefined} darkColor={filter === 'open' ? '#fff' : undefined}>
              Open
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => setFilter('all')} style={[styles.chip, filter === 'all' && { backgroundColor: Brand }]}>
            <ThemedText style={styles.chipLabel} lightColor={filter === 'all' ? '#fff' : undefined} darkColor={filter === 'all' ? '#fff' : undefined}>
              All
            </ThemedText>
          </Pressable>
        </ScrollView>
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {!loading && reports.length === 0 && !error && (
        <ThemedText style={styles.empty}>{filter === 'open' ? 'No open reports.' : 'No reports yet.'}</ThemedText>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        {reports.map((report) => {
          const busy = actionId === report.id;
          return (
            <View key={report.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <ThemedText style={styles.targetLabel}>{TARGET_LABELS[report.target_type]}</ThemedText>
                <ThemedText style={styles.rowMeta}>{timeAgo(report.created_at)}</ThemedText>
              </View>
              <ThemedText style={styles.reason}>{REASON_LABELS[report.reason]}</ThemedText>
              {report.details && <ThemedText style={styles.details}>{report.details}</ThemedText>}
              <ThemedText style={styles.rowMeta}>
                Reported by {report.reporter_username ?? 'a member'}
                {report.status !== 'open' ? ` · ${report.status}` : ''}
              </ThemedText>
              {report.status === 'open' && (
                <View style={styles.actions}>
                  {busy ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <>
                      <Pressable onPress={() => handleResolve(report, 'dismissed')} style={styles.actionButtonSecondary}>
                        <ThemedText style={styles.actionLabel}>Dismiss</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => handleResolve(report, 'reviewed')} style={[styles.actionButton, { backgroundColor: Brand }]}>
                        <ThemedText style={styles.actionLabel} lightColor="#fff" darkColor="#fff">
                          Mark reviewed
                        </ThemedText>
                      </Pressable>
                    </>
                  )}
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
  chipsRowWrap: {
    paddingBottom: 12,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  // height (not just paddingVertical) + centered content — same as Files'/
  // Notes' chip style. A horizontal ScrollView's row content container
  // defaults to alignItems: 'stretch', which without an explicit height here
  // stretches each Pressable to fill the row's full cross-axis height;
  // that's what showed up as full-height pills rather than small chips.
  chip: {
    height: 32,
    backgroundColor: '#8881',
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 20,
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
    gap: 10,
  },
  card: {
    backgroundColor: '#8881',
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  targetLabel: {
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.6,
    textTransform: 'uppercase',
  },
  reason: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  details: {
    fontSize: 13.5,
    opacity: 0.8,
    marginTop: 2,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 12.5,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 10,
  },
  actionButtonSecondary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 10,
    backgroundColor: '#8882',
  },
  actionLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
});
