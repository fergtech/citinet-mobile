import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listUnreadNotifications, markNotificationRead, markNotificationsForRef } from '@/lib/api/hubService';
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
  const merged = [
    ...notifications.filter((n) => !recentlyReadIds.has(n.id)).map((n) => ({ ...n, isRead: false })),
    ...recentlyRead.map((r) => ({ ...r.notification, isRead: true })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Several notifications pointing at the same underlying thing — a burst of
  // messages in one conversation, a handful of replies on one post — collapse
  // into a single row with a count instead of a flat list where reading one
  // conversation still means individually dismissing every message it sent.
  // Only groups by (type, ref_id) when there's a real ref_id to group by;
  // everything else (account_approved, and anything this app doesn't
  // recognize yet) is one-off by nature and gets its own row same as before.
  type Row = HubNotification & { isRead: boolean };
  const groups = new Map<string, Row[]>();
  const groupOrder: string[] = [];
  for (const n of merged) {
    const key = n.ref_id ? `${n.type}:${n.ref_id}` : `single:${n.id}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      groupOrder.push(key);
    }
    group.push(n);
  }
  // merged is already newest-first, so each group's own first push is its
  // newest member and groupOrder reflects the newest-first order across groups.
  const rows = groupOrder.map((key) => groups.get(key)!);

  function handlePress(group: Row[]) {
    if (!session) return;
    group.forEach(markRead);
    const [newest] = group;
    // One call clears the whole group server-side when they share a real
    // ref_id (message/reply) — same bulk endpoint conversation screens use
    // on open (see hubService.ts's own note on markNotificationsForRef).
    // Anything without a ref_id is always a single-item group (see above),
    // so the per-id fallback below only ever fires once.
    //
    // Scoped to `newest.type` — groups are already keyed by (type, ref_id),
    // so every item here already shares one type, but an *unscoped* clear
    // would also sweep up a different type sharing the same ref_id (a
    // conversation's 'message_reaction' notifications alongside its
    // 'message' ones, or an initiative's 'note_reply'/'update_comment'/
    // 'initiative_invite' sharing one ref_id) — those are meant to be
    // dismissed independently, not just because they point at the same place.
    if (newest.ref_id) {
      markNotificationsForRef(session.hub.tunnelUrl, session.token, newest.ref_id, newest.type).catch(() => {});
    } else {
      group.forEach((n) => markNotificationRead(session.hub.tunnelUrl, session.token, n.id).catch(() => {}));
    }
    const href = notificationHref(newest);
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

        {rows.map((group) => {
          const [newest] = group;
          // Not group.length — a group can hold a mix of genuinely-unread
          // items and older ones still lingering on-screen from the
          // "recently read" grace period (see this file's own top-of-file
          // note), and the count/badge should reflect what's actually
          // unseen right now, not that historical total. allRead is false
          // exactly when unreadCount > 0, so the fallback below never fires.
          const unreadCount = group.filter((n) => !n.isRead).length;
          const allRead = unreadCount === 0;
          const count = allRead ? group.length : unreadCount;
          const { title, subtitle } = notificationCopy(newest, session.hub.name, count);
          const { icon, color } = notificationIcon(newest.type);
          return (
            <Pressable key={newest.id} onPress={() => handlePress(group)} style={[styles.row, allRead && styles.rowRead]}>
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
                <ThemedText style={styles.rowTime}>{timeAgo(newest.created_at)}</ThemedText>
              </View>
              {!allRead && (count > 1 ? (
                <View style={styles.countBadge}>
                  <ThemedText style={styles.countBadgeText}>{count > 9 ? '9+' : count}</ThemedText>
                </View>
              ) : (
                <View style={styles.unreadDot} />
              ))}
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
  // Same red as unreadDot, just bigger — a grouped row's "N unread things
  // here" replacement for the plain dot.
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#d1465f',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
