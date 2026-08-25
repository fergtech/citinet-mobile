import { useEffect, useState } from 'react';

import { useSession } from '@/lib/session/session-context';
import { geocodeLocation } from './geocoding';

// Single source of truth for "no hub center resolved yet" — every map on
// every screen (Atlas itself, Discover's preview card) falls back to this
// exact point/zoom so they render congruently instead of two independently
// hand-copied constants drifting apart. Once real pins exist, fitToPins
// takes over from this anyway (see components/atlas/leaflet-map.tsx) — this
// only matters for the 0-1-pin edge case or before it resolves.
export const DEFAULT_MAP_CENTER: [number, number] = [39.8283, -98.5795]; // continental US
export function fallbackMapZoom(hubCenter: [number, number] | null): number {
  return hubCenter ? 14 : 4;
}

// Geocoded once per hub slug and cached for the process lifetime — matches
// citinet web's hubGeoCenter (a fixed reference point for Atlas distances,
// not live per-user GPS), so browsing Atlas never requires a location
// permission prompt.
const cache = new Map<string, [number, number] | null>();

async function resolveHubCenter(hubSlug: string, location: string | undefined): Promise<[number, number] | null> {
  if (cache.has(hubSlug)) return cache.get(hubSlug) ?? null;
  const center = location ? await geocodeLocation(location) : null;
  cache.set(hubSlug, center);
  return center;
}

/** Null while resolving or if the hub has no location string / geocoding failed. */
export function useHubCenter(): [number, number] | null {
  const { session } = useSession();
  const [center, setCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    resolveHubCenter(session.hub.slug, session.hub.location).then((c) => {
      if (!cancelled) setCenter(c);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return center;
}
