import { useRef } from 'react';
import type { ViewToken } from 'react-native';

import { HubPost } from '@/lib/api/types';
import { usePostConsumption } from '@/lib/ui/post-consumption';

// Per-FlatList wiring for the "≥60% visible for a continuous 2.0s" half of
// post consumption tracking (the cross-screen "seen it" state itself lives
// in lib/ui/post-consumption.tsx's PostConsumptionProvider, not here — this
// hook just feeds that store from one specific scrollable feed). Rides
// FlatList's own built-in viewability timer (itemVisiblePercentThreshold +
// minimumViewTime) instead of a hand-rolled per-item setTimeout: it's
// already scroll-aware (an item that leaves the viewport before 2s never
// fires isViewable, no cancellation logic needed here) and batches its own
// checks, so this doesn't need its own debouncing/throttling on top.
const VISIBLE_PERCENT_THRESHOLD = 60;
const DWELL_MS = 2000;

export function usePostDwellTracking() {
  const { markEngaged, markDwelled } = usePostConsumption();

  // markDwelled is permanently stable (see post-consumption.tsx's own note),
  // so capturing it once here is safe — FlatList requires
  // onViewableItemsChanged to keep the same identity across renders anyway.
  const onViewableItemsChanged = useRef(
    ({ changed }: { viewableItems: ViewToken<HubPost>[]; changed: ViewToken<HubPost>[] }) => {
      for (const token of changed) {
        if (token.isViewable && token.item?.id) markDwelled(token.item.id);
      }
    }
  ).current;

  // itemVisiblePercentThreshold/minimumViewTime together are what give the
  // "≥60% visible for ≥2.0s continuous" rule for free — isViewable only
  // flips true once both hold, and flips back (silently, no callback) the
  // moment either stops holding before the timer completes.
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: VISIBLE_PERCENT_THRESHOLD,
    minimumViewTime: DWELL_MS,
  }).current;

  return { viewabilityConfig, onViewableItemsChanged, markEngaged };
}
