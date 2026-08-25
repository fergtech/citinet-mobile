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

// hubCenter is optional and omitted by lib/atlas/hub-center.ts's own
// bootstrap call (geocoding the hub's own address to find hubCenter in the
// first place — nothing to bound against yet there). Every other caller
// with a real hubCenter in scope should pass it.
export async function geocodeLocation(location: string, hubCenter?: [number, number]): Promise<[number, number] | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1${boundedViewboxParams(hubCenter)}`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    const data = await res.json();
    if (data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch {
    // network hiccup — caller treats null the same as "couldn't resolve"
  }
  return null;
}

export async function searchGeocode(query: string, hubCenter?: [number, number]): Promise<NominatimResult[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5${boundedViewboxParams(hubCenter)}`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    return await res.json();
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
