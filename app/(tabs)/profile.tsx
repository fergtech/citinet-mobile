import { useCallback, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

import { HubAvatar } from '@/components/hub-avatar';
import { ClubAvatar } from '@/components/club-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listMyClubs } from '@/lib/api/hubService';
import { Club } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useTabBarVisibility } from '@/lib/ui/tab-bar-visibility';
import { useThemePreference } from '@/lib/ui/theme-preference';
import { isMod } from '@/lib/session/is-mod';
import { useSession } from '@/lib/session/session-context';

// The Profile tab's own full screen — identity up top, then a Settings
// section. See app/profile/[userId].tsx for the other-member equivalent
// (identity + a Message CTA + its own "Shared clubs" strip, no Settings).
export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session, signOut } = useSession();
  const { setPreference } = useThemePreference();
  const isDark = colorScheme === 'dark';
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;

  // "Your clubs" — GET /api/spaces/mine already scopes to active
  // memberships only, no client-side filtering needed (still that literal
  // route — see hubService's own ── Clubs ── note). Own-profile equivalent
  // of the other-member screen's "Shared clubs" strip.
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      listMyClubs(session.hub.tunnelUrl, session.token)
        .then(setMyClubs)
        .catch(() => {});
    }, [session])
  );

  // Same scroll-driven tab bar hide/show as Home (see app/(tabs)/index.tsx's
  // own, more detailed note on why this accumulates distance in the current
  // direction rather than comparing only the last frame's delta — a slow
  // drag never produces a single-frame delta past the threshold no matter
  // how far it's actually travelled).
  const { setHidden: setTabBarHidden } = useTabBarVisibility();
  const lastScrollY = useRef(0);
  const accumulatedDelta = useRef(0);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const diff = y - lastScrollY.current;
      const SCROLL_HIDE_THRESHOLD = 12;
      const NEAR_TOP_THRESHOLD = 40;

      if ((diff > 0 && accumulatedDelta.current < 0) || (diff < 0 && accumulatedDelta.current > 0)) {
        accumulatedDelta.current = 0;
      }
      accumulatedDelta.current += diff;
      lastScrollY.current = y;

      if (y <= NEAR_TOP_THRESHOLD) {
        setTabBarHidden(false);
        accumulatedDelta.current = 0;
      } else if (accumulatedDelta.current > SCROLL_HIDE_THRESHOLD) {
        setTabBarHidden(true);
        accumulatedDelta.current = 0;
      } else if (accumulatedDelta.current < -SCROLL_HIDE_THRESHOLD) {
        setTabBarHidden(false);
        accumulatedDelta.current = 0;
      }
    },
    [setTabBarHidden]
  );

  if (!session) return null;

  function toggleAppearance() {
    setPreference(isDark ? 'light' : 'dark');
  }

  function confirmSignOut() {
    confirmDestructive(`Leave ${session!.hub.name}?`, 'Leave', signOut);
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 + extraBottomInset }}
        onScroll={handleScroll}
        scrollEventThrottle={16}>
        <View style={styles.header}>
          <HubAvatar userId={session.userId} displayName={session.displayName} tunnelUrl={session.hub.tunnelUrl} size={76} />
          <View style={styles.nameRow}>
            <ThemedText type="title" style={styles.name}>
              {session.displayName}
            </ThemedText>
            {session.isAdmin && (
              <View style={[styles.adminBadge, { borderColor: Colors[colorScheme].icon }]}>
                <ThemedText style={styles.adminBadgeLabel}>Admin</ThemedText>
              </View>
            )}
          </View>
          <ThemedText style={styles.meta}>
            @{session.username} · {session.hub.name}
          </ThemedText>
        </View>

        {/* Content features (Notes/Files/Saved pins now; Clubs/Initiatives
            will join this group later) — kept separate from Settings below,
            same grouping treatment as the "Leave hub" section. */}
        <View style={styles.section}>
          <Pressable onPress={() => router.push({ pathname: '/files', params: { tab: 'mine' } } as Href)} style={styles.row}>
            <IconSymbol name="externaldrive.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Your files</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={() => router.push('/notes' as Href)} style={styles.row}>
            <IconSymbol name="doc.text.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Notes</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={() => router.push('/atlas?saved=true' as Href)} style={styles.row}>
            <IconSymbol name="bookmark.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Saved pins</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={() => router.push('/marketplace?saved=true' as Href)} style={styles.row}>
            <IconSymbol name="bookmark.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Saved listings</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={() => router.push('/marketplace/vendor-editor' as Href)} style={styles.row}>
            <IconSymbol name="storefront.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Your vendor page</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
        </View>

        {myClubs.length > 0 && (
          <>
            <ThemedText style={styles.sectionLabel}>Your clubs</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clubsStrip}>
              {myClubs.map((club) => (
                <Pressable
                  key={club.id}
                  onPress={() => router.push({ pathname: '/clubs/[slug]', params: { slug: club.slug } })}
                  style={styles.clubItem}>
                  <ClubAvatar club={club} size={38} showBanner tunnelUrl={session.hub.tunnelUrl} />
                  <ThemedText style={styles.clubItemLabel} numberOfLines={1}>
                    {club.name}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {isMod(session) && (
          <>
            <ThemedText style={styles.sectionLabel}>Hub</ThemedText>
            <View style={styles.section}>
              <Pressable onPress={() => router.push('/admin' as Href)} style={styles.row}>
                <IconSymbol name="shield.fill" size={20} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.rowLabel}>Admin</ThemedText>
                <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
              </Pressable>
            </View>
          </>
        )}

        <ThemedText style={styles.sectionLabel}>Settings</ThemedText>
        <View style={styles.section}>
          <Pressable onPress={() => router.push('/account/privacy')} style={styles.row}>
            <IconSymbol name="lock.shield.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Privacy & Security</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={() => router.push('/account/settings')} style={styles.row}>
            <IconSymbol name="gearshape.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Account</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={toggleAppearance} style={styles.row}>
            <IconSymbol name={isDark ? 'moon.fill' : 'sun.max.fill'} size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Dark Mode</ThemedText>
            <Switch value={isDark} onValueChange={toggleAppearance} trackColor={{ true: Brand }} />
          </Pressable>
        </View>

        <View style={styles.section}>
          {/* Doesn't touch this (or any other) hub's saved session — just
              opens the picker (app/switch-hub.tsx). Distinct from "Leave"
              below, which actually signs out. */}
          <Pressable onPress={() => router.push('/switch-hub')} style={styles.row}>
            <IconSymbol name="arrow.left.arrow.right" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Switch Hub</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
          <Pressable onPress={confirmSignOut} style={styles.row}>
            <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Leave {session.hub.name}</ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 28,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  name: {
    fontSize: 20,
  },
  adminBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  adminBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.7,
  },
  meta: {
    opacity: 0.6,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
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
  clubsStrip: {
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 24,
  },
  clubItem: {
    alignItems: 'center',
    width: 64,
    gap: 6,
  },
  clubItemLabel: {
    fontSize: 11.5,
    textAlign: 'center',
  },
});
