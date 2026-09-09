import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

// How far to translate the floating pill down to fully hide it — its own
// height (60, see lib/ui/tab-bar-style.ts) plus more than the largest
// bottom inset this app is likely to see. Only ever used as an off-screen
// distance, so being generous costs nothing.
const HIDE_DISTANCE = 140;

type TabBarVisibilityContextValue = {
  translateY: SharedValue<number>;
  setHidden: (hidden: boolean) => void;
};

const TabBarVisibilityContext = createContext<TabBarVisibilityContextValue | null>(null);

// Lets a scrollable screen (currently just Home — see app/(tabs)/index.tsx)
// slide the floating tab bar (components/animated-tab-bar.tsx) off/on
// screen on scroll, without that screen needing to know anything about how
// the bar is actually rendered. A plain Reanimated shared value, not
// react state — setHidden runs from a regular JS-thread scroll handler, but
// withTiming still animates it smoothly on the UI thread regardless of
// which thread requested the change.
export function TabBarVisibilityProvider({ children }: { children: ReactNode }) {
  const translateY = useSharedValue(0);
  const value = useMemo<TabBarVisibilityContextValue>(
    () => ({
      translateY,
      setHidden: (hidden: boolean) => {
        translateY.value = withTiming(hidden ? HIDE_DISTANCE : 0, { duration: 250 });
      },
    }),
    [translateY]
  );

  return <TabBarVisibilityContext.Provider value={value}>{children}</TabBarVisibilityContext.Provider>;
}

export function useTabBarVisibility(): TabBarVisibilityContextValue {
  const ctx = useContext(TabBarVisibilityContext);
  if (!ctx) throw new Error('useTabBarVisibility must be used within a TabBarVisibilityProvider');
  return ctx;
}
