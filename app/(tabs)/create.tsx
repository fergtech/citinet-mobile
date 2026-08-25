import { useEffect } from 'react';
import { router } from 'expo-router';

// Tapping the tab bar's center button is intercepted in `_layout.tsx` and
// pushes `/modal` directly. This route only exists so `Tabs.Screen name="create"`
// has a matching file; it redirects if it's ever reached some other way.
export default function CreateRedirect() {
  useEffect(() => {
    router.replace('/modal');
  }, []);
  return null;
}
