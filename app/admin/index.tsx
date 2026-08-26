import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { router, Stack, useFocusEffect, type Href } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNativeHeaderOptions } from '@/hooks/use-native-header-options';
import { listPendingUsers, listReports } from '@/lib/api/hubService';
import { isMod } from '@/lib/session/is-mod';
import { useSession } from '@/lib/session/session-context';

// Mobile's trimmed admin console — the parts of citinet web's
// HubManagementScreen + ModLogScreen that make sense to act on from a phone
// (approvals, roles, reports, the audit trail). Hub branding, featured-post
// curation, governance requests, and the AI/reach tabs stay web-only; this
// screen is a menu into what mobile *does* cover, not a port of the whole thing.
export default function AdminScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const headerHeight = useHeaderHeight();
  const headerOptions = useNativeHeaderOptions('Admin');
  const { session } = useSession();
  const [pendingCount, setPendingCount] = useState(0);
  const [openReportCount, setOpenReportCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      if (session.isAdmin) {
        listPendingUsers(session.hub.tunnelUrl, session.token)
          .then((list) => setPendingCount(list.length))
          .catch(() => {});
      }
      if (isMod(session)) {
        listReports(session.hub.tunnelUrl, session.token, 'open')
          .then((list) => setOpenReportCount(list.length))
          .catch(() => {});
      }
    }, [session])
  );

  if (!session || !isMod(session)) return null;

  return (
    <ThemedView style={[styles.flex, { paddingTop: headerHeight }]}>
      <Stack.Screen options={headerOptions} />

      <ScrollView contentContainerStyle={styles.body}>
        {session.isAdmin && (
          <>
            <ThemedText style={styles.sectionLabel}>Members</ThemedText>
            <View style={styles.section}>
              <Pressable onPress={() => router.push('/admin/pending' as Href)} style={styles.row}>
                <IconSymbol name="person.badge.plus" size={20} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.rowLabel}>Pending approvals</ThemedText>
                {pendingCount > 0 && (
                  <View style={styles.badge}>
                    <ThemedText style={styles.badgeLabel}>{pendingCount}</ThemedText>
                  </View>
                )}
                <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
              </Pressable>
              <Pressable onPress={() => router.push('/admin/members' as Href)} style={styles.row}>
                <IconSymbol name="person.2.fill" size={20} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.rowLabel}>Members & roles</ThemedText>
                <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
              </Pressable>
            </View>
          </>
        )}

        <ThemedText style={styles.sectionLabel}>Trust & safety</ThemedText>
        <View style={styles.section}>
          <Pressable onPress={() => router.push('/admin/reports' as Href)} style={styles.row}>
            <IconSymbol name="flag.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Reports</ThemedText>
            {openReportCount > 0 && (
              <View style={styles.badge}>
                <ThemedText style={styles.badgeLabel}>{openReportCount}</ThemedText>
              </View>
            )}
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={() => router.push('/admin/mod-log' as Href)} style={styles.row}>
            <IconSymbol name="shield.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Mod log</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
        </View>

        <ThemedText style={styles.footnote}>
          Hub branding, featured posts, and governance requests aren&apos;t here yet — open the web portal for those.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 20,
  },
  section: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
  },
  badge: {
    backgroundColor: '#b0392f',
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  footnote: {
    opacity: 0.5,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 24,
  },
});
