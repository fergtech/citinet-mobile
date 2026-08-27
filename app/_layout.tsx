import '@/lib/crypto/random-polyfill';
import '@/lib/comms/livekit-init';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { BroadcastOverlay } from '@/components/comms/broadcast-overlay';
import { InCallOverlay } from '@/components/comms/in-call-overlay';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BroadcastProvider } from '@/lib/comms/broadcast-context';
import { CallProvider, useCall } from '@/lib/comms/call-context';
import { E2EKeysProvider } from '@/lib/crypto/e2e-context';
import { SessionProvider, useSession } from '@/lib/session/session-context';
import { ThemePreferenceProvider } from '@/lib/ui/theme-preference';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useSession();
  const { call } = useCall();
  // Guards against pushing /call/setup a second time if this effect re-runs
  // while already on it (e.g. a fast-refresh) — only fires on the actual
  // idle-to-incoming transition, not on every render while phase stays
  // 'incoming'.
  const pushedForCallId = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'loading') {
      SplashScreen.hideAsync();
    }
  }, [status]);

  // The one place an incoming call actually interrupts whatever the user is
  // doing — everywhere else in this app is poll-on-focus, this is the
  // exception (see lib/comms/socket.ts's own note on why).
  useEffect(() => {
    if (call.phase === 'incoming' && call.callId && pushedForCallId.current !== call.callId) {
      pushedForCallId.current = call.callId;
      console.log('[call] pushing /call/setup for', call.callId);
      router.push('/call/setup');
    }
    if (call.phase === 'idle') pushedForCallId.current = null;
  }, [call.phase, call.callId]);

  if (status === 'loading') return null;

  return (
    <Stack>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'pending'}>
        <Stack.Screen name="pending-approval" options={{ headerShown: false }} />
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
        <Stack.Screen name="account/blocked-users" options={{ headerShown: false }} />
        {/* headerShown here is just the base default — each of these 5
            screens overrides it at runtime via its own <Stack.Screen
            options={useNativeHeaderOptions(...)} />, since that needs hooks
            (theme-aware colors) a static options object here can't use. */}
        <Stack.Screen name="admin/index" options={{ headerShown: false }} />
        <Stack.Screen name="admin/pending" options={{ headerShown: false }} />
        <Stack.Screen name="admin/members" options={{ headerShown: false }} />
        <Stack.Screen name="admin/reports" options={{ headerShown: false }} />
        <Stack.Screen name="admin/mod-log" options={{ headerShown: false }} />
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
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="events" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/index" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/create" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/team" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/tasks" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/tasks/[taskId]" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/roles" options={{ headerShown: false }} />
        <Stack.Screen name="initiatives/[id]/resources" options={{ headerShown: false }} />
        <Stack.Screen name="spaces/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="spaces/create" options={{ headerShown: false }} />
        <Stack.Screen name="conversation/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="call/setup" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="broadcast/setup" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }} />
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
            <CallProvider>
              <BroadcastProvider>
                <RootNavigator />
                {/* Sibling to the Stack, not inside any one screen — this is
                    what lets a call/broadcast survive navigating to a
                    different screen (minimize) instead of unmounting with
                    whatever screen happened to push it. See InCallOverlay's
                    own top-of-file note — BroadcastOverlay mirrors it. */}
                <InCallOverlay />
                <BroadcastOverlay />
              </BroadcastProvider>
            </CallProvider>
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
