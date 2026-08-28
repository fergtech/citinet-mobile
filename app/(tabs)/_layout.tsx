import { Tabs, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateTabButton } from '@/components/create-tab-button';
import { HapticTab } from '@/components/haptic-tab';
import { HubAvatar } from '@/components/hub-avatar';
import { CustomIcon } from '@/components/ui/custom-icon';
import { TabBarBackground } from '@/components/ui/tab-bar-background';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listUnreadNotifications } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const tint = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';
  const borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';

  // Lives at the tab-layout level (not inside app/notifications.tsx itself)
  // so the dot shows regardless of which tab is active. This component IS
  // the screen behind Stack.Screen name="(tabs)" in the root layout, so it
  // regains focus like any other screen when the pushed /notifications
  // screen is popped — same useFocusEffect re-check convention as
  // everywhere else in this app that can go stale from a screen on top of it.
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      listUnreadNotifications(session.hub.tunnelUrl, session.token)
        .then((list) => setHasUnreadNotifications(list.length > 0))
        .catch(() => {});
    }, [session])
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tint,
        // Explicit, not left to react-navigation's own default (which
        // computes inactive tint from its OWN theme's colors.text at 68%
        // opacity — a different source than this app's theme, and not
        // necessarily the same shade CreateTabButton's inactiveColor uses).
        // Setting it here guarantees Home/Explore/Chat and the Create
        // button all render the exact same grey, not just a similar one.
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
        tabBarShowLabel: false,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        // Each tab button's own internal layout is justifyContent:
        // 'flex-start' (built assuming a label sits below the icon) — with
        // labels hidden, that pins the icon to the top of the button and
        // leaves the rest of its height empty below. flex: 1 here lets the
        // icon's wrapper grow to fill that leftover height itself (flex-grow
        // wins over the parent's flex-start once there's slack to fill), so
        // centering it becomes just centering within its own box.
        tabBarIconStyle: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        },
        // Only iOS gets the floating pill (content scrolls visibly behind
        // it, via each tab screen's extra bottom padding — see
        // useBottomTabBarHeight() in index/discover/messages/profile).
        // Android keeps its normal in-flow, edge-to-edge Material bar —
        // a floating detached pill isn't a Material 3 pattern the way it's
        // a standard iOS one, so that split is deliberate, not a gap.
        tabBarStyle: {
          backgroundColor: 'transparent',
          ...Platform.select({
            ios: {
              position: 'absolute',
              left: 16,
              right: 16,
              // insets.bottom already clears the home indicator; the max()
              // just guarantees a visible gap on older devices with no
              // inset at all (a physical home button, no safe area).
              bottom: Math.max(insets.bottom, 16),
              height: 60,
              // The library always adds paddingBottom: insets.bottom inside
              // the bar to clear the home indicator when it's flush with
              // the screen edge — redundant now that `bottom` above already
              // moves the whole pill above it, and left alone it would eat
              // most of this 60pt height, cramming the icons toward the top.
              paddingBottom: 0,
              paddingTop: 0,
              borderRadius: 28,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor,
              // Clips TabBarBackground's blur fill to the pill's rounded
              // corners — without this it paints as a plain rectangle
              // regardless of borderRadius, since rounding a container
              // doesn't rasterize its children unless overflow is clipped.
              overflow: 'hidden',
            },
            default: {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: borderColor,
            },
          }),
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          // Hand-traced vector path, not the corrupted source export — see
          // components/ui/custom-icon.tsx for how and why.
          tabBarIcon: ({ color }) => <CustomIcon size={30} name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Explore',
          // Pulled off the tab bar — reached from Home's own header search
          // icon instead now (see app/(tabs)/index.tsx). href: null keeps
          // this a real, navigable route (expo-router still registers it),
          // it just no longer gets a tab bar button of its own.
          href: null,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Notifications',
          // Traced from bell-android's pathData — see custom-icon.tsx.
          // Takes over the tab bar slot search used to sit in.
          tabBarIcon: ({ color }) => (
            <View>
              <CustomIcon size={28} name="bell" color={color} />
              {hasUnreadNotifications && <View style={styles.unreadDot} />}
            </View>
          ),
        }}
        listeners={{
          // Same "intercept and push the real screen" pattern as the create
          // tab — app/(tabs)/alerts.tsx only exists as a redirect fallback,
          // the actual screen is the top-level app/notifications.tsx. Named
          // "alerts" (not "notifications") specifically so this tab's own
          // route never collides with that one — see alerts.tsx's own note.
          tabPress: (e) => {
            e.preventDefault();
            router.push('/notifications');
          },
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '',
          // A full custom tabBarButton (not just tabBarIcon), which bypasses
          // the library's own icon-rendering pipeline entirely — so unlike
          // the other 4 tabs, tabBarIconStyle above never reaches this one;
          // CreateTabButton applies the same centering fix directly, plus
          // its own press-in spin animation.
          tabBarButton: (props) => <CreateTabButton {...props} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/modal');
          },
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <CustomIcon size={30} name="satelliteDish" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Me',
          tabBarIcon: () =>
            session ? (
              <HubAvatar
                userId={session.userId}
                displayName={session.displayName}
                tunnelUrl={session.hub.tunnelUrl}
                size={30}
              />
            ) : null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#d1465f',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
});
