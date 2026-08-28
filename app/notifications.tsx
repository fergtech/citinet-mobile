import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listUnreadNotifications, markNotificationRead } from '@/lib/api/hubService';
import { HubNotification } from '@/lib/api/types';
import { notificationCopy, notificationHref, notificationIcon } from '@/lib/notifications/meta';
import { useRecentlyReadNotifications } from '@/lib/notifications/read-retention';
import { useSession } from '@/lib/session/session-context';
import { timeAgo } from '@/lib/ui/time-ago';

// citinet-web has no notifications screen of its own — just per-feature red
// dots (see hubService.ts's own note on GET /api/notifications/counts'
// 3-bucket FEATURE_TYPES). This is that missing screen: every notification
// in one place, across all 6 real types, each dismissible on its own tap
// rather than only in bulk per feature.
//
// A tapped row doesn't disappear on the spot — GET /api/notifications/unread
// only ever returns unread rows (see hubService.ts), so once
// markNotificationRead succeeds server-side it'd vanish from the very next
// load() regardless of what this screen does locally. useRecentlyReadNotifications
// is what keeps it visible a while longer: a locally-persisted "read, but
// still showing" pool (capped by both age and count — see that module),
// merged below with the live unread pool for render. Product ask: tapping
// through to an item shouldn't feel like it deleted the notification.
export default function NotificationsScreen() {
  const { session } = useSession();
  const [notifications, setNotifications] = useState<HubNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { recentlyRead, markRead } = useRecentlyReadNotifications();

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listUnreadNotifications(session.hub.tunnelUrl, session.token)
      .then(setNotifications)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load notifications."))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  // Recently-read wins the dedupe — if a mark-read call failed server-side
  // and the item is still coming back from GET /unread, this is what stops
  // it from rendering twice (once "read", once "unread") until the server
  // catches up.
  const recentlyReadIds = new Set(recentlyRead.map((r) => r.notification.id));
  const rows = [
    ...notifications.filter((n) => !recentlyReadIds.has(n.id)).map((n) => ({ ...n, isRead: false })),
    ...recentlyRead.map((r) => ({ ...r.notification, isRead: true })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function handlePress(n: HubNotification) {
    if (!session) return;
    markRead(n);
    markNotificationRead(session.hub.tunnelUrl, session.token, n.id).catch(() => {});
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Notifications" />

      {loading && rows.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {!loading && rows.length === 0 && !error && (
          <View style={styles.emptyState}>
            <IconSymbol name="checkmark.circle.fill" size={32} color="#8886" />
            <ThemedText style={styles.emptyStateText}>You&apos;re all caught up.</ThemedText>
          </View>
        )}

        {rows.map((n) => {
          const { title, subtitle } = notificationCopy(n, session.hub.name);
          const { icon, color } = notificationIcon(n.type);
          return (
            <Pressable key={n.id} onPress={() => handlePress(n)} style={[styles.row, n.isRead && styles.rowRead]}>
              <View style={[styles.iconTile, { backgroundColor: color }]}>
                <IconSymbol name={icon} size={18} color="#fff" />
              </View>
              <View style={styles.rowContent}>
                <ThemedText type="defaultSemiBold" style={styles.rowTitle} numberOfLines={2}>
                  {title}
                </ThemedText>
                {!!subtitle && (
                  <ThemedText style={styles.rowSubtitle} numberOfLines={2}>
                    {subtitle}
                  </ThemedText>
                )}
                <ThemedText style={styles.rowTime}>{timeAgo(n.created_at)}</ThemedText>
              </View>
              {!n.isRead && <View style={styles.unreadDot} />}
            </Pressable>
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
  emptyState: {
    alignItems: 'center',
    gap: 10,
    marginTop: 80,
  },
  emptyStateText: {
    fontSize: 14,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  // The only visual cue distinguishing a lingering read row from a genuine
  // unread one now that both can appear in the same list — no unread dot
  // (omitted entirely in the row itself, not just hidden) plus a dimmed tile.
  rowRead: {
    opacity: 0.55,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowContent: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 14.5,
    lineHeight: 19,
  },
  rowSubtitle: {
    fontSize: 12.5,
    opacity: 0.65,
    lineHeight: 17,
  },
  rowTime: {
    fontSize: 11.5,
    opacity: 0.5,
    marginTop: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d1465f',
    flexShrink: 0,
  },
});
