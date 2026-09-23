import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { Club, ClubVisibility } from '@/lib/api/types';

// Mirrors citinet web's SPACE_CATEGORY (SpacesScreen.tsx) — purely a Discover
// filter aid, same as the note on Club['category'] in types.ts. Values
// match the server's plain TEXT column exactly; anything else (including
// null/'') falls through to clubCategoryMeta returning null, same as an
// unrecognized value on web.
export type ClubCategory = 'civic' | 'hobby' | 'outdoors' | 'parents' | 'sports';

const CLUB_CATEGORY: Record<ClubCategory, { label: string; icon: IconSymbolName }> = {
  civic: { label: 'Civic', icon: 'building.2.fill' },
  hobby: { label: 'Hobbies', icon: 'paintpalette.fill' },
  outdoors: { label: 'Outdoors', icon: 'leaf.fill' },
  parents: { label: 'Parenting', icon: 'figure.and.child.holdinghands' },
  sports: { label: 'Sports', icon: 'dumbbell.fill' },
};

export const CLUB_CATEGORY_FILTERS: { value: ClubCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(Object.keys(CLUB_CATEGORY) as ClubCategory[]).map((value) => ({ value, label: CLUB_CATEGORY[value].label })),
];

export function clubCategoryMeta(category: string | null): { label: string; icon: IconSymbolName } | null {
  return category && category in CLUB_CATEGORY ? CLUB_CATEGORY[category as ClubCategory] : null;
}

// 'invite-only' is a real visibility value on the server (POST /api/spaces,
// PATCH /api/spaces/:slug both accept it) but the design spec only describes
// two badge treatments (Public/globe, Private/lock) — invite-only falls back
// to the Private badge rather than inventing a third, unspecified one.
export function clubVisibilityMeta(visibility: ClubVisibility): { label: string; icon: IconSymbolName } {
  if (visibility === 'public') return { label: 'Public', icon: 'globe' };
  return { label: 'Private', icon: 'lock.fill' };
}

// "Color derived from the club's banner fields" — banner_color is already a
// real color value on solid-mode clubs (not a named-color lookup like
// initiatives' `color` field), so this just picks the right field for
// whichever mode is set, falling back to the app's brand color for a club
// with no banner configured yet (banner_mode null, the common case for a
// freshly created club).
export function clubMonogramColor(club: Pick<Club, 'banner_mode' | 'banner_color' | 'banner_gradient_from'>): string {
  if (club.banner_mode === 'solid' && club.banner_color) return club.banner_color;
  if (club.banner_mode === 'gradient' && club.banner_gradient_from) return club.banner_gradient_from;
  return Brand;
}
