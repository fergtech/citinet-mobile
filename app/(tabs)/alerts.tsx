import { useEffect } from 'react';
import { router } from 'expo-router';

// Same convention as app/(tabs)/create.tsx (tapping the tab bar's bell
// button is intercepted in `_layout.tsx` and pushes the real /notifications
// screen directly) — but named "alerts", not "notifications": this file's
// own route would otherwise be /notifications too ((tabs) is a route GROUP,
// its parens don't count toward the URL), colliding with the real screen at
// app/notifications.tsx. Both resolving to the same path meant
// router.push('/notifications') could land back on *this* redirect instead
// of the real screen, which itself redirects to '/notifications' again —
// landing on itself, rendering null forever. Looked exactly like "the
// notifications screen is blank" with no error, because it never actually
// reached real content. This route only exists so `Tabs.Screen
// name="alerts"` has a matching file; it redirects if it's ever reached
// some other way than the tab press it's built for.
export default function NotificationsTabRedirect() {
  useEffect(() => {
    router.replace('/notifications');
  }, []);
  return null;
}
