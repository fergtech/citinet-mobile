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
};

export const ATLAS_CATEGORY_ORDER: AtlasPinCategory[] = ['meetup', 'safety', 'avoid', 'infrastructure', 'poi', 'aid', 'green'];
