import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Shared by AppDrawer (left edge) and DiscoverDrawer (right edge) — see
// components/app-drawer.tsx and components/discover-drawer.tsx. Has to live
// above both: AppDrawer is mounted INSIDE DiscoverDrawer (see
// app/(tabs)/_layout.tsx), so DiscoverDrawer can't reach AppDrawer's own
// state via context (context only flows down), and vice versa isn't true
// either since neither drawer wraps the other both ways. A coordinator
// sitting above both, that either can read and write, is the only shape that
// lets each one see and react to the other regardless of nesting order.
export type DrawerId = 'app' | 'discover';

type DrawerCoordinatorValue = {
  activeDrawer: DrawerId | null;
  // Call the moment `id` starts opening (gesture commit or programmatic
  // open). Whichever drawer was previously active reacts to no longer being
  // `activeDrawer` by forcing itself shut — see each drawer's own effect.
  notifyOpened: (id: DrawerId) => void;
  // Call once `id` finishes closing ITSELF (gesture, backdrop tap, close
  // button) — never call this for a drawer another notifyOpened() just
  // forced shut, since that would clear the new active drawer out from
  // under it. Internally a no-op unless `id` is still the active one, so
  // it's safe to call from a force-close path too if that's ever simpler.
  notifyClosed: (id: DrawerId) => void;
  // Whether `id` is allowed to open right now — false while the OTHER
  // drawer is active, so each drawer's edge-swipe gesture can disable
  // itself via .enabled(canOpen(id)) instead of racing the other one open.
  canOpen: (id: DrawerId) => boolean;
};

const DrawerCoordinatorContext = createContext<DrawerCoordinatorValue | null>(null);

export function DrawerCoordinatorProvider({ children }: { children: ReactNode }) {
  const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null);
  const notifyOpened = useCallback((id: DrawerId) => setActiveDrawer(id), []);
  const notifyClosed = useCallback((id: DrawerId) => setActiveDrawer((prev) => (prev === id ? null : prev)), []);
  const canOpen = useCallback((id: DrawerId) => activeDrawer === null || activeDrawer === id, [activeDrawer]);
  const value = useMemo<DrawerCoordinatorValue>(
    () => ({ activeDrawer, notifyOpened, notifyClosed, canOpen }),
    [activeDrawer, notifyOpened, notifyClosed, canOpen]
  );
  return <DrawerCoordinatorContext.Provider value={value}>{children}</DrawerCoordinatorContext.Provider>;
}

// Falls back to a permissive no-op pair if rendered outside the provider, so
// neither drawer breaks if one is ever reused somewhere the provider isn't
// mounted — it just loses mutual exclusion, not function.
export function useDrawerCoordinator(): DrawerCoordinatorValue {
  const ctx = useContext(DrawerCoordinatorContext);
  return ctx ?? { activeDrawer: null, notifyOpened: () => {}, notifyClosed: () => {}, canOpen: () => true };
}
