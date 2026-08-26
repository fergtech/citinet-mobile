import '@/lib/crypto/random-polyfill';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { E2EKeysProvider } from '@/lib/crypto/e2e-context';
import { SessionProvider, useSession } from '@/lib/session/session-context';
import { ThemePreferenceProvider } from '@/lib/ui/theme-preference';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'loading') {
      SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === 'loading') return null;

  return (
    <Stack>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="compose-post" options={{ headerShown: false }} />
        <Stack.Screen name="event-editor" options={{ headerShown: false }} />
        <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="profile/[userId]" options={{ headerShown: false }} />
        <Stack.Screen name="account/privacy" options={{ headerShown: false }} />
        <Stack.Screen name="account/settings" options={{ headerShown: false }} />
        <Stack.Screen name="notes/index" options={{ headerShown: false }} />
        <Stack.Screen name="notes/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="atlas/index" options={{ headerShown: false }} />
        <Stack.Screen name="atlas/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="atlas/editor" options={{ headerShown: false }} />
        <Stack.Screen name="atlas/location" options={{ headerShown: false }} />
        {/* Full-screen push, deliberately not `presentation: 'modal'` — spec
            calls this out explicitly ("not a modal"), same plain-push pattern
            as every other Atlas screen. */}
        <Stack.Screen name="atlas/share" options={{ headerShown: false }} />
        <Stack.Screen name="atlas/panoramax-view" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="marketplace/index" options={{ headerShown: false }} />
        <Stack.Screen name="marketplace/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="marketplace/vendor/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="marketplace/editor" options={{ headerShown: false }} />
        <Stack.Screen name="marketplace/vendor-editor" options={{ headerShown: false }} />
        <Stack.Screen name="marketplace/banner-editor" options={{ headerShown: false }} />
        <Stack.Screen name="files/index" options={{ headerShown: false }} />
        <Stack.Screen name="files/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="files/upload" options={{ headerShown: false }} />
        <Stack.Screen name="files/share" options={{ headerShown: false }} />
        <Stack.Screen name="files/storage" options={{ headerShown: false }} />
        <Stack.Screen name="feed" options={{ headerShown: false }} />
        <Stack.Screen name="events" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/index" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/team" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/tasks" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/tasks/[taskId]" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/roles" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/resources" options={{ headerShown: false }} />
        <Stack.Screen name="conversation/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="group-members" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="e2e-unlock" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="e2e-setup" options={{ presentation: 'modal', headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    // Required by react-native-gesture-handler for its Gesture API (pinch/pan
    // in ZoomableImage, see components/atlas/zoomable-image.tsx) to work at
    // all — expo-router doesn't wrap this automatically.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <SessionProvider>
          <E2EKeysProvider>
            <RootNavigator />
          </E2EKeysProvider>
        </SessionProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayoutWithTheme() {
  return (
    <ThemePreferenceProvider>
      <RootLayout />
    </ThemePreferenceProvider>
  );
}
