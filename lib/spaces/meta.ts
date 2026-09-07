import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { Space, SpaceVisibility } from '@/lib/api/types';

// Mirrors citinet web's SPACE_CATEGORY (SpacesScreen.tsx) — purely a Discover
// filter aid, same as the note on Space['category'] in types.ts. Values
// match the server's plain TEXT column exactly; anything else (including
// null/'') falls through to spaceCategoryMeta returning null, same as an
// unrecognized value on web.
export type SpaceCategory = 'civic' | 'hobby' | 'outdoors' | 'parents' | 'sports';

const SPACE_CATEGORY: Record<SpaceCategory, { label: string; icon: IconSymbolName }> = {
  civic: { label: 'Civic', icon: 'building.2.fill' },
  hobby: { label: 'Hobbies', icon: 'paintpalette.fill' },
  outdoors: { label: 'Outdoors', icon: 'leaf.fill' },
  parents: { label: 'Parenting', icon: 'figure.and.child.holdinghands' },
  sports: { label: 'Sports', icon: 'dumbbell.fill' },
};

export const SPACE_CATEGORY_FILTERS: { value: SpaceCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(Object.keys(SPACE_CATEGORY) as SpaceCategory[]).map((value) => ({ value, label: SPACE_CATEGORY[value].label })),
];

export function spaceCategoryMeta(category: string | null): { label: string; icon: IconSymbolName } | null {
  return category && category in SPACE_CATEGORY ? SPACE_CATEGORY[category as SpaceCategory] : null;
}

// 'invite-only' is a real visibility value on the server (POST /api/spaces,
// PATCH /api/spaces/:slug both accept it) but the design spec only describes
// two badge treatments (Public/globe, Private/lock) — invite-only falls back
// to the Private badge rather than inventing a third, unspecified one.
export function spaceVisibilityMeta(visibility: SpaceVisibility): { label: string; icon: IconSymbolName } {
  if (visibility === 'public') return { label: 'Public', icon: 'globe' };
  return { label: 'Private', icon: 'lock.fill' };
}

// "Color derived from the space's banner fields" — banner_color is already a
// real color value on solid-mode spaces (not a named-color lookup like
// initiatives' `color` field), so this just picks the right field for
// whichever mode is set, falling back to the app's brand color for a space
// with no banner configured yet (banner_mode null, the common case for a
// freshly created space).
export function spaceMonogramColor(space: Pick<Space, 'banner_mode' | 'banner_color' | 'banner_gradient_from'>): string {
  if (space.banner_mode === 'solid' && space.banner_color) return space.banner_color;
  if (space.banner_mode === 'gradient' && space.banner_gradient_from) return space.banner_gradient_from;
  return Brand;
}
