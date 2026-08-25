import { Tabs, router } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TabBarBackground } from '@/components/ui/tab-bar-background';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { session } = useSession();
  const tint = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tint,
        tabBarShowLabel: false,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        // Only iOS gets the floating "glass" bar (content scrolls visibly
        // behind it, via each tab screen's extra bottom padding — see
        // useBottomTabBarHeight() in index/discover/messages/profile).
        // Android keeps its normal in-flow Material bottom bar.
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
          ...Platform.select({ ios: { position: 'absolute' }, default: {} }),
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={30} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => <IconSymbol size={30} name="magnifyingglass" color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '',
          tabBarButton: (props) => (
            <HapticTab
              {...props}
              accessibilityLabel="Create"
              accessibilityRole="button">
              <IconSymbol size={30} name="plus" color={tint} />
            </HapticTab>
          ),
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
          tabBarIcon: ({ color }) => <IconSymbol size={30} name="message.fill" color={color} />,
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

