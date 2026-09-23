import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { AtlasPinCategory } from '@/lib/api/types';

// Mirrors citinet's real ATLAS_CATEGORIES (src/app/types/atlas.ts) — same
// labels and marker colors, icons are this app's IconSymbol names (real
// vector icons throughout, never emoji — including on the map markers
// themselves, see components/atlas/leaflet-map.tsx's CATEGORY_ICON_PATHS,
// real Material Icons SVG paths inlined for that WebView/DOM context).
export const ATLAS_CATEGORIES: Record<AtlasPinCategory, { label: string; color: string; icon: IconSymbolName }> = {
  meetup: { label: 'Meetup Spot', color: '#3b82f6', icon: 'mappin.and.ellipse' },
  safety: { label: 'Safety Alert', color: '#f59e0b', icon: 'exclamationmark.triangle.fill' },
  avoid: { label: 'Avoid Area', color: '#ef4444', icon: 'exclamationmark.octagon.fill' },
  infrastructure: { label: 'Community Space', color: '#7c3aed', icon: 'building.2.fill' },
  poi: { label: 'Point of Interest', color: '#10b981', icon: 'star.fill' },
  aid: { label: 'Mutual Aid', color: '#db2777', icon: 'hand.raised.fill' },
  green: { label: 'Green Space', color: '#16a34a', icon: 'leaf.fill' },
  // Same indigo the web app's old standalone event-marker layer used before
  // events became a real pin category there too — kept for visual
  // continuity now that it's just another entry here.
  event: { label: 'Event', color: '#6366f1', icon: 'calendar' },
};

export const ATLAS_CATEGORY_ORDER: AtlasPinCategory[] = ['meetup', 'safety', 'avoid', 'infrastructure', 'poi', 'aid', 'green', 'event'];

// Mirrors web's exact keyword lists (AtlasScreen.tsx) — a lightweight
// "Suggested: X" chip while titling a pin, not an auto-applied guess (the
// editor only ever pre-fills the field when the user taps the suggestion).
const CATEGORY_KEYWORDS: Record<AtlasPinCategory, string[]> = {
  meetup: ['meet', 'meetup', 'hangout', 'gathering', 'bench', 'plaza', 'square', 'spot'],
  safety: ['warning', 'alert', 'caution', 'flood', 'hazard', 'unsafe', 'broken', 'incident', 'crime', 'accident'],
  avoid: ['avoid', 'danger', 'closed', 'blocked', 'abandoned', 'sketchy', 'stay away'],
  infrastructure: ['community center', 'hall', 'library', 'school', 'church', 'facility', 'clinic', 'station'],
  poi: [
    'coffee', 'cafe', 'café', 'restaurant', 'food', 'shop', 'store', 'market', 'bar',
    'trail', 'fountain', 'museum', 'gallery', 'starbucks', 'landmark', 'monument',
  ],
  aid: ['fridge', 'pantry', 'food bank', 'free food', 'mutual aid', 'donation', 'giveaway', 'tool library', 'clothing swap'],
  green: ['garden', 'park', 'green space', 'community garden', 'orchard', 'planter', 'meadow', 'trees'],
  // Rarely hit in practice — web's event-creation flow always sets 'event'
  // explicitly rather than going through this suggestion — but a plain
  // drop-a-pin title still runs through here too, so someone manually
  // pinning "Block Party" or "Farmers Market" this way gets the right
  // category guessed too.
  event: ['event', 'festival', 'concert', 'block party', 'farmers market', 'parade', 'fundraiser', 'fair', 'rsvp'],
};

export function suggestCategory(title: string): AtlasPinCategory | null {
  if (!title.trim()) return null;
  const lower = title.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [AtlasPinCategory, string[]][]) {
    if (keywords.some((kw) => lower.includes(kw))) return cat;
  }
  return null;
}
