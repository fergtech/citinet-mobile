import { distanceMeters } from './geocoding';

// Panoramax (panoramax.fr) — an open, federated street-level-imagery project
// (IGN-backed, crowdsourced). Its public instance exposes a plain STAC
// /search endpoint with no auth required for reading public pictures —
// confirmed live: `curl https://api.panoramax.xyz/api/search?bbox=...`
// returns real imagery with no Authorization header at all. Coverage is real
// but geographically limited (heavily France-centric, growing via
// federation) — most pins anywhere else in the world simply won't have any,
// which is the expected, common case, not an error.
const PANORAMAX_SEARCH_URL = 'https://api.panoramax.xyz/api/search';

// ~150m search box, then reject anything the bbox happened to catch that's
// still further than this from the pin — a bbox corner can be much farther
// from center than the box's nominal "radius" suggests.
const SEARCH_BOX_DEGREES = 0.0015;
const MAX_DISTANCE_METERS = 150;

const PANORAMAX_API_ENDPOINT = 'https://api.panoramax.xyz/api';

// Opens the real picture in Panoramax's own hosted web viewer (their actual
// production site, not something embedded in this app) — confirmed URL
// syntax, not guessed: `#focus=pic&pic=<uuid>` on the same host. Offered as
// an external "view the true immersive 360°" option alongside the in-app
// pinch/pan viewer below, see app/atlas/panoramax-view.tsx.
export function panoramaxWebViewerUrl(pictureId: string): string {
  return `https://api.panoramax.xyz/#focus=pic&pic=${pictureId}`;
}

// imageUrl is the "sd" asset (2048px) — enough detail to pinch-zoom into,
// without the full "hd" asset's size. thumbnailUrl ("thumb", 500px) stays
// for the small, fast Pin Detail banner preview.
export type PanoramaxImage = { thumbnailUrl: string; imageUrl: string; pictureId: string; distanceMeters: number };

export async function findNearestPanoramaxImage(lat: number, lng: number): Promise<PanoramaxImage | null> {
  const bbox = [lng - SEARCH_BOX_DEGREES, lat - SEARCH_BOX_DEGREES, lng + SEARCH_BOX_DEGREES, lat + SEARCH_BOX_DEGREES].join(',');
  try {
    const res = await fetch(`${PANORAMAX_API_ENDPOINT}/search?bbox=${bbox}&limit=10`);
    if (!res.ok) return null;
    const data = await res.json();
    const features: unknown[] = Array.isArray(data?.features) ? data.features : [];

    let nearest: PanoramaxImage | null = null;
    for (const raw of features) {
      const feature = raw as {
        id?: string;
        geometry?: { coordinates?: [number, number] };
        assets?: { thumb?: { href?: string }; sd?: { href?: string } };
      };
      const coords = feature.geometry?.coordinates;
      const thumb = feature.assets?.thumb?.href;
      const sd = feature.assets?.sd?.href;
      if (!coords || typeof coords[0] !== 'number' || typeof coords[1] !== 'number' || !thumb || !sd || !feature.id) continue;
      const [flng, flat] = coords;
      const d = distanceMeters(lat, lng, flat, flng);
      if (!nearest || d < nearest.distanceMeters) {
        nearest = { thumbnailUrl: thumb, imageUrl: sd, pictureId: feature.id, distanceMeters: d };
      }
    }
    return nearest && nearest.distanceMeters <= MAX_DISTANCE_METERS ? nearest : null;
  } catch {
    // No network, no coverage, or a malformed response — all mean the same
    // thing to a caller: fall back to whatever comes next.
    return null;
  }
}
