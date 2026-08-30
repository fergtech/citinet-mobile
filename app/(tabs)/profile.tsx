import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

import { HubAvatar } from '@/components/hub-avatar';
import { SpaceAvatar } from '@/components/space-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listMySpaces } from '@/lib/api/hubService';
import { Space } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useThemePreference } from '@/lib/ui/theme-preference';
import { isMod } from '@/lib/session/is-mod';
import { useSession } from '@/lib/session/session-context';

// The Profile tab's own full screen — identity up top, then a Settings
// section. See app/profile/[userId].tsx for the other-member equivalent
// (identity + a Message CTA + its own "Shared spaces" strip, no Settings).
export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session, signOut } = useSession();
  const { setPreference } = useThemePreference();
  const isDark = colorScheme === 'dark';
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;

  // "Your spaces" — GET /api/spaces/mine already scopes to active
  // memberships only, no client-side filtering needed. Own-profile
  // equivalent of the other-member screen's "Shared spaces" strip.
  const [mySpaces, setMySpaces] = useState<Space[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      listMySpaces(session.hub.tunnelUrl, session.token)
        .then(setMySpaces)
        .catch(() => {});
    }, [session])
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
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + extraBottomInset }}>
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

        {/* Content features (Notes/Files/Saved pins now; Spaces/Initiatives
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

        {mySpaces.length > 0 && (
          <>
            <ThemedText style={styles.sectionLabel}>Your spaces</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spacesStrip}>
              {mySpaces.map((space) => (
                <Pressable
                  key={space.id}
                  onPress={() => router.push({ pathname: '/spaces/[slug]', params: { slug: space.slug } })}
                  style={styles.spaceItem}>
                  <SpaceAvatar space={space} size={38} showBanner tunnelUrl={session.hub.tunnelUrl} />
                  <ThemedText style={styles.spaceItemLabel} numberOfLines={1}>
                    {space.name}
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
  spacesStrip: {
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 24,
  },
  spaceItem: {
    alignItems: 'center',
    width: 64,
    gap: 6,
  },
  spaceItemLabel: {
    fontSize: 11.5,
    textAlign: 'center',
  },
});
