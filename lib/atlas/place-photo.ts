// ── Place photos (Wikidata + Wikimedia Commons, no API key) ─────────────────
// Ported from citinet-web's utils/placePhoto.ts — same lookup, no changes to
// the actual logic. OSM elements surface `wikidata`/`wikipedia` tags in
// `extratags` when linked to one. From there:
//   Wikidata Q-id → P18 (image) claim → Commons Special:FilePath (works
//   directly as an image url, no separate lookup needed).
//   Wikipedia "lang:Title" tag → REST summary endpoint's thumbnail, used as a
//   fallback when the OSM element has no wikidata link of its own.
//
// A pure reverse-geocode-by-point (nearest OSM element to the exact lat/lng)
// is too fragile here: a user-dropped pin even ~10m off a landmark's tagged
// node snaps to an unrelated nearby footway/building instead. Searching by
// the pin's title within a tight box around it is far more likely to land on
// the actual tagged landmark, so that's tried first when a title is given.

export interface PlacePhoto {
  url: string;
  attribution: string;
  sourceUrl?: string;
}

// In-memory only (RN has no sessionStorage) — same "cache for this app
// session, not persisted" intent as the web version, since the same pin's
// detail screen can reopen repeatedly within a session.
const cache = new Map<string, PlacePhoto | null>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

async function fetchWikidataImage(qid: string): Promise<PlacePhoto | null> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json&origin=*`
    );
    const data = await res.json();
    const filename = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
    if (!filename) return null;
    const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=800`,
      attribution: 'Wikimedia Commons',
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${encoded}`,
    };
  } catch {
    return null;
  }
}

async function fetchWikipediaThumbnail(wikipediaTag: string): Promise<PlacePhoto | null> {
  const sep = wikipediaTag.indexOf(':');
  if (sep === -1) return null;
  const lang = wikipediaTag.slice(0, sep);
  const title = wikipediaTag.slice(sep + 1);
  if (!lang || !title) return null;
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    const data = await res.json();
    const thumb = data?.thumbnail?.source as string | undefined;
    if (!thumb) return null;
    return {
      url: thumb,
      attribution: 'Wikipedia',
      sourceUrl: data?.content_urls?.desktop?.page as string | undefined,
    };
  } catch {
    return null;
  }
}

async function tagsToPhoto(extratags: Record<string, string> | undefined): Promise<PlacePhoto | null> {
  if (!extratags) return null;
  if (extratags.wikidata) {
    const photo = await fetchWikidataImage(extratags.wikidata);
    if (photo) return photo;
  }
  if (extratags.wikipedia) return fetchWikipediaThumbnail(extratags.wikipedia);
  return null;
}

/** ~150m box around a point, for biasing a title search to nearby results only. */
function nearbyViewbox(lat: number, lng: number): string {
  const d = 0.0015;
  return `${lng - d},${lat + d},${lng + d},${lat - d}`;
}

async function searchByTitle(lat: number, lng: number, title: string): Promise<PlacePhoto | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(title)}&format=json&limit=3&extratags=1` +
        `&viewbox=${nearbyViewbox(lat, lng)}&bounded=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    for (const result of data as { extratags?: Record<string, string> }[]) {
      const photo = await tagsToPhoto(result.extratags);
      if (photo) return photo;
    }
  } catch {
    // swallow — no photo is a normal, expected outcome
  }
  return null;
}

async function reverseByPoint(lat: number, lng: number): Promise<PlacePhoto | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&extratags=1`, {
      headers: { 'Accept-Language': 'en' },
    });
    const data = await res.json();
    return await tagsToPhoto(data?.extratags);
  } catch {
    return null;
  }
}

/** Looks up a representative photo for a pin. Tries a title search biased near the
 * pin's coordinates first (robust to imprecise pin placement), then falls back to
 * reverse-geocoding the exact point. Returns null (never throws) when nothing is
 * linked — callers should fall back to their own default imagery (Panoramax, then
 * a plain map close-up, same order app/atlas/[id].tsx already used before this). */
export async function fetchPlacePhoto(lat: number, lng: number, title?: string): Promise<PlacePhoto | null> {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key) ?? null;

  const photo = (title ? await searchByTitle(lat, lng, title) : null) ?? (await reverseByPoint(lat, lng));
  cache.set(key, photo);
  return photo;
}
