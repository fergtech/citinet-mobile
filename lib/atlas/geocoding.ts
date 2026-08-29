// OpenStreetMap Nominatim — no API key, same service citinet web uses
// (src/app/utils/geocoding.ts). A custom User-Agent is required by Nominatim's
// usage policy for non-browser clients (a bare RN fetch has no Referer header
// the way a browser tab does).
const NOMINATIM_HEADERS = { 'Accept-Language': 'en', 'User-Agent': 'peoplescorp-app' };

export type NominatimResult = { place_id: number; display_name: string; lat: string; lon: string };

// ~100km box in mid-latitudes — roughly an hour's drive, matching what
// makes sense for a hub-local project (a hub is one community's own machine,
// not a global directory) rather than a fixed distance chosen arbitrarily.
// Real, reported problem this fixes: an ambiguous/common place name (e.g. a
// generic street or park name) resolving to a same-named place on a
// different continent instead of failing — Nominatim's plain relevance
// ranking has no concept of "near this hub" unless told to.
const HUB_BOUND_DEGREES = 1.0;

function boundedViewboxParams(hubCenter?: [number, number]): string {
  if (!hubCenter) return '';
  const [lat, lng] = hubCenter;
  const d = HUB_BOUND_DEGREES;
  return `&viewbox=${lng - d},${lat + d},${lng + d},${lat - d}&bounded=1`;
}

// Real, reported problem this fixes: searching "walmart" near a hub in
// Aberdeen, MD never surfaced the actual Walmart 2km away — every result was
// 70-120km out (Bowie/DC/Alexandria/PA). bounded=1 only restricts the
// CANDIDATE set to the viewbox; Nominatim still orders results within it by
// its own "importance" score (roughly, how well-known/well-mapped a place
// is), not by distance to anything. A handful of heavily-tagged big-box
// stores easily outrank a correctly-tagged but lower-"importance" one right
// next door. Verified directly against the live API: at the old limit=5,
// zero of the 5 results were within 70km of Aberdeen; at limit=40 (Nominatim's
// own ceiling), the real Aberdeen store appears within ~2-14km of the top —
// it was never missing from OSM, just buried under limit=5's worth of
// "importance" ranking. So: overfetch, then re-rank by real distance
// ourselves, then truncate to what the UI actually shows.
const OVERFETCH_LIMIT = 40;
const DISPLAY_LIMIT = 5;

/** Ascending distance from hubCenter — the literal "closest first, then
 * broaden out" behavior. No-op (keeps Nominatim's own order) when there's no
 * hub center to measure from. */
function sortByDistanceFromHub<T extends { lat: string; lon: string }>(results: T[], hubCenter?: [number, number]): T[] {
  if (!hubCenter) return results;
  const [lat, lng] = hubCenter;
  return [...results].sort(
    (a, b) =>
      distanceMeters(lat, lng, parseFloat(a.lat), parseFloat(a.lon)) - distanceMeters(lat, lng, parseFloat(b.lat), parseFloat(b.lon))
  );
}

// hubCenter is optional and omitted by lib/atlas/hub-center.ts's own
// bootstrap call (geocoding the hub's own address to find hubCenter in the
// first place — nothing to bound against or sort by yet there). Every other
// caller with a real hubCenter in scope should pass it.
export async function geocodeLocation(location: string, hubCenter?: [number, number]): Promise<[number, number] | null> {
  try {
    const limit = hubCenter ? OVERFETCH_LIMIT : 1;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=${limit}${boundedViewboxParams(hubCenter)}`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    const data = await res.json();
    if (data.length === 0) return null;
    const [closest] = sortByDistanceFromHub(data, hubCenter);
    return [parseFloat(closest.lat), parseFloat(closest.lon)];
  } catch {
    // network hiccup — caller treats null the same as "couldn't resolve"
  }
  return null;
}

export async function searchGeocode(query: string, hubCenter?: [number, number]): Promise<NominatimResult[]> {
  try {
    const limit = hubCenter ? OVERFETCH_LIMIT : DISPLAY_LIMIT;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}${boundedViewboxParams(hubCenter)}`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    const data: NominatimResult[] = await res.json();
    return sortByDistanceFromHub(data, hubCenter).slice(0, DISPLAY_LIMIT);
  } catch {
    return [];
  }
}

/** Great-circle distance in meters between two lat/lng points (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistanceMiles(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) return 'Nearby';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
